'use strict';

const { calculateServiceFinancials, validateRule, FinancialRuleError, normalizeRule, ruleFromSnapshot } = require('../src/services/financialRules');

/**
 * Per-service financial rules: Kufumua, Steaming and Relaxer exactly as
 * specified, the general formula, several stylists, rounding, and refusals
 * (no guessing between configured prices, nothing that does not add up).
 */
const GENERAL_RATES = { operations: 30, employee: 50, profit: 50 };
const fixed = (value) => ({ type: 'fixed', value });
const REMAINDER = { type: 'remainder' };
const NONE = { type: 'none' };

const KUFUMUA = {
  method: 'bands', productCost: 'none', productsIncluded: true, staffSplit: 'equal',
  bands: [
    { min: 2000, max: 5000, operations: fixed(1000), staff: REMAINDER, profit: NONE },
    { min: 6000, max: 10000, operations: fixed(2000), staff: REMAINDER, profit: NONE },
    { min: 11000, max: 20000, general: true },
  ],
};
const point = (price, operations, staff, profit) => ({ min: price, max: price, operations: fixed(operations), staff: fixed(staff), profit: fixed(profit) });
const STEAMING = {
  method: 'bands', productCost: 'none', productsIncluded: true, staffSplit: 'equal',
  bands: [point(10000, 4000, 3000, 3000), point(15000, 6000, 3000, 6000), point(20000, 9000, 3000, 8000), point(25000, 10000, 4000, 11000)],
};
const RELAXER = {
  method: 'bands', productCost: 'none', productsIncluded: true, staffSplit: 'equal',
  bands: [point(10000, 4000, 3000, 3000), point(15000, 6000, 3000, 6000)],
};

const n = (d) => Number(d.toString());
const calc = (rule, price, staffCount = 1, productCost = 0) => calculateServiceFinancials({
  price, productCost, staffCount, rule, generalRates: GENERAL_RATES, serviceName: 'Test service', decimals: 0,
});
const parts = (r) => ({ price: n(r.price), productCost: n(r.productCost), operations: n(r.operations), staff: n(r.staffPool), profit: n(r.salonProfit) });
const balances = (r) => n(r.productCost) + n(r.operations) + n(r.staffPool) + n(r.salonProfit) === n(r.price);

describe('Kufumua', () => {
  test.each([
    [2000, 1000, 1000],
    [3000, 1000, 2000],
    [4000, 1000, 3000],
    [5000, 1000, 4000],
  ])('%i: fixed 1,000 operations, the rest to the stylist pool, no salon profit', (price, operations, staff) => {
    const r = calc(KUFUMUA, price);
    expect(parts(r)).toEqual({ price, productCost: 0, operations, staff, profit: 0 });
    expect(r.method).toBe('band');
    expect(balances(r)).toBe(true);
  });

  test.each([
    [6000, 2000, 4000],
    [8000, 2000, 6000],
    [10000, 2000, 8000],
  ])('%i: fixed 2,000 operations, the rest to the stylist pool, no salon profit', (price, operations, staff) => {
    const r = calc(KUFUMUA, price);
    expect(parts(r)).toEqual({ price, productCost: 0, operations, staff, profit: 0 });
    expect(balances(r)).toBe(true);
  });

  test.each([
    [11000, 3300, 3850, 3850],
    [20000, 6000, 7000, 7000],
  ])('%i: the general formula with no product cost', (price, operations, staff, profit) => {
    const r = calc(KUFUMUA, price);
    expect(parts(r)).toEqual({ price, productCost: 0, operations, staff, profit });
    expect(r.method).toBe('band_general');
    expect(r.snapshot.rates).toEqual(GENERAL_RATES);
    expect(balances(r)).toBe(true);
  });

  test('products used are never deducted from Kufumua', () => {
    const r = calc(KUFUMUA, 20000, 1, 5000);
    expect(parts(r)).toEqual({ price: 20000, productCost: 0, operations: 6000, staff: 7000, profit: 7000 });
    expect(n(r.consumptionCost)).toBe(5000); // recorded for stock reports only
  });

  test('several stylists share the pool equally, to the shilling', () => {
    expect(calc(KUFUMUA, 5000, 1).staffShares.map(n)).toEqual([4000]);
    expect(calc(KUFUMUA, 5000, 2).staffShares.map(n)).toEqual([2000, 2000]);
    expect(calc(KUFUMUA, 5000, 3).staffShares.map(n)).toEqual([1334, 1333, 1333]); // 4,000 ÷ 3
  });

  test('prices between the bands are refused, not guessed', () => {
    for (const price of [1000, 5500, 10500, 21000]) {
      expect(() => calc(KUFUMUA, price)).toThrow(FinancialRuleError);
    }
    try {
      calc(KUFUMUA, 5500);
    } catch (error) {
      expect(error.code).toBe('no_band');
      expect(error.message).toMatch(/no financial rule for 5,500.*2,000–5,000, 6,000–10,000, 11,000–20,000/);
    }
  });
});

describe('Steaming', () => {
  test.each([
    [10000, 4000, 3000, 3000],
    [15000, 6000, 3000, 6000],
    [20000, 9000, 3000, 8000],
    [25000, 10000, 4000, 11000],
  ])('%i: operations %i, stylist pool %i, salon profit %i exactly', (price, operations, staff, profit) => {
    const r = calc(STEAMING, price);
    expect(parts(r)).toEqual({ price, productCost: 0, operations, staff, profit });
    expect(balances(r)).toBe(true);
  });

  test('1, 2 and 3 stylists share the 3,000 pool equally', () => {
    expect(calc(STEAMING, 10000, 1).staffShares.map(n)).toEqual([3000]);
    expect(calc(STEAMING, 10000, 2).staffShares.map(n)).toEqual([1500, 1500]);
    expect(calc(STEAMING, 10000, 3).staffShares.map(n)).toEqual([1000, 1000, 1000]);
    expect(calc(STEAMING, 25000, 3).staffShares.map(n)).toEqual([1334, 1333, 1333]); // 4,000 ÷ 3
  });

  test('prices between the configured points are refused (no invented rule)', () => {
    for (const price of [12000, 17500, 22000, 30000, 5000]) expect(() => calc(STEAMING, price)).toThrow(/no financial rule/);
  });
});

describe('Relaxer', () => {
  test.each([
    [10000, 4000, 3000, 3000],
    [15000, 6000, 3000, 6000],
  ])('%i: operations %i, stylist %i, salon profit %i', (price, operations, staff, profit) => {
    const r = calc(RELAXER, price);
    expect(parts(r)).toEqual({ price, productCost: 0, operations, staff, profit });
    expect(balances(r)).toBe(true);
  });

  test('the pool is shared equally and nothing in between is invented', () => {
    expect(calc(RELAXER, 15000, 2).staffShares.map(n)).toEqual([1500, 1500]);
    expect(() => calc(RELAXER, 12000)).toThrow(/no financial rule for 12,000/);
  });
});

describe('the general formula and other rules', () => {
  test('services on the general formula still deduct the products used', () => {
    const r = calc({ method: 'general' }, 50000, 1, 12000);
    expect(parts(r)).toEqual({ price: 50000, productCost: 12000, operations: 11400, staff: 13300, profit: 13300 });
    expect(r.method).toBe('general');
  });

  test('a price that already includes products: 400,000 with 50,000 of products is not charged extra', () => {
    const r = calc({ method: 'general' }, 400000, 1, 50000);
    expect(n(r.price)).toBe(400000);
    expect(n(r.afterProducts)).toBe(350000);
    expect(parts(r)).toEqual({ price: 400000, productCost: 50000, operations: 105000, staff: 122500, profit: 122500 });
  });

  test('products sold separately (not included in the price) are not deducted', () => {
    const r = calc({ method: 'general', productsIncluded: false }, 50000, 1, 12000);
    expect(n(r.productCost)).toBe(0);
    expect(n(r.operations)).toBe(15000);
  });

  test('an unconfigured service (Kubana Nyuele) cannot be calculated', () => {
    expect(() => calc({ method: 'unconfigured' }, 30000)).toThrow(/has no financial rule yet/);
    try {
      calc({ method: 'unconfigured' }, 30000);
    } catch (error) {
      expect(error.code).toBe('unconfigured');
    }
  });

  test('percentages and remainders: operations 25%, staff 40% of the rest, salon the remainder', () => {
    const rule = { method: 'bands', productCost: 'deduct', bands: [{ min: 1000, max: 100000, operations: { type: 'percent', value: 25 }, staff: { type: 'percent', value: 40 }, profit: REMAINDER }] };
    const r = calc(rule, 50001, 3, 1);
    expect(parts(r)).toEqual({ price: 50001, productCost: 1, operations: 12500, staff: 15000, profit: 22500 });
    expect(r.staffShares.map(n)).toEqual([5000, 5000, 5000]);
  });

  test('a split that does not add up is refused', () => {
    const broken = { method: 'bands', productCost: 'none', bands: [point(10000, 4000, 3000, 2000)] };
    expect(() => calc(broken, 10000)).toThrow(/allocates 9,000 of 10,000/);
    const negative = { method: 'bands', productCost: 'none', bands: [{ min: 500, max: 5000, operations: fixed(1000), staff: REMAINDER, profit: NONE }] };
    expect(() => calc(negative, 500)).toThrow(/negative amount/);
  });

  test('rounding never loses or creates a shilling', () => {
    for (const [price, people] of [[11111, 3], [19999, 7], [13333, 6], [20000, 3]]) {
      const r = calc(KUFUMUA, price, people);
      expect(balances(r)).toBe(true);
      expect(r.staffShares.map(n).reduce((a, b) => a + b, 0)).toBe(n(r.staffPool));
    }
    for (const price of [2000, 3333, 4999, 7777, 9999]) {
      const r = calc(KUFUMUA, price, 3);
      expect(r.staffShares.map(n).reduce((a, b) => a + b, 0)).toBe(n(r.staffPool));
    }
  });

  test('a stored snapshot recalculates the same way later', () => {
    const r = calc(STEAMING, 20000, 2);
    const { rule, rates } = ruleFromSnapshot(r.snapshot);
    const again = calculateServiceFinancials({ price: 20000, staffCount: 2, rule, generalRates: rates, decimals: 0 });
    expect(parts(again)).toEqual(parts(r));
    const g = calc(KUFUMUA, 20000);
    const back = ruleFromSnapshot(g.snapshot);
    expect(parts(calculateServiceFinancials({ price: 20000, staffCount: 1, rule: back.rule, generalRates: back.rates, decimals: 0 }))).toEqual(parts(g));
  });
});

describe('rule validation', () => {
  test('the three service rules are valid', () => {
    expect(validateRule(KUFUMUA)).toEqual([]);
    expect(validateRule(STEAMING)).toEqual([]);
    expect(validateRule(RELAXER)).toEqual([]);
    expect(validateRule({ method: 'unconfigured' })).toEqual([]);
  });

  test('overlaps, missing remainders, wrong totals and impossible deductions are explained', () => {
    const msgs = (rule) => validateRule(rule).map((e) => e.message).join(' | ');
    expect(msgs({ method: 'bands', bands: [] })).toMatch(/at least one price band/);
    expect(msgs({ method: 'bands', productCost: 'none', bands: [{ min: 1000, max: 5000, general: true }, { min: 4000, max: 9000, general: true }] })).toMatch(/overlaps/);
    expect(msgs({ method: 'bands', productCost: 'none', bands: [{ min: 1000, max: 5000, operations: fixed(500), staff: fixed(500), profit: fixed(0) }] })).toMatch(/single price/);
    expect(msgs({ method: 'bands', productCost: 'none', bands: [point(10000, 4000, 3000, 2000)] })).toMatch(/add up to 9,000, not 10,000/);
    expect(msgs({ method: 'bands', productCost: 'deduct', bands: [point(10000, 4000, 3000, 3000)] })).toMatch(/product cost cannot be deducted/);
    expect(msgs({ method: 'bands', productCost: 'none', bands: [{ min: 1, max: 9, operations: fixed(1), staff: REMAINDER, profit: REMAINDER }] })).toMatch(/only one part/);
    expect(msgs({ method: 'bands', productCost: 'none', bands: [{ min: 1, max: 9, operations: REMAINDER, staff: REMAINDER, profit: NONE }] })).toMatch(/Operations cannot be "remainder"/);
    expect(msgs({ method: 'nonsense' })).toMatch(/Choose how/);
    expect(normalizeRule({}).method).toBe('general');
  });
});
