'use strict';

const { calculateTotals, applyPayments, commissionFor, splitEvenly, shareServiceLine } = require('../src/services/pricing');
const { toNumber } = require('../src/utils/money');

const line = (unitPrice, quantity = 1, extra = {}) => ({ type: 'service', unitPrice, quantity, ...extra });
const n = (d) => toNumber(d, 2);

describe('financial calculations', () => {
  test('exclusive tax is added after discounts', () => {
    const t = calculateTotals({ lines: [line(15000), line(25000), line(9000)], discount: { type: 'percentage', value: 10 }, tax: { mode: 'exclusive', rate: 18 }, decimals: 0 });
    expect(n(t.subtotal)).toBe(49000);
    expect(n(t.discountAmount)).toBe(4900);
    expect(n(t.taxable)).toBe(44100);
    expect(n(t.taxAmount)).toBe(7938);
    expect(n(t.total)).toBe(52038);
  });

  test('inclusive tax is extracted from the total, not added', () => {
    const t = calculateTotals({ lines: [line(11800)], discount: { type: 'none', value: 0 }, tax: { mode: 'inclusive', rate: 18 }, decimals: 0 });
    expect(n(t.total)).toBe(11800);
    expect(n(t.taxAmount)).toBe(1800);
  });

  test('no tax mode charges the discounted subtotal', () => {
    const t = calculateTotals({ lines: [line(10000, 2)], discount: { type: 'amount', value: 3000 }, tax: { mode: 'none', rate: 18 }, decimals: 0 });
    expect(n(t.total)).toBe(17000);
    expect(n(t.taxAmount)).toBe(0);
  });

  test('invoice discounts are allocated to lines and add up exactly', () => {
    const t = calculateTotals({ lines: [line(10000), line(10000), line(10000)], discount: { type: 'amount', value: 1000 }, tax: { mode: 'none', rate: 0 }, decimals: 0 });
    const allocated = t.lines.reduce((sum, l) => sum + n(l.netAmount), 0);
    expect(allocated).toBe(29000);
  });

  test('loyalty discount is applied after the invoice discount', () => {
    const t = calculateTotals({ lines: [line(20000)], discount: { type: 'amount', value: 2000 }, loyaltyDiscount: 1000, tax: { mode: 'none', rate: 0 }, decimals: 0 });
    expect(n(t.total)).toBe(17000);
  });

  test('money is rounded half-up without floating point drift', () => {
    const t = calculateTotals({ lines: [line(0.1, 3)], discount: { type: 'none', value: 0 }, tax: { mode: 'exclusive', rate: 18 }, decimals: 2 });
    expect(n(t.subtotal)).toBe(0.3);
    expect(n(t.taxAmount)).toBe(0.05); // 0.054 → 0.05
    expect(n(t.total)).toBe(0.35);
  });

  test('discounts larger than the subtotal are rejected', () => {
    expect(() => calculateTotals({ lines: [line(5000)], discount: { type: 'amount', value: 6000 }, tax: { mode: 'none', rate: 0 }, decimals: 0 })).toThrow(RangeError);
    expect(() => calculateTotals({ lines: [line(5000)], discount: { type: 'percentage', value: 120 }, tax: { mode: 'none', rate: 0 }, decimals: 0 })).toThrow(RangeError);
  });

  test('cash overpayment gives change; balance is what remains unpaid', () => {
    const paid = applyPayments({ total: 52038, payments: [{ method: 'cash', amount: 100000 }], decimals: 0 });
    expect(n(paid.change)).toBe(47962);
    expect(n(paid.amountPaid)).toBe(52038);
    expect(n(paid.balance)).toBe(0);
    expect(paid.status).toBe('paid');

    const partial = applyPayments({ total: 50000, payments: [{ method: 'mobile_money', amount: 20000 }], decimals: 0 });
    expect(n(partial.balance)).toBe(30000);
    expect(partial.status).toBe('partial');
  });

  test('change can only come from cash', () => {
    expect(() => applyPayments({ total: 10000, payments: [{ method: 'card', amount: 15000 }], decimals: 0 })).toThrow(RangeError);
    const split = applyPayments({ total: 10000, payments: [{ method: 'card', amount: 6000 }, { method: 'cash', amount: 5000 }], decimals: 0 });
    expect(n(split.change)).toBe(1000);
  });

  test('commission is a percentage of the net service amount', () => {
    expect(n(commissionFor(13500, 12, 0))).toBe(1620);
    expect(n(commissionFor(0, 12, 0))).toBe(0);
  });

  test('shares split an amount exactly, the remainder one unit at a time', () => {
    const nums = (list) => list.map((d) => n(d));
    expect(nums(splitEvenly(10000, 3, 0))).toEqual([3334, 3333, 3333]);
    expect(nums(splitEvenly(10001, 2, 0))).toEqual([5001, 5000]);
    expect(nums(splitEvenly(100.05, 2, 2))).toEqual([50.03, 50.02]);
    expect(nums(splitEvenly(7, 1, 0))).toEqual([7]);
    for (const [amount, parts] of [[99999, 7], [1, 3], [123457, 6]]) {
      expect(nums(splitEvenly(amount, parts, 0)).reduce((a, b) => a + b, 0)).toBe(amount);
    }
  });

  test('a shared service splits its commission equally, or applies each person\'s own rate', () => {
    const withRate = shareServiceLine({ netAmount: 45000, serviceRate: 10, staff: [{ id: 1, commissionRate: 40 }, { id: 2, commissionRate: 5 }], decimals: 0 });
    expect(withRate.shares.map((s) => [s.employeeId, n(s.revenueShare), s.rate, n(s.commission)])).toEqual([[1, 22500, 10, 2250], [2, 22500, 10, 2250]]);
    expect(n(withRate.commission)).toBe(4500);
    const ownRates = shareServiceLine({ netAmount: 30000, serviceRate: null, staff: [{ id: 1, commissionRate: 40 }, { id: 2, commissionRate: 20 }], decimals: 0 });
    expect(ownRates.shares.map((s) => n(s.commission))).toEqual([6000, 3000]);
    expect(ownRates.rate).toBe(30);
    expect(shareServiceLine({ netAmount: 5000, serviceRate: 10, staff: [], decimals: 0 }).shares).toEqual([]);
  });
});

