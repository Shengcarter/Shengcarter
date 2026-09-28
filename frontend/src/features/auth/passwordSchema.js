import { z } from 'zod';

/** Mirrors the server password policy (backend/src/validators/common.js). */
export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

export const PASSWORD_HINT = 'At least 8 characters, with letters and numbers.';
