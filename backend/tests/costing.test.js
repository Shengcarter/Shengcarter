'use strict';

const { productCost, splitService, validateRates } = require('../src/services/costing');

const RATES = { operations: 30, employee: 50, profit: 50 };
const n = (d) => Number(d.toString());
const split = (price, cost, staffCount = 1, rates = RATES) => splitService({ price, productCost: cost, rates, staffCount, decimals: 0 });
// Every breakdown must account for the whole price.
const balances = (b) => n(b.productCost.plus(b.operations).plus(b.staffPool).plus(b.salonProfit)) === n(b.price);

describe('service costing: price − products → 30% operations → 50/50 staff and salon', () => {
  test('Test 1 — standard service: Box Braids 50,000 with 12,000 of products', () => {
    const products = productCost([
      { name: 'Synthetic hair', quantity: 2, unitCost: 5000 },
      { name: 'Jelly (ml)', quantity: 100, unitCost: 20 },
    ], 0);
    expect(products.lines.map((l) => n(l.cost))).toEqual([10000, 2000]);
    expect(n(products.total)).toBe(12000);

    const b = split(50000, products.total);
    expect(n(b.productCost)).toBe(12000);
    expect(n(b.afterProducts)).toBe(38000);
    expect(n(b.operations)).toBe(11400);
    expect(n(b.distributable)).toBe(26600);
    expect(n(b.staffPool)).toBe(13300);
    expect(n(b.salonProfit)).toBe(13300);
    expect(b.staffShares.map(n)).toEqual([13300]);
    expect(b.marginStatus).toBe('positive');
    expect(b.needsReview).toBe(false);
    // 12,000 + 11,400 + 13,300 + 13,300 = 50,000
    expect(balances(b)).toBe(true);
  });

  test('Test 2 — no product cost', () => {
    const b = split(50000, 0);
    expect(n(b.afterProducts)).toBe(50000);
    expect(n(b.operations)).toBe(15000);
    expect(n(b.staffPool)).toBe(17500);
    expect(n(b.salonProfit)).toBe(17500);
    expect(balances(b)).toBe(true);
  });

  test('Test 3 — a different price: 80,000 with 20,000 of products', () => {
    const b = split(80000, 20000);
    expect(n(b.afterProducts)).toBe(60000);
    expect(n(b.operations)).toBe(18000);
    expect(n(b.staffPool)).toBe(21000);
    expect(n(b.salonProfit)).toBe(21000);
    expect(balances(b)).toBe(true);
  });

  test('Test 4 — two stylists share the staff pool equally; salon profit is unchanged', () => {
    const b = split(50000, 12000, 2);
    expect(n(b.staffPool)).toBe(13300);
    expect(b.staffShares.map(n)).toEqual([6650, 6650]);
    expect(n(b.salonProfit)).toBe(13300);
    expect(balances(b)).toBe(true);

    const three = split(50000, 20000, 3); // pool 10,500 → 3,500 each
    expect(three.staffShares.map(n)).toEqual([3500, 3500, 3500]);
  });

  test('Test 5 — product cost equal to the price: everything is zero and it is flagged zero-margin', () => {
    const b = split(50000, 50000);
    expect(n(b.afterProducts)).toBe(0);
    expect(n(b.operations)).toBe(0);
    expect(n(b.staffPool)).toBe(0);
    expect(n(b.salonProfit)).toBe(0);
    expect(b.marginStatus).toBe('zero');
    expect(b.needsReview).toBe(true);
    expect(balances(b)).toBe(true);
  });

  test('Test 6 — product cost above the price: flagged negative, no negative staff pay or operations', () => {
    const b = split(50000, 55000, 2);
    expect(n(b.afterProducts)).toBe(-5000);
    expect(b.marginStatus).toBe('negative');
    expect(b.needsReview).toBe(true);
    expect(n(b.operations)).toBe(0);
    expect(n(b.staffPool)).toBe(0);
    expect(b.staffShares.map(n)).toEqual([0, 0]);
    // The 5,000 loss is carried by the salon and shown, never hidden.
    expect(n(b.salonProfit)).toBe(-5000);
    expect(balances(b)).toBe(true);
  });

  test('rounds to whole shillings and still balances exactly', () => {
    const b = split(10001, 0, 2); // 10,001 → ops 3,000 → 7,001 → staff 3,501 / salon 3,500
    expect(n(b.operations)).toBe(3000);
    expect(n(b.distributable)).toBe(7001);
    expect(n(b.staffPool)).toBe(3501);
    expect(n(b.salonProfit)).toBe(3500);
    expect(b.staffShares.map(n)).toEqual([1751, 1750]);
    expect(balances(b)).toBe(true);

    for (const [price, cost, people] of [[33333, 777, 3], [99999, 12345, 2], [1, 0, 1], [45000, 44999, 3]]) {
      const x = split(price, cost, people);
      expect(balances(x)).toBe(true);
      expect(n(x.staffShares.reduce((s, v) => s.plus(v), x.staffPool.minus(x.staffPool)))).toBe(n(x.staffPool));
    }
  });

  test('product costs use the quantity actually used, fractions included', () => {
    const products = productCost([
      { quantity: 2.5, unitCost: 5000 }, // 2½ packs of hair
      { quantity: 37, unitCost: 20 }, // 37 ml of jelly
      { quantity: 3, unitCost: 33.3333 }, // 3 ml at 10,000 per 300 ml bottle
    ], 0);
    expect(products.lines.map((l) => n(l.cost))).toEqual([12500, 740, 100]);
    expect(n(products.total)).toBe(13340);
    expect(() => productCost([{ quantity: -1, unitCost: 100 }], 0)).toThrow(/negative/);
    expect(() => productCost([{ quantity: 1, unitCost: -100 }], 0)).toThrow(/negative/);
  });

  test('the percentages come from settings, not the code', () => {
    const b = split(50000, 12000, 1, { operations: 25, employee: 40, profit: 60 });
    expect(n(b.operations)).toBe(9500); // 38,000 × 25%
    expect(n(b.staffPool)).toBe(11400); // 28,500 × 40%
    expect(n(b.salonProfit)).toBe(17100); // 28,500 × 60%
    expect(b.rates).toEqual({ operations: 25, employee: 40, profit: 60 });
    expect(balances(b)).toBe(true);
  });

  test('invalid rules and amounts are refused', () => {
    expect(() => validateRates({ operations: 30, employee: 50, profit: 40 })).toThrow(/add up to 100/);
    expect(() => validateRates({ operations: 130, employee: 50, profit: 50 })).toThrow(/between 0 and 100/);
    expect(() => validateRates({ operations: -1, employee: 50, profit: 50 })).toThrow(/between 0 and 100/);
    expect(() => split(-1, 0)).toThrow(/price cannot be negative/);
    expect(() => split(100, -1)).toThrow(/cost cannot be negative/);
    expect(() => splitService({ price: 100, productCost: 0, rates: RATES, staffCount: 1, rule: 'by_seniority' })).toThrow(/Unknown staff split rule/);
  });
});
