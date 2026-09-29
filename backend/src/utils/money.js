'use strict';

const Decimal = require('decimal.js');

/**
 * Decimal arithmetic for every financial calculation. Floating point is never
 * used for money: values are converted to Decimal, computed, rounded with
 * ROUND_HALF_UP to the configured currency precision and converted back.
 */
Decimal.set({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const D = (value) => new Decimal(value === null || value === undefined || value === '' ? 0 : value);

function round(value, decimals = 2) {
  return D(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP);
}

/** Round and return a plain number suitable for JSON / DECIMAL columns. */
function toNumber(value, decimals = 2) {
  return round(value, decimals).toNumber();
}

function sum(values) {
  return values.reduce((acc, v) => acc.plus(D(v)), D(0));
}

function percentOf(amount, percent) {
  return D(amount).times(D(percent)).dividedBy(100);
}

function min(a, b) {
  return Decimal.min(D(a), D(b));
}

function max(a, b) {
  return Decimal.max(D(a), D(b));
}

module.exports = { Decimal, D, round, toNumber, sum, percentOf, min, max };
