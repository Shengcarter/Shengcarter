'use strict';

const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const { removeUploadedFile } = require('../middleware/upload');
const employeeService = require('../services/employeeService');
const attendanceService = require('../services/attendanceService');

// ---- Employees ------------------------------------------------------------------
async function list(req, res) {
  sendPaginated(res, await employeeService.list({ ...req.validQuery, branchId: req.ctx.branchId }));
}

async function options(req, res) {
  const q = req.validQuery;
  sendSuccess(res, await employeeService.options(req.ctx.branchId, { bookableOnly: q.bookable, includeInactive: q.includeInactive }));
}

async function get(req, res) {
  sendSuccess(res, await employeeService.getProfile(req.params.id, req.ctx));
}

async function create(req, res) {
  sendCreated(res, await employeeService.create(req.body, req.ctx), 'Employee created successfully');
}

async function update(req, res) {
  sendSuccess(res, await employeeService.update(req.params.id, req.body, req.ctx), 'Employee updated successfully');
}

async function remove(req, res) {
  const result = await employeeService.remove(req.params.id, req.ctx);
  sendSuccess(res, result, result.archived ? 'Employee has history, so they were marked as terminated' : 'Employee deleted');
}

async function updateSchedule(req, res) {
  sendSuccess(res, await employeeService.updateSchedule(req.params.id, req.body.days, req.ctx), 'Schedule saved');
}

async function updateServices(req, res) {
  sendSuccess(res, await employeeService.update(req.params.id, { serviceIds: req.body.serviceIds }, req.ctx), 'Services updated');
}

async function performance(req, res) {
  sendSuccess(res, await employeeService.performance(req.params.id, req.validQuery, req.ctx));
}

async function uploadPhoto(req, res) {
  if (!req.file) throw ApiError.validation([{ field: 'photo', message: 'Choose an image to upload' }]);
  try {
    removeUploadedFile(await employeeService.updatePhoto(req.params.id, req.file.publicPath, req.ctx));
  } catch (error) {
    removeUploadedFile(req.file.publicPath);
    throw error;
  }
  sendSuccess(res, { photo: req.file.publicPath }, 'Photo updated');
}

// ---- Attendance -----------------------------------------------------------------
async function attendanceList(req, res) {
  sendSuccess(res, await attendanceService.list(req.validQuery, req.ctx));
}

async function attendanceToday(req, res) {
  sendSuccess(res, await attendanceService.today(req.ctx));
}

async function attendanceMine(req, res) {
  sendSuccess(res, await attendanceService.mine(req.ctx));
}

async function clockIn(req, res) {
  const result = await attendanceService.clockIn(req.body, req.ctx);
  sendSuccess(res, result, result.status === 'late' ? 'Clocked in (marked late)' : 'Clocked in');
}

async function clockOut(req, res) {
  sendSuccess(res, await attendanceService.clockOut(req.body, req.ctx), 'Clocked out');
}

async function recordAttendance(req, res) {
  await attendanceService.record(req.body, req.ctx);
  sendSuccess(res, null, 'Attendance saved');
}

// ---- Leave ------------------------------------------------------------------------
async function leaveList(req, res) {
  sendSuccess(res, await attendanceService.listLeave(req.validQuery, req.ctx));
}

async function leaveCreate(req, res) {
  const result = await attendanceService.createLeave(req.body, req.ctx);
  const warning = result.conflictingAppointments ? ` Note: ${result.conflictingAppointments} appointment(s) fall within this leave.` : '';
  sendCreated(res, result, `Leave recorded (${result.status}).${warning}`);
}

async function leaveReview(req, res) {
  const result = await attendanceService.reviewLeave(req.params.id, req.body.status, req.ctx);
  const warning = result.conflictingAppointments ? ` ${result.conflictingAppointments} appointment(s) fall within this leave — please reassign them.` : '';
  sendSuccess(res, result, `Leave ${result.status}.${warning}`);
}

module.exports = {
  list, options, get, create, update, remove, updateSchedule, updateServices, performance, uploadPhoto,
  attendanceList, attendanceToday, attendanceMine, clockIn, clockOut, recordAttendance,
  leaveList, leaveCreate, leaveReview,
};
