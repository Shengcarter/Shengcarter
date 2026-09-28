'use strict';

const multer = require('multer');
const config = require('../config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

const MYSQL_ERRORS = {
  ER_DUP_ENTRY: [409, 'A record with the same unique value already exists'],
  ER_ROW_IS_REFERENCED_2: [409, 'This record is in use by other records and cannot be deleted'],
  ER_ROW_IS_REFERENCED: [409, 'This record is in use by other records and cannot be deleted'],
  ER_NO_REFERENCED_ROW_2: [422, 'A referenced record does not exist'],
  ER_CHECK_CONSTRAINT_VIOLATED: [422, 'The data violates a business rule'],
  ER_DATA_TOO_LONG: [422, 'One of the values is too long'],
  ER_TRUNCATED_WRONG_VALUE: [422, 'One of the values has an invalid format'],
  ER_LOCK_DEADLOCK: [409, 'The record was busy. Please try again'],
  ER_LOCK_WAIT_TIMEOUT: [409, 'The record was busy. Please try again'],
};

function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Global error handler. Operational errors are returned with their message;
 * unexpected errors are logged with full details and returned as a generic
 * message so stack traces and SQL never reach the browser.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  let status = 500;
  let message = 'Something went wrong. Please try again or contact your administrator.';
  let errors = [];
  let code = 'SERVER_ERROR';

  if (err instanceof ApiError) {
    status = err.statusCode;
    message = err.message;
    errors = err.errors;
    code = err.code || undefined;
  } else if (err instanceof multer.MulterError) {
    status = 422;
    code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE'
      ? `File is too large. Maximum size is ${Math.round(config.uploads.maxBytes / 1024 / 1024)} MB`
      : 'File upload failed';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request is too large';
  } else if (err.code && MYSQL_ERRORS[err.code]) {
    [status, message] = MYSQL_ERRORS[err.code];
    code = err.code;
  }

  const logContext = { err, method: req.method, url: req.originalUrl, userId: req.user?.id, status };
  if (status >= 500) logger.error(logContext, 'Unhandled error');
  else if (status !== 401 && status !== 404) logger.warn({ method: req.method, url: req.originalUrl, status, message }, 'Request rejected');

  const body = { success: false, message, errors };
  if (code) body.code = code;
  if (!config.isProduction && status >= 500) body.debug = err.message;
  res.status(status).json(body);
}

module.exports = { errorHandler, notFound };
