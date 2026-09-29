'use strict';

const { z, id, email, optionalPhone, password, requiredText, nullableId, listQuery, optionalId } = require('./common');

const listUsers = listQuery.extend({
  roleId: optionalId,
  branchId: optionalId,
  status: z.enum(['active', 'inactive']).optional(),
});

const createUser = z.object({
  fullName: requiredText(120, 'Full name'),
  email,
  phone: optionalPhone,
  roleId: id,
  branchId: nullableId,
  password,
  isActive: z.boolean().optional().default(true),
  employeeId: nullableId,
});

const updateUser = z.object({
  fullName: requiredText(120, 'Full name').optional(),
  email: email.optional(),
  phone: optionalPhone,
  roleId: id.optional(),
  branchId: nullableId,
  isActive: z.boolean().optional(),
  employeeId: nullableId,
});

const resetUserPassword = z.object({ password });

const roleBody = z.object({
  name: requiredText(80, 'Role name'),
  description: z.string().trim().max(255).optional().nullable(),
  permissions: z.array(z.string().max(80)).max(200),
});

const branchBody = z.object({
  code: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/, 'Letters, numbers, - and _ only'),
  name: requiredText(120, 'Branch name'),
  phone: optionalPhone,
  email: z.preprocess((v) => (v === '' ? null : v), email.nullable().optional()),
  address: z.string().trim().max(255).optional().nullable(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

module.exports = {
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  roleBody,
  roleUpdate: roleBody.partial(),
  branchBody,
  branchUpdate: branchBody.partial(),
};
