import { describe, expect, test } from 'vitest';
import { matchesProduct, productLabel } from './ProductPicker';
import { describeRule } from '../services/ruleText';

const shampoo = { id: 1, name: 'Argan Oil Shampoo 500ml', sku: 'HC-SHP-500', barcode: '6201000000011', category: 'Hair Care' };

describe('finding a product used on a service', () => {
  test('matches on name, SKU, barcode or category, ignoring case', () => {
    expect(matchesProduct(shampoo, 'argan')).toBe(true);
    expect(matchesProduct(shampoo, 'hc-shp')).toBe(true);
    expect(matchesProduct(shampoo, '6201000000011')).toBe(true);
    expect(matchesProduct(shampoo, 'hair care')).toBe(true);
    expect(matchesProduct(shampoo, 'relaxer')).toBe(false);
    expect(matchesProduct(shampoo, '  ')).toBe(true);
  });

  test('is named with its SKU', () => {
    expect(productLabel(shampoo)).toBe('Argan Oil Shampoo 500ml · HC-SHP-500');
    expect(productLabel({ name: 'Gel' })).toBe('Gel');
  });
});

describe('describing a service financial rule', () => {
  test('general, not set, set prices and bands', () => {
    expect(describeRule(null)).toBe('General formula');
    expect(describeRule({ method: 'general' })).toBe('General formula');
    expect(describeRule({ method: 'unconfigured' })).toBe('Financial rule not set');
    expect(describeRule({ method: 'bands', priceOptions: [10000, 15000], bands: [] })).toMatch(/^Fixed amounts at .*10,000.*15,000/);
    expect(describeRule({ method: 'bands', priceOptions: null, bands: [{ label: '2,000–5,000' }, { label: '6,000–10,000' }] })).toBe('Price bands: 2,000–5,000 · 6,000–10,000');
  });
});
