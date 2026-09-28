'use strict';

const { Router } = require('express');
const controller = require('../controllers/customerController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const { singleUpload } = require('../middleware/upload');
const { idParam, listQuery } = require('../validators/common');
const v = require('../validators/customerValidators');

const router = Router();
const view = requirePermission('customers.view');
const edit = requirePermission('customers.update');

router.get('/', view, validate({ query: v.listCustomers }), controller.list);
router.post('/', requirePermission('customers.create'), validate({ body: v.createCustomer }), controller.create);
router.get('/:id', view, validate({ params: idParam }), controller.get);
router.patch('/:id', edit, validate({ params: idParam, body: v.updateCustomer }), controller.update);
router.delete('/:id', requirePermission('customers.delete'), validate({ params: idParam }), controller.remove);
router.post('/:id/photo', edit, validate({ params: idParam }), singleUpload('photo', 'customers'), controller.uploadPhoto);

router.get('/:id/appointments', view, validate({ params: idParam, query: listQuery }), controller.appointments);
router.get('/:id/purchases', view, validate({ params: idParam, query: listQuery }), controller.purchases);
router.get('/:id/payments', view, validate({ params: idParam, query: listQuery }), controller.payments);
router.get('/:id/loyalty', view, validate({ params: idParam, query: listQuery }), controller.loyalty);
router.post('/:id/loyalty/adjust', requirePermission('loyalty.manage'), validate({ params: idParam, body: v.loyaltyAdjust }), controller.adjustLoyalty);

router.get('/:id/notes', view, validate({ params: idParam }), controller.notes);
router.post('/:id/notes', edit, validate({ params: idParam, body: v.note }), controller.addNote);
router.delete('/:id/notes/:noteId', edit, validate({ params: v.noteParams }), controller.deleteNote);

module.exports = router;
