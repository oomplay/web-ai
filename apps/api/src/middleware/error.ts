import type { ErrorRequestHandler } from 'express';

/**
 * Last-resort error handler. Returns a generic JSON envelope; never leaks
 * stack traces or upstream error details. The real cause is logged
 * server-side so operators can still debug.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Server-side log: keep the real message for operators.
  // eslint-disable-next-line no-console
  console.error('[api] unhandled error', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    message: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({ error: 'Internal error.' });
};

