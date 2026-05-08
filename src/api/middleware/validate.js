/**
 * Zod validation middleware factory.
 * Usage: validate(schema) where schema validates req.body
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(i => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      // Surface a specific message so frontend toasts/inline errors are
      // useful instead of a generic "Invalid input".
      const summary = errors.map(e => e.field ? `${e.field}: ${e.message}` : e.message).join('; ');
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: summary || 'Invalid input', errors },
      });
    }
    req.validated = result.data;
    next();
  };
}

/**
 * Validate query params.
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query params' },
      });
    }
    req.validatedQuery = result.data;
    next();
  };
}

module.exports = { validate, validateQuery };
