'use strict';

const { z } = require('zod');
const { PHONE_PATTERN } = require('../utils/phone');

/** Reusable zod building blocks shared by every module's validators. */

const emptyToUndefined = (value) => (value === '' || value === null ? undefined : value);
const emptyToNull = (value) => (value === '' ? null : value);

const id = z.coerce.number().int().positive();
const idParam = z.object({ id });

const optionalId = z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional());
const nullableId = z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable().optional());

const money = z.coerce.number({ error: 'Must be a number' }).min(0, 'Must be zero or more').max(999_999_999_999, 'Amount is too large');
const positiveMoney = z.coerce.number({ error: 'Must be a number' }).positive('Must be greater than zero').max(999_999_999_999, 'Amount is too large');
const percent = z.coerce.number().min(0, 'Must be between 0 and 100').max(100, 'Must be between 0 and 100');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format').refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date');
const optionalDate = z.preprocess(emptyToNull, isoDate.nullable().optional());
const isoDateTime = z.string().min(10).refine((v) => !Number.isNaN(Date.parse(v.length === 16 ? `${v}:00` : v)), 'Invalid date/time');

const requiredText = (max, label = 'This field') => z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `Maximum ${max} characters`);
const optionalText = (max) => z.preprocess(emptyToNull, z.string().trim().max(max, `Maximum ${max} characters`).nullable().optional());

const email = z.string({ error: 'Email is required' }).trim().toLowerCase().pipe(z.email('Enter a valid email address').max(150));
const optionalEmail = z.preprocess(emptyToNull, email.nullable().optional());
const phone = z.string().trim().regex(PHONE_PATTERN, 'Enter a valid phone number');
const optionalPhone = z.preprocess(emptyToNull, phone.nullable().optional());

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

const booleanish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');

const paymentMethod = z.enum(['cash', 'mobile_money', 'card', 'bank_transfer'], { error: 'Choose a valid payment method' });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().max(100).optional(),
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

const dateRangeQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});

module.exports = {
  z,
  id,
  idParam,
  optionalId,
  nullableId,
  money,
  positiveMoney,
  percent,
  isoDate,
  optionalDate,
  isoDateTime,
  requiredText,
  optionalText,
  email,
  optionalEmail,
  phone,
  optionalPhone,
  password,
  booleanish,
  paymentMethod,
  listQuery,
  dateRangeQuery,
  emptyToUndefined,
};
