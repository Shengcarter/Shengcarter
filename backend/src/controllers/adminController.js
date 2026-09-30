'use strict';

/**
 * Administration endpoints: users, roles, branches, settings, activity logs.
 */
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const { removeUploadedFile } = require('../middleware/upload');
const userService = require('../services/userService');
const roleService = require('../services/roleService');
const branchService = require('../services/branchService');
const settingsService = require('../services/settingsService');
const auditService = require('../services/auditService');
const messaging = require('../services/messaging');
const { localDateRange } = require('../utils/time');
const backupService = require('../services/backupService');

// ---- Users ------------------------------------------------------------------
const users = {
  async list(req, res) {
    sendPaginated(res, await userService.list(req.validQuery));
  },
  async get(req, res) {
    sendSuccess(res, await userService.getById(req.params.id));
  },
  async create(req, res) {
    sendCreated(res, await userService.create(req.body, req.ctx), 'User created successfully. They will be asked to change the password at first login.');
  },
  async update(req, res) {
    sendSuccess(res, await userService.update(req.params.id, req.body, req.ctx), 'User updated successfully');
  },
  async resetPassword(req, res) {
    await userService.resetPassword(req.params.id, req.body.password, req.ctx);
    sendSuccess(res, null, 'Password reset. The user must change it at next login.');
  },
  async unlock(req, res) {
    await userService.unlock(req.params.id, req.ctx);
    sendSuccess(res, null, 'Account unlocked');
  },
  async updateMe(req, res) {
    sendSuccess(res, await userService.updateMe(req.user.id, req.body, req.ctx), 'Your details have been saved');
  },
  async uploadMyAvatar(req, res) {
    if (!req.file) throw ApiError.validation([{ field: 'avatar', message: 'Choose an image to upload' }]);
    const previous = await userService.updateAvatar(req.user.id, req.file.publicPath, req.ctx);
    removeUploadedFile(previous);
    sendSuccess(res, { avatar: req.file.publicPath }, 'Profile photo updated');
  },
};

// ---- Roles --------------------------------------------------------------------
const roles = {
  async list(_req, res) {
    sendSuccess(res, await roleService.list());
  },
  async permissions(_req, res) {
    sendSuccess(res, await roleService.listPermissions());
  },
  async create(req, res) {
    sendCreated(res, await roleService.create(req.body, req.ctx), 'Role created successfully');
  },
  async update(req, res) {
    sendSuccess(res, await roleService.update(req.params.id, req.body, req.ctx), 'Role updated successfully');
  },
  async remove(req, res) {
    await roleService.remove(req.params.id, req.ctx);
    sendSuccess(res, null, 'Role deleted');
  },
};

// ---- Branches -----------------------------------------------------------------
const branches = {
  async list(_req, res) {
    sendSuccess(res, await branchService.list());
  },
  async create(req, res) {
    sendCreated(res, await branchService.create(req.body, req.ctx), 'Branch created successfully');
  },
  async update(req, res) {
    sendSuccess(res, await branchService.update(req.params.id, req.body, req.ctx), 'Branch updated successfully');
  },
};

// ---- Settings -------------------------------------------------------------------
const settings = {
  async branding(_req, res) {
    sendSuccess(res, settingsService.getBranding());
  },
  async app(_req, res) {
    sendSuccess(res, settingsService.getPublicSettings());
  },
  async all(_req, res) {
    sendSuccess(res, settingsService.getAllForAdmin());
  },
  async updateGroup(req, res) {
    const data = await settingsService.updateGroup(req.params.group, req.body, req.ctx);
    // The backup schedule depends on the backup settings and the time zone.
    if (['backup', 'system'].includes(req.params.group)) backupService.schedule();
    sendSuccess(res, data, 'Settings saved successfully');
  },
  async uploadLogo(req, res) {
    if (!req.file) throw ApiError.validation([{ field: 'logo', message: 'Choose an image to upload' }]);
    const previous = settingsService.get('business.logo');
    await settingsService.setInternal('business.logo', req.file.publicPath, req.ctx);
    await auditService.record(req.ctx, { action: 'settings.updated', entityType: 'settings', description: 'Updated business logo' });
    removeUploadedFile(previous);
    sendSuccess(res, { logo: req.file.publicPath }, 'Logo updated');
  },
  async removeLogo(req, res) {
    const previous = settingsService.get('business.logo');
    await settingsService.setInternal('business.logo', '', req.ctx);
    removeUploadedFile(previous);
    sendSuccess(res, null, 'Logo removed');
  },
  async testMessage(req, res) {
    const { channel, to } = req.body;
    try {
      const result = await messaging.sendNow({
        channel,
        to,
        subject: 'ZOLA STYLISH MANAGEMENT SYSTEM — test message',
        body: `This is a test ${channel} message from ZOLA STYLISH MANAGEMENT SYSTEM. Your ${channel} integration is working.`,
      });
      await auditService.record(req.ctx, { action: 'settings.integration_tested', entityType: 'settings', description: `Sent test ${channel} message`, metadata: { provider: result.provider } });
      const note = result.provider === 'log' ? ' (log provider: the message was written to the server log, not delivered)' : '';
      sendSuccess(res, result, `Test message sent via ${result.provider}${note}`);
    } catch (error) {
      throw ApiError.badRequest(`Could not send test message: ${error.message}`);
    }
  },
};

// ---- Activity logs ------------------------------------------------------------------
const activity = {
  async list(req, res) {
    const q = { ...req.validQuery };
    if (q.from || q.to) {
      const range = localDateRange(q.from || '2000-01-01', q.to || '2999-12-31');
      q.from = range.start;
      q.to = range.end;
    }
    sendPaginated(res, await auditService.list(q));
  },
};

module.exports = { users, roles, branches, settings, activity };
