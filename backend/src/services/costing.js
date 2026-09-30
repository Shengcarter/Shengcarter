'use strict';

const { D, round } = require('../utils/money');
const { splitEvenly } = require('./pricing');

/**
 * Service costing: how the money from one completed service is split.
 * Pure functions, no database access (tests/costing.test.js).
 *
 *   price                  what the customer was charged for the service
 * − product cost           actual products used × the salon's recorded cost
 * = amount after products
 * − operations             operationsRate % of the amount after products
 * = distributable amount
 *   → staff pool           employeeRate % of the distributable amount, shared by the staff
 *   → salon profit         profitRate % of it (takes the rounding remainder)
 *
 * With the default 30 / 50 / 50 rules, what is left after products is split
 * 30% operations, 35% staff, 35% salon. Product cost is ALWAYS taken off
 * before staff or salon get anything.
 *
 * Amounts are rounded to the currency precision (whole shillings for TZS)
 * with ROUND_HALF_UP, and the parts always add up to the price exactly:
 *   product cost + operations + staff pool + salon profit = price.
 *
 * Zero or negative margin (products cost as much as, or more than, the price):
 * operations and staff get nothing, never a negative amount. A negative margin
 * is a loss the salon carries (salon profit below zero) and the service is
 * flagged so an authorised person reviews it.
 */

const SPLIT_RULES = ['equal'];

/** Validate the configured percentages: staff + salon must be 100% of what is left after operations. */
function validateRates({ operations, employee, profit }) {
  for (const [name, value] of Object.entries({ operations, employee, profit })) {
    const v = D(value);
    if (!v.isFinite() || v.lessThan(0) || v.greaterThan(100)) throw new RangeError(`The ${name} percentage must be between 0 and 100`);
  }
  if (!D(employee).plus(profit).equals(100)) {
    throw new RangeError('The staff and salon profit percentages must add up to 100%');
  }
}

/**
 * Cost of the products used. Each line is quantity × unit cost rounded to the
 * currency precision; the total is the sum of the rounded lines, so the lines
 * shown on a breakdown always add up to its total.
 * @param {{ quantity, unitCost }[]} items
 */
function productCost(items, decimals = 0) {
  let total = D(0);
  const lines = items.map((item) => {
    const quantity = D(item.quantity);
    const unitCost = D(item.unitCost);
    if (quantity.lessThan(0)) throw new RangeError('A product quantity cannot be negative');
    if (unitCost.lessThan(0)) throw new RangeError('A product cost cannot be negative');
    const cost = round(quantity.times(unitCost), decimals);
    total = total.plus(cost);
    return { ...item, cost };
  });
  return { lines, total };
}

/**
 * The full money split for one service.
 * @param {object} args
 * @param {number|string} args.price        amount charged for the service (after any discount)
 * @param {number|string} args.productCost  total cost of the products used
 * @param {{ operations, employee, profit }} args.rates  percentages
 * @param {number} args.staffCount          people who performed the service
 * @param {string} [args.rule='equal']      how the staff pool is shared
 * @param {number} [args.decimals=0]        currency precision
 */
function splitService({ price, productCost: cost, rates, staffCount, rule = 'equal', decimals = 0 }) {
  validateRates(rates);
  if (!SPLIT_RULES.includes(rule)) throw new RangeError(`Unknown staff split rule: ${rule}`);
  const r = (v) => round(v, decimals);
  const servicePrice = r(price);
  const products = r(cost);
  if (servicePrice.lessThan(0)) throw new RangeError('The service price cannot be negative');
  if (products.lessThan(0)) throw new RangeError('The product cost cannot be negative');

  const afterProducts = servicePrice.minus(products);
  const marginStatus = afterProducts.greaterThan(0) ? 'positive' : afterProducts.isZero() ? 'zero' : 'negative';

  let operations = D(0);
  let distributable = D(0);
  let staffPool = D(0);
  let salonProfit = afterProducts; // a loss when the margin is negative
  if (marginStatus === 'positive') {
    operations = r(afterProducts.times(rates.operations).dividedBy(100));
    distributable = afterProducts.minus(operations);
    staffPool = r(distributable.times(rates.employee).dividedBy(100));
    salonProfit = distributable.minus(staffPool);
  }

  const people = Math.max(0, Number(staffCount) || 0);
  const shares = people ? splitEvenly(staffPool, people, decimals) : [];

  return {
    price: servicePrice,
    productCost: products,
    afterProducts,
    operations,
    distributable,
    staffPool,
    salonProfit,
    staffShares: shares,
    rates: { operations: Number(rates.operations), employee: Number(rates.employee), profit: Number(rates.profit) },
    rule,
    marginStatus,
    needsReview: marginStatus !== 'positive',
  };
}

module.exports = { SPLIT_RULES, validateRates, productCost, splitService };
