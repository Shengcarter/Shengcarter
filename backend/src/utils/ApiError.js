'use strict';

/**
 * Operational error with an HTTP status. Anything thrown as ApiError is safe
 * to show to the user; every other error becomes a generic 500 response.
 */
class ApiError extends Error {
  constructor(statusCode, message, { errors = [], code = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errors = errors;
    this.code = code;
  }

  static badRequest(message = 'Bad request', options) {
    return new ApiError(400, message, options);
  }

  static unauthorized(message = 'Authentication required', options) {
    return new ApiError(401, message, options);
  }

  static forbidden(message = 'You do not have permission to perform this action', options) {
    return new ApiError(403, message, options);
  }

  static notFound(message = 'Record not found', options) {
    return new ApiError(404, message, options);
  }

  static conflict(message = 'The request conflicts with existing data', options) {
    return new ApiError(409, message, options);
  }

  static validation(errors, message = 'Validation failed') {
    return new ApiError(422, message, { errors, code: 'VALIDATION_ERROR' });
  }

  static locked(message, options) {
    return new ApiError(423, message, options);
  }
}

module.exports = ApiError;
