'use strict';

const { D, round } = require('../utils/money');
const { splitEvenly } = require('./pricing');
const { splitService } = require('./costing');

/**
 * Per-service financial rules: which calculation applies to a service at the
 * price it was sold for. Pure functions, no database
 * (tests/financial-rules.test.js). Every sale — at the till, recorded for a
 * previous day, corrected or imported from Excel — is split here.
 *
 * A rule is stored per service (versioned, see service_financial_rules):
 *
 * {
 *   method: 'general'        the salon's general formula (Settings → Financial):
 *                            price − products → operations % → staff % / salon %
 *         | 'bands'          a rule per price band (see below)
 *         | 'unconfigured',  no rule yet: the service cannot be sold or imported
 *   productCost: 'deduct' | 'none',   is the cost of products used taken off first?
 *   productsIncluded: true | false,   does the price already include the products?
 *                                     (false: products are sold separately, so their
 *                                     cost is not deducted from the service)
 *   staffSplit: 'equal',              how the staff pool is shared
 *   bands: [                          price bands (inclusive, must not overlap)
 *     { min, max, label?, general: true },                 the general formula
 *     { min, max, label?, operations, staff, profit },     parts
 *   ]
 * }
 *
 * A part is { type: 'fixed', value } | { type: 'percent', value }
 *          | { type: 'remainder' } | { type: 'none' }.
 * Operations come first, from the amount after products (a percentage of it, or
 * a fixed amount); staff and salon profit then share what is left (a percentage
 * of it, a fixed amount, or the remainder). A band either has a remainder part
 * or is a single price whose parts add up exactly to it. Nothing is ever
 * guessed: a price outside every band, an unconfigured service, or parts that
 * do not add up are refused with a clear reason.
 */

const METHODS = ['general', 'bands', 'unconfigured'];
const PART_TYPES = {
  operations: ['fixed', 'percent', 'none'],
  staff: ['fixed', 'percent', 'remainder', 'none'],
  profit: ['fixed', 'percent', 'remainder', 'none'],
};
const PART_LABELS = { operations: 'Operations', staff: 'Staff', profit: 'Salon profit' };

class FinancialRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialRuleError';
    this.code = code;
  }
}

const GENERAL_RULE = Object.freeze({ method: 'general', productCost: 'deduct', productsIncluded: true, staffSplit: 'equal', bands: [] });

const fmt = (n) => Number(n).toLocaleString('en');

/** Fill in defaults so every stored rule has the same shape. */
function normalizeRule(raw) {
  const rule = raw && typeof raw === 'object' ? raw : {};
  return {
    method: METHODS.includes(rule.method) ? rule.method : 'general',
    productCost: rule.productCost === 'none' ? 'none' : 'deduct',
    productsIncluded: rule.productsIncluded !== false,
    staffSplit: 'equal',
    bands: Array.isArray(rule.bands)
      ? rule.bands.map((b) => (b.general
        ? { min: Number(b.min), max: Number(b.max), ...(b.label ? { label: String(b.label) } : {}), general: true }
        : {
          min: Number(b.min),
          max: Number(b.max),
          ...(b.label ? { label: String(b.label) } : {}),
          operations: normalizePart(b.operations),
          staff: normalizePart(b.staff),
          profit: normalizePart(b.profit),
        }))
      : [],
  };
}

function normalizePart(part) {
  if (!part || typeof part !== 'object') return { type: 'none' };
  if (part.type === 'fixed' || part.type === 'percent') return { type: part.type, value: Number(part.value) };
  if (part.type === 'remainder') return { type: 'remainder' };
  return { type: 'none' };
}

/** Is the cost of products used deducted from this service's price? */
function deductsProducts(rule) {
  return rule.method !== 'unconfigured' && rule.productCost === 'deduct' && rule.productsIncluded !== false;
}

function bandName(band) {
  if (band.label) return band.label;
  return band.min === band.max ? fmt(band.min) : `${fmt(band.min)}–${fmt(band.max)}`;
}

/** The band that covers a price, or null. */
function findBand(rule, price) {
  const p = D(price);
  return rule.bands.find((b) => p.greaterThanOrEqualTo(b.min) && p.lessThanOrEqualTo(b.max)) || null;
}

/**
 * Operations, staff pool and salon profit of a band from the amount after
 * products. Throws when the parts leave a negative amount or do not add up.
 */
function allocateParts(band, base, decimals) {
  const r = (v) => round(v, decimals);
  const amount = (part, of) => {
    if (part.type === 'fixed') return r(part.value);
    if (part.type === 'percent') return r(D(of).times(part.value).dividedBy(100));
    return D(0);
  };
  const operations = amount(band.operations, base);
  const remaining = D(base).minus(operations);
  let staff = band.staff.type === 'remainder' ? null : amount(band.staff, remaining);
  let profit = band.profit.type === 'remainder' ? null : amount(band.profit, remaining);
  if (staff === null) staff = remaining.minus(profit);
  if (profit === null) profit = remaining.minus(staff);
  return { operations, remaining, staff, profit, total: operations.plus(staff).plus(profit) };
}

/** Problems with a rule, as [{ field, message }] (empty when it is valid). */
function validateRule(raw, { decimals = 0 } = {}) {
  const errors = [];
  if (!raw || !METHODS.includes(raw.method)) errors.push({ field: 'method', message: 'Choose how this service is calculated' });
  const rule = normalizeRule(raw);
  if (rule.method !== 'bands') return errors;
  if (!rule.bands.length) errors.push({ field: 'bands', message: 'Add at least one price band' });
  const sorted = [...rule.bands].map((b, i) => ({ ...b, index: i })).sort((a, b) => a.min - b.min);
  sorted.forEach((band, n) => {
    const at = `bands.${band.index}`;
    if (!Number.isFinite(band.min) || !Number.isFinite(band.max) || band.min < 0 || band.max < band.min) {
      errors.push({ field: `${at}.min`, message: `Band ${n + 1}: the lowest price must be 0 or more and not above the highest` });
      return;
    }
    if (n > 0 && band.min <= sorted[n - 1].max) errors.push({ field: `${at}.min`, message: `Band ${bandName(band)} overlaps band ${bandName(sorted[n - 1])}` });
    if (band.general) return;
    for (const key of ['operations', 'staff', 'profit']) {
      const part = band[key];
      if (!PART_TYPES[key].includes(part.type)) errors.push({ field: `${at}.${key}`, message: `${PART_LABELS[key]} cannot be "${part.type}"` });
      if ((part.type === 'fixed' || part.type === 'percent') && (!Number.isFinite(part.value) || part.value < 0)) {
        errors.push({ field: `${at}.${key}`, message: `${PART_LABELS[key]}: enter an amount of 0 or more` });
      }
      if (part.type === 'percent' && part.value > 100) errors.push({ field: `${at}.${key}`, message: `${PART_LABELS[key]}: a percentage cannot be above 100` });
    }
    const remainders = ['staff', 'profit'].filter((k) => band[k].type === 'remainder').length;
    if (remainders > 1) errors.push({ field: `${at}.profit`, message: `Band ${bandName(band)}: only one part can take the remainder` });
    if (remainders === 0) {
      // Without a remainder the parts must add up exactly, so the band must be one price.
      if (band.min !== band.max) {
        errors.push({ field: `${at}.max`, message: `Band ${bandName(band)}: make staff or salon profit "the remainder", or use a single price (lowest = highest)` });
      } else if (rule.productCost === 'deduct' && rule.productsIncluded) {
        errors.push({ field: 'productCost', message: `Band ${bandName(band)} has only fixed amounts, so product cost cannot be deducted (set product cost to "not deducted")` });
      } else {
        const parts = allocateParts(band, D(band.min), decimals);
        if (!parts.total.equals(band.min)) {
          errors.push({ field: `${at}.operations`, message: `Band ${bandName(band)}: the parts add up to ${fmt(parts.total.toNumber())}, not ${fmt(band.min)}` });
        }
      }
    }
  });
  return errors;
}

/**
 * The full money split of one service sold at `price`.
 * @param {object} args
 * @param {number} args.price         amount charged for the service (after discounts)
 * @param {number} args.productCost   cost of the products used (deducted only when the rule says so)
 * @param {number} args.staffCount    people who performed it
 * @param {object} args.rule          the service's rule (normalised or raw)
 * @param {object} args.generalRates  { operations, employee, profit } for the general formula
 * @param {string} [args.serviceName] for error messages
 * @param {number} [args.decimals=0]  currency precision
 */
function calculateServiceFinancials({ price, productCost = 0, staffCount, rule: raw, generalRates, serviceName = 'this service', decimals = 0 }) {
  const rule = normalizeRule(raw || GENERAL_RULE);
  const servicePrice = round(price, decimals);
  if (servicePrice.lessThan(0)) throw new FinancialRuleError('invalid', 'The service price cannot be negative');
  if (rule.method === 'unconfigured') {
    throw new FinancialRuleError('unconfigured', `${serviceName} has no financial rule yet. An administrator must set it up under Services before it can be sold or imported.`);
  }
  const consumption = round(productCost || 0, decimals);
  const deducted = deductsProducts(rule) ? consumption : D(0);

  let band = null;
  let method = rule.method;
  let general = rule.method === 'general';
  if (rule.method === 'bands') {
    band = findBand(rule, servicePrice);
    if (!band) {
      const offered = rule.bands.map(bandName).join(', ');
      throw new FinancialRuleError('no_band', `${serviceName} has no financial rule for ${fmt(servicePrice.toNumber())}. Configured prices: ${offered || 'none'}.`);
    }
    general = Boolean(band.general);
    method = general ? 'band_general' : 'band';
  }

  let result;
  if (general) {
    result = splitService({ price: servicePrice, productCost: deducted, rates: generalRates, staffCount, rule: rule.staffSplit, decimals });
  } else {
    const base = servicePrice.minus(deducted);
    const parts = allocateParts(band, base, decimals);
    if ([parts.operations, parts.staff, parts.profit].some((v) => v.lessThan(0))) {
      throw new FinancialRuleError('unbalanced', `The rule for ${serviceName} at ${fmt(servicePrice.toNumber())} leaves a negative amount. Check the band ${bandName(band)}.`);
    }
    if (!parts.total.equals(base)) {
      throw new FinancialRuleError('unbalanced', `The rule for ${serviceName} at ${fmt(servicePrice.toNumber())} allocates ${fmt(parts.total.toNumber())} of ${fmt(base.toNumber())}. Ask an administrator to correct the band ${bandName(band)}.`);
    }
    const people = Math.max(0, Number(staffCount) || 0);
    result = {
      price: servicePrice,
      productCost: deducted,
      afterProducts: base,
      operations: parts.operations,
      distributable: parts.remaining,
      staffPool: parts.staff,
      salonProfit: parts.profit,
      staffShares: people ? splitEvenly(parts.staff, people, decimals) : [],
      rates: null,
      rule: rule.staffSplit,
      marginStatus: base.greaterThan(0) ? 'positive' : base.isZero() ? 'zero' : 'negative',
      needsReview: !base.greaterThan(0),
    };
  }

  // Every shilling accounted for, always.
  const allocated = result.productCost.plus(result.operations).plus(result.staffPool).plus(result.salonProfit);
  if (!allocated.equals(result.price)) {
    throw new FinancialRuleError('unbalanced', `The split of ${serviceName} does not add up (${fmt(allocated.toNumber())} of ${fmt(result.price.toNumber())}).`);
  }
  const shared = result.staffShares.reduce((sum, s) => sum.plus(s), D(0));
  if (result.staffShares.length && !shared.equals(result.staffPool)) {
    throw new FinancialRuleError('unbalanced', `The staff shares of ${serviceName} do not add up to the staff pool.`);
  }

  return {
    ...result,
    consumptionCost: consumption,
    unallocated: D(0),
    method,
    band: band ? { min: band.min, max: band.max, label: bandName(band) } : null,
    // What was applied, stored with the sale so it can be shown and recalculated later.
    snapshot: {
      method,
      productCost: rule.productCost,
      productsIncluded: rule.productsIncluded,
      staffSplit: rule.staffSplit,
      band: band || null,
      rates: general ? { operations: Number(generalRates.operations), employee: Number(generalRates.employee), profit: Number(generalRates.profit) } : null,
    },
  };
}

/** Rebuild the rule a stored sale was calculated with (for corrections). */
function ruleFromSnapshot(snapshot) {
  if (!snapshot || snapshot.method === 'general' || !snapshot.band) {
    return { rule: { ...GENERAL_RULE, productCost: snapshot?.productCost || 'deduct', productsIncluded: snapshot?.productsIncluded !== false }, rates: snapshot?.rates };
  }
  return {
    rule: { method: 'bands', productCost: snapshot.productCost, productsIncluded: snapshot.productsIncluded, staffSplit: 'equal', bands: [snapshot.band] },
    rates: snapshot.rates,
  };
}

module.exports = {
  METHODS, GENERAL_RULE, FinancialRuleError, normalizeRule, validateRule, deductsProducts, findBand, bandName, calculateServiceFinancials, ruleFromSnapshot,
};
