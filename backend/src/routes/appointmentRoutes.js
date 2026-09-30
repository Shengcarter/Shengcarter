'use strict';

const { Router } = require('express');
const c = require('../controllers/appointmentController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const { idParam } = require('../validators/common');
const v = require('../validators/appointmentValidators');

const router = Router();
const view = requirePermission('appointments.view', 'appointments.view_own');
const book = requirePermission('appointments.create', 'appointments.update');

router.get('/calendar', view, validate({ query: v.calendarQuery }), c.calendar);
router.get('/availability', book, validate({ query: v.availabilityQuery }), c.availability);
router.get('/available-employees', book, validate({ query: v.availableEmployeesQuery }), c.availableEmployees);
router.post('/check-in', requirePermission('appointments.checkin'), validate({ body: v.checkIn }), c.checkIn);

router.get('/', view, validate({ query: v.listQuery }), c.list);
router.post('/', requirePermission('appointments.create'), validate({ body: v.create }), c.create);
router.get('/:id', view, validate({ params: idParam }), c.get);
router.patch('/:id', requirePermission('appointments.update'), validate({ params: idParam, body: v.update }), c.update);
router.patch('/:id/reschedule', requirePermission('appointments.update'), validate({ params: idParam, body: v.reschedule }), c.reschedule);
// Per-status permissions are checked in the service (cancel / complete / update).
router.post('/:id/status', requirePermission('appointments.update', 'appointments.cancel', 'appointments.complete'), validate({ params: idParam, body: v.status }), c.changeStatus);
router.post('/:id/check-in', requirePermission('appointments.checkin'), validate({ params: idParam }), c.checkIn);
router.get('/:id/qr', view, validate({ params: idParam }), c.qr);
router.get('/:id/products', view, validate({ params: idParam }), c.products);
router.put('/:id/products', requirePermission('appointments.record_products'), validate({ params: idParam, body: v.productsUsed }), c.recordProducts);

module.exports = router;
