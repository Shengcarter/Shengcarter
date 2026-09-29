'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { users, roles, branches, settings, activity } = require('../controllers/adminController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const { singleUpload } = require('../middleware/upload');
const { idParam, listQuery, dateRangeQuery, optionalId } = require('../validators/common');
const v = require('../validators/userValidators');

// ---- /api/users -------------------------------------------------------------
const userRouter = Router();
userRouter.post('/me/avatar', singleUpload('avatar', 'users'), users.uploadMyAvatar);
userRouter.use(requirePermission('users.manage'));
userRouter.get('/', validate({ query: v.listUsers }), users.list);
userRouter.post('/', validate({ body: v.createUser }), users.create);
userRouter.get('/:id', validate({ params: idParam }), users.get);
userRouter.patch('/:id', validate({ params: idParam, body: v.updateUser }), users.update);
userRouter.post('/:id/reset-password', validate({ params: idParam, body: v.resetUserPassword }), users.resetPassword);
userRouter.post('/:id/unlock', validate({ params: idParam }), users.unlock);

// ---- /api/roles -------------------------------------------------------------
const roleRouter = Router();
roleRouter.get('/', requirePermission('roles.manage', 'users.manage'), roles.list);
roleRouter.get('/permissions', requirePermission('roles.manage'), roles.permissions);
roleRouter.post('/', requirePermission('roles.manage'), validate({ body: v.roleBody }), roles.create);
roleRouter.patch('/:id', requirePermission('roles.manage'), validate({ params: idParam, body: v.roleUpdate }), roles.update);
roleRouter.delete('/:id', requirePermission('roles.manage'), validate({ params: idParam }), roles.remove);

// ---- /api/branches ----------------------------------------------------------
const branchRouter = Router();
branchRouter.get('/', requirePermission('branches.manage', 'users.manage'), branches.list);
branchRouter.post('/', requirePermission('branches.manage'), validate({ body: v.branchBody }), branches.create);
branchRouter.patch('/:id', requirePermission('branches.manage'), validate({ params: idParam, body: v.branchUpdate }), branches.update);

// ---- /api/settings ----------------------------------------------------------
const settingsRouter = Router();
settingsRouter.get('/app', settings.app);
settingsRouter.get('/', requirePermission('settings.manage'), settings.all);
settingsRouter.post('/business/logo', requirePermission('settings.manage'), singleUpload('logo', 'branding'), settings.uploadLogo);
settingsRouter.delete('/business/logo', requirePermission('settings.manage'), settings.removeLogo);
settingsRouter.post(
  '/integrations/test',
  requirePermission('settings.manage'),
  validate({ body: z.object({ channel: z.enum(['email', 'sms', 'whatsapp']), to: z.string().trim().min(3).max(150) }) }),
  settings.testMessage,
);
settingsRouter.put(
  '/:group',
  requirePermission('settings.manage'),
  validate({ params: z.object({ group: z.string().max(30) }) }),
  settings.updateGroup,
);

// ---- /api/activity-logs -----------------------------------------------------
const activityRouter = Router();
activityRouter.get(
  '/',
  requirePermission('audit.view'),
  validate({
    query: listQuery.merge(dateRangeQuery).extend({
      userId: optionalId,
      action: z.string().max(80).optional(),
      entityType: z.string().max(50).optional(),
    }),
  }),
  activity.list,
);

module.exports = { userRouter, roleRouter, branchRouter, settingsRouter, activityRouter };
