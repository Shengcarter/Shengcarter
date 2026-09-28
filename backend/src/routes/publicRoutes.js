'use strict';

const { Router } = require('express');
const { settings } = require('../controllers/adminController');
const { publicLimiter } = require('../middleware/rateLimiters');

/** Unauthenticated endpoints. They never return personal data. */
const router = Router();

router.use(publicLimiter);
router.get('/branding', settings.branding);

module.exports = router;
