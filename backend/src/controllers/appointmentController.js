'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const appointmentService = require('../services/appointmentService');

async function calendar(req, res) {
  sendSuccess(res, await appointmentService.calendar(req.validQuery, req.ctx));
}

async function list(req, res) {
  sendPaginated(res, await appointmentService.list(req.validQuery, req.ctx));
}

async function get(req, res) {
  sendSuccess(res, await appointmentService.getById(req.params.id, req.ctx));
}

async function create(req, res) {
  sendCreated(res, await appointmentService.create(req.body, req.ctx), 'Appointment booked successfully');
}

async function update(req, res) {
  sendSuccess(res, await appointmentService.update(req.params.id, req.body, req.ctx), 'Appointment updated successfully');
}

async function reschedule(req, res) {
  sendSuccess(res, await appointmentService.reschedule(req.params.id, req.body, req.ctx), 'Appointment rescheduled');
}

const STATUS_MESSAGES = {
  confirmed: 'Appointment confirmed',
  in_progress: 'Service started',
  completed: 'Appointment completed',
  cancelled: 'Appointment cancelled',
  no_show: 'Marked as no-show',
};

async function changeStatus(req, res) {
  sendSuccess(res, await appointmentService.changeStatus(req.params.id, req.body, req.ctx), STATUS_MESSAGES[req.body.status]);
}

/** Check in by QR token, by appointment code (typed at reception) or by id. */
async function checkIn(req, res) {
  let { token } = req.body;
  let id = req.params.id ? Number(req.params.id) : null;
  if (!token && !id && req.body.code) {
    const row = await db.queryOne('SELECT id FROM appointments WHERE code = ? AND branch_id = ?', [req.body.code.toUpperCase(), req.ctx.branchId]);
    if (!row) throw ApiError.notFound(`No appointment with code ${req.body.code}`);
    id = row.id;
  }
  if (!token && !id) throw ApiError.validation([{ field: 'token', message: 'Scan a QR code or enter an appointment code' }]);
  if (id) token = undefined;
  sendSuccess(res, await appointmentService.checkIn({ token, id }, req.ctx), 'Customer checked in');
}

async function qr(req, res) {
  sendSuccess(res, await appointmentService.qrCode(req.params.id, req.ctx));
}

async function availability(req, res) {
  sendSuccess(res, await appointmentService.availability(req.validQuery, req.ctx));
}

async function availableEmployees(req, res) {
  sendSuccess(res, await appointmentService.availableEmployees(req.validQuery, req.ctx));
}

async function publicVerify(req, res) {
  sendSuccess(res, await appointmentService.publicVerify(req.params.token));
}

module.exports = { calendar, list, get, create, update, reschedule, changeStatus, checkIn, qr, availability, availableEmployees, publicVerify };
