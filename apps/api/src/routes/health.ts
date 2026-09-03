import { Router } from 'express';
import { config } from '../config.js';

export const healthRouter = Router();

/**
 * Public health check. Intentionally returns only a binary `ok` flag so we
 * do not leak which providers are configured. Internal provider status
 * belongs behind an authenticated admin endpoint, not here.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

