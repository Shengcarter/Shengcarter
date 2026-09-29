'use strict';

const {
  z, requiredText, optionalText, optionalEmail, phone, optionalDate, listQuery, id, emptyToUndefined,
} = require('./common');

const gender = z.enum(['female', 'male', 'other', 'unspecified']);

const customerBody = z.object({
  fullName: requiredText(120, 'Full name'),
  phone,
  email: optionalEmail,
  gender: gender.optional().default('unspecified'),
  dateOfBirth: optionalDate.refine((v) => !v || new Date(v) <= new Date(), 'Date of birth cannot be in the future'),
  address: optionalText(255),
  notes: optionalText(5000),
  marketingOptIn: z.boolean().optional().default(true),
  preferredChannel: z.enum(['sms', 'whatsapp', 'email', 'none']).optional().default('sms'),
});

const listCustomers = listQuery.extend({
  gender: gender.optional(),
  minPoints: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  maxPoints: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).optional()),
  visited: z.enum(['never', 'returning']).optional(),
  birthdayMonth: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(12).optional()),
});

module.exports = {
  createCustomer: customerBody,
  // Updates are partial and have no defaults (so omitted fields stay unchanged).
  updateCustomer: customerBody.extend({
    gender: gender.optional(),
    marketingOptIn: z.boolean().optional(),
    preferredChannel: z.enum(['sms', 'whatsapp', 'email', 'none']).optional(),
  }).partial(),
  listCustomers,
  note: z.object({ note: requiredText(2000, 'Note') }),
  noteParams: z.object({ id, noteId: id }),
  loyaltyAdjust: z.object({
    points: z.coerce.number().int().refine((v) => v !== 0, 'Points cannot be zero').refine((v) => Math.abs(v) <= 1_000_000, 'Too many points'),
    reason: requiredText(255, 'Reason'),
  }),
};
