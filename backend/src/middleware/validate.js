'use strict';

const ApiError = require('../utils/ApiError');

function formatIssues(issues, location) {
  return issues.map((issue) => ({
    field: issue.path.length ? issue.path.join('.') : location,
    message: issue.message,
  }));
}

/**
 * Validate request data with zod schemas: validate({ body, query, params }).
 * Parsed (coerced, trimmed) values are exposed as req.body, req.params and
 * req.validQuery (Express 5 makes req.query read-only).
 */
function validate(schemas) {
  return (req, _res, next) => {
    const errors = [];
    for (const location of ['params', 'query', 'body']) {
      const schema = schemas[location];
      if (!schema) continue;
      let input = req[location] ?? {};
      // Empty query parameters (?status=) mean "no filter".
      if (location === 'query') input = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== ''));
      const result = schema.safeParse(input);
      if (!result.success) {
        errors.push(...formatIssues(result.error.issues, location));
      } else if (location === 'query') {
        req.validQuery = result.data;
      } else {
        req[location] = result.data;
      }
    }
    if (errors.length) throw ApiError.validation(errors);
    next();
  };
}

module.exports = validate;
