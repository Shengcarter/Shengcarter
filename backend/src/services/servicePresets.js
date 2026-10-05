'use strict';

/**
 * Services whose financial rules the salon has confirmed, created (or given
 * their rule) on setup. Amounts in TZS. Kubana Nyuele has no confirmed rule
 * yet, so it is created inactive and "not configured": it cannot be sold or
 * imported until an administrator sets its price and rule.
 *
 * Applied by scripts/seed.js (ensureServiceRules): a missing service is
 * created; an existing one gets the rule only if its rule was never
 * configured by hand (it still has the rule set when rules were introduced).
 */
const fixed = (value) => ({ type: 'fixed', value });
const REMAINDER = { type: 'remainder' };
const NONE = { type: 'none' };
const point = (price, operations, staff, profit) => ({ min: price, max: price, operations: fixed(operations), staff: fixed(staff), profit: fixed(profit) });

const PRESETS = [
  {
    name: 'Kufumua',
    category: 'braiding',
    description: 'Taking out braids or other styles. Priced 2,000–20,000; no product cost.',
    price: 2000,
    maxPrice: 20000,
    duration: 60,
    active: true,
    rule: {
      method: 'bands', productCost: 'none', productsIncluded: true, staffSplit: 'equal',
      bands: [
        { min: 2000, max: 5000, label: '2,000–5,000', operations: fixed(1000), staff: REMAINDER, profit: NONE },
        { min: 6000, max: 10000, label: '6,000–10,000', operations: fixed(2000), staff: REMAINDER, profit: NONE },
        { min: 11000, max: 20000, label: '11,000–20,000', general: true },
      ],
    },
  },
  {
    name: 'Steaming',
    category: 'treatment',
    description: 'Hair steaming. Fixed allocations at 10,000, 15,000, 20,000 and 25,000.',
    price: 10000,
    maxPrice: 25000,
    duration: 45,
    active: true,
    rule: {
      method: 'bands', productCost: 'none', productsIncluded: true, staffSplit: 'equal',
      bands: [point(10000, 4000, 3000, 3000), point(15000, 6000, 3000, 6000), point(20000, 9000, 3000, 8000), point(25000, 10000, 4000, 11000)],
    },
  },
  {
    name: 'Relaxer',
    category: 'treatment',
    description: 'Relaxer application. Fixed allocations at 10,000 and 15,000.',
    price: 10000,
    maxPrice: 15000,
    duration: 90,
    active: true,
    rule: {
      method: 'bands', productCost: 'none', productsIncluded: true, staffSplit: 'equal',
      bands: [point(10000, 4000, 3000, 3000), point(15000, 6000, 3000, 6000)],
    },
  },
  {
    name: 'Kubana Nyuele',
    category: 'braiding',
    description: 'Price and financial rule to be confirmed before this service can be sold.',
    price: 0,
    maxPrice: null,
    duration: 60,
    active: false,
    keepExisting: true, // an existing Kubana Nyuele keeps its price and settings
    rule: { method: 'unconfigured', productCost: 'deduct', productsIncluded: true, staffSplit: 'equal', bands: [] },
  },
];

// The note on rules created automatically when service rules were introduced.
const MIGRATED_NOTE = 'General formula (set when service rules were introduced)';

module.exports = { PRESETS, MIGRATED_NOTE };
