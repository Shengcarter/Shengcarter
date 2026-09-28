'use strict';

const { Router } = require('express');
const controller = require('../controllers/authController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { loginLimiter, passwordResetLimiter } = require('../middleware/rateLimiters');
const v = require('../validators/authValidators');

const router = Router();

router.post('/login', loginLimiter, validate({ body: v.login }), controller.login);
router.post('/refresh', controller.refresh);
router.post('/logout', controller.logout);
router.post('/forgot-password', passwordResetLimiter, validate({ body: v.forgotPassword }), controller.forgotPassword);
router.post('/reset-password', passwordResetLimiter, validate({ body: v.resetPassword }), controller.resetPassword);
router.get('/me', authenticate, controller.me);
router.post('/change-password', authenticate, validate({ body: v.changePassword }), controller.changePassword);

module.exports = router;
