'use strict';

const { z, email, password } = require('./common');

const login = z.object({
  email,
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(128),
  remember: z.boolean().optional().default(false),
});

const changePassword = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(128),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

const forgotPassword = z.object({ email });

const resetPassword = z
  .object({
    token: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid reset token'),
    password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

module.exports = { login, changePassword, forgotPassword, resetPassword };
