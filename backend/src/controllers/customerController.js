'use strict';

const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const { removeUploadedFile } = require('../middleware/upload');
const customerService = require('../services/customerService');
const loyaltyService = require('../services/loyaltyService');

async function list(req, res) {
  sendPaginated(res, await customerService.list(req.validQuery));
}

async function get(req, res) {
  sendSuccess(res, await customerService.getProfile(req.params.id));
}

async function create(req, res) {
  sendCreated(res, await customerService.create(req.body, req.ctx), 'Customer created successfully');
}

async function update(req, res) {
  sendSuccess(res, await customerService.update(req.params.id, req.body, req.ctx), 'Customer updated successfully');
}

async function remove(req, res) {
  const result = await customerService.remove(req.params.id, req.ctx);
  sendSuccess(res, result, result.archived ? 'Customer archived. Their history is kept for reports.' : 'Customer deleted successfully');
}

async function appointments(req, res) {
  sendPaginated(res, await customerService.appointmentHistory(req.params.id, req.validQuery));
}

async function purchases(req, res) {
  sendPaginated(res, await customerService.purchaseHistory(req.params.id, req.validQuery));
}

async function payments(req, res) {
  sendPaginated(res, await customerService.paymentHistory(req.params.id, req.validQuery));
}

async function loyalty(req, res) {
  await customerService.getById(req.params.id);
  sendPaginated(res, await loyaltyService.listTransactions(req.params.id, req.validQuery));
}

async function adjustLoyalty(req, res) {
  await customerService.getById(req.params.id);
  sendSuccess(res, await loyaltyService.adjust(req.params.id, req.body, req.ctx), 'Loyalty points adjusted');
}

async function notes(req, res) {
  await customerService.getById(req.params.id);
  sendSuccess(res, await customerService.listNotes(req.params.id));
}

async function addNote(req, res) {
  sendCreated(res, await customerService.addNote(req.params.id, req.body.note, req.ctx), 'Note added');
}

async function deleteNote(req, res) {
  await customerService.deleteNote(req.params.id, req.params.noteId, req.ctx);
  sendSuccess(res, null, 'Note deleted');
}

async function uploadPhoto(req, res) {
  if (!req.file) throw ApiError.validation([{ field: 'photo', message: 'Choose an image to upload' }]);
  try {
    const previous = await customerService.updatePhoto(req.params.id, req.file.publicPath, req.ctx);
    removeUploadedFile(previous);
  } catch (error) {
    removeUploadedFile(req.file.publicPath);
    throw error;
  }
  sendSuccess(res, { photo: req.file.publicPath }, 'Photo updated');
}

module.exports = {
  list, get, create, update, remove, appointments, purchases, payments, loyalty, adjustLoyalty, notes, addNote, deleteNote, uploadPhoto,
};
