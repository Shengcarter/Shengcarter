'use strict';

const { Router } = require('express');
const { settings } = require('../controllers/adminController');
const appointments = require('../controllers/appointmentController');
const validate = require('../middleware/validate');
const { token } = require('../validators/appointmentValidators');
const { publicLimiter } = require('../middleware/rateLimiters');

/** Unauthenticated endpoints. They never return personal data. */
const router = Router();

router.use(publicLimiter);
router.get('/branding', settings.branding);
// QR verification: confirms the appointment exists without revealing personal data.
router.get('/appointments/:token', validate({ params: token }), appointments.publicVerify);

module.exports = router;
