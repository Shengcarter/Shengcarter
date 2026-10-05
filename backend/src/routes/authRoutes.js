'use strict';

const { Router } = require('express');
const controller = require('../controllers/authController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter, twoFactorLimiter, sessionLimiter, accountSecurityLimiter } = require('../middleware/rateLimiters');
const { requireSameOrigin } = require('../middleware/sameOrigin');
const v = require('../validators/authValidators');

const router = Router();

// These three read or set the refresh cookie, so they only accept requests from the app itself.
router.post('/login', requireSameOrigin, loginLimiter, validate({ body: v.login }), controller.login);
router.post('/login/two-factor', requireSameOrigin, twoFactorLimiter, validate({ body: v.loginSecondStep }), controller.loginSecondStep);
router.post('/refresh', requireSameOrigin, sessionLimiter, controller.refresh);
router.post('/logout', requireSameOrigin, sessionLimiter, controller.logout);
router.post('/forgot-password', passwordResetLimiter, validate({ body: v.forgotPassword }), controller.forgotPassword);
router.post('/reset-password', passwordResetLimiter, validate({ body: v.resetPassword }), controller.resetPassword);
router.get('/me', authenticate, controller.me);
router.post('/change-password', authenticate, accountSecurityLimiter, validate({ body: v.changePassword }), controller.changePassword);

// Two-step sign-in for the signed-in user (an authenticator app).
router.get('/two-factor', authenticate, controller.twoFactorStatus);
router.post('/two-factor/setup', authenticate, accountSecurityLimiter, validate({ body: v.twoFactorSetup }), controller.twoFactorSetup);
router.post('/two-factor/confirm', authenticate, accountSecurityLimiter, validate({ body: v.twoFactorConfirm }), controller.twoFactorConfirm);
router.post('/two-factor/disable', authenticate, accountSecurityLimiter, validate({ body: v.twoFactorChange }), controller.twoFactorDisable);
router.post('/two-factor/recovery-codes', authenticate, accountSecurityLimiter, validate({ body: v.twoFactorChange }), controller.twoFactorRecoveryCodes);

module.exports = router;
