'use strict';

/**
 * Consistent API response envelopes:
 *   { success: true,  message, data, pagination? }
 *   { success: false, message, errors }   (see middleware/errorHandler.js)
 */
function sendSuccess(res, data = null, message = 'OK', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

function sendCreated(res, data, message = 'Created successfully') {
  return sendSuccess(res, data, message, 201);
}

function sendPaginated(res, { rows, pagination, summary }, message = 'OK') {
  const body = { success: true, message, data: rows, pagination };
  if (summary !== undefined) body.summary = summary;
  return res.status(200).json(body);
}

module.exports = { sendSuccess, sendCreated, sendPaginated };
