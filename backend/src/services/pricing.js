'use strict';

const { D, round } = require('../utils/money');

/**
 * Pure POS pricing. No database access, so it is fully unit-tested
 * (tests/pricing.test.js). The server always recomputes totals here and never
 * trusts amounts sent by the browser.
 *
 * Order of operations:
 *   subtotal        = Σ round(unitPrice × quantity)
 *   discount        = percentage of subtotal, or a fixed amount (capped)
 *   loyaltyDiscount = value of redeemed points (capped at what remains)
 *   taxable         = subtotal − discount − loyaltyDiscount
 *   tax             = exclusive: taxable × rate
 *                     inclusive: taxable × rate / (100 + rate)   (already inside the price)
 *   total           = exclusive: taxable + tax;  inclusive / none: taxable
 * Each line's net amount is its share of `taxable` (the last line absorbs the
 * rounding remainder, so line nets always add up exactly).
 */

function calculateTotals({ lines, discount = { type: 'none', value: 0 }, loyaltyDiscount = 0, tax = { mode: 'none', rate: 0 }, decimals = 2 }) {
  const r = (v) => round(v, decimals);

  const priced = lines.map((line) => ({ ...line, lineTotal: r(D(line.unitPrice).times(line.quantity)) }));
  const subtotal = priced.reduce((sum, l) => sum.plus(l.lineTotal), D(0));

  let discountAmount = D(0);
  if (discount.type === 'percentage') {
    const percent = D(discount.value || 0);
    if (percent.lessThan(0) || percent.greaterThan(100)) throw new RangeError('Discount percentage must be between 0 and 100');
    discountAmount = r(subtotal.times(percent).dividedBy(100));
  } else if (discount.type === 'amount') {
    discountAmount = r(D(discount.value || 0));
    if (discountAmount.lessThan(0)) throw new RangeError('Discount cannot be negative');
    if (discountAmount.greaterThan(subtotal)) throw new RangeError('Discount cannot be larger than the subtotal');
  }

  const afterDiscount = subtotal.minus(discountAmount);
  const loyalty = r(D(loyaltyDiscount || 0));
  if (loyalty.greaterThan(afterDiscount)) throw new RangeError('Loyalty discount cannot be larger than the amount due');
  const taxable = afterDiscount.minus(loyalty);

  const rate = D(tax.rate || 0);
  let taxAmount = D(0);
  let total = taxable;
  if (tax.mode === 'exclusive' && rate.greaterThan(0)) {
    taxAmount = r(taxable.times(rate).dividedBy(100));
    total = taxable.plus(taxAmount);
  } else if (tax.mode === 'inclusive' && rate.greaterThan(0)) {
    taxAmount = r(taxable.times(rate).dividedBy(D(100).plus(rate)));
  }

  // Allocate `taxable` across lines proportionally to their line totals.
  let allocated = D(0);
  const withNet = priced.map((line, index) => {
    let net;
    if (index === priced.length - 1) net = taxable.minus(allocated);
    else net = subtotal.isZero() ? D(0) : r(taxable.times(line.lineTotal).dividedBy(subtotal));
    allocated = allocated.plus(net);
    return { ...line, netAmount: net };
  });

  return {
    lines: withNet,
    subtotal,
    discountAmount,
    loyaltyDiscount: loyalty,
    taxable,
    taxAmount,
    total: r(total),
  };
}

/**
 * Apply tendered payments to a total.
 * Cash may exceed the amount due (change is given); card, mobile money and
 * bank transfer may not, since change can only be handed back in cash.
 */
function applyPayments({ total, payments, decimals = 2 }) {
  const r = (v) => round(v, decimals);
  const due = D(total);
  const tendered = payments.reduce((sum, p) => sum.plus(r(p.amount)), D(0));
  const cash = payments.filter((p) => p.method === 'cash').reduce((sum, p) => sum.plus(r(p.amount)), D(0));
  const nonCash = tendered.minus(cash);

  if (payments.some((p) => D(p.amount).lessThan(0))) throw new RangeError('Payment amounts cannot be negative');
  if (nonCash.greaterThan(due)) throw new RangeError('Card, mobile money and bank payments cannot exceed the amount due');

  const change = tendered.greaterThan(due) ? tendered.minus(due) : D(0);
  if (change.greaterThan(cash)) throw new RangeError('Change can only be given from a cash payment');
  const amountPaid = tendered.minus(change);
  const balance = due.minus(amountPaid);

  // Payment rows store the amount actually kept: change comes out of cash.
  let changeLeft = change;
  const applied = [...payments]
    .map((p) => ({ ...p, amount: r(p.amount) }))
    .reverse()
    .map((p) => {
      if (p.method === 'cash' && changeLeft.greaterThan(0)) {
        const take = Math.min(p.amount.toNumber(), changeLeft.toNumber());
        changeLeft = changeLeft.minus(take);
        return { ...p, amount: p.amount.minus(take) };
      }
      return p;
    })
    .reverse()
    .filter((p) => p.amount.greaterThan(0));

  return {
    tendered,
    amountPaid,
    change,
    balance,
    status: balance.lessThanOrEqualTo(0) ? 'paid' : amountPaid.greaterThan(0) ? 'partial' : 'unpaid',
    payments: applied,
  };
}

/** Commission on a line's net amount (after discounts, before tax). */
function commissionFor(netAmount, rate, decimals = 2) {
  return round(D(netAmount).times(D(rate || 0)).dividedBy(100), decimals);
}

module.exports = { calculateTotals, applyPayments, commissionFor };
