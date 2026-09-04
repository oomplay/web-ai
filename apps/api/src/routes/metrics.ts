/**
 * GET /api/metrics — Prometheus text-format snapshot.
 *
 * This is an internal-only endpoint. The route is mounted BEFORE
 * the rate limiters in `index.ts` so that the operator's scrape loop
 * is not throttled, and BEFORE the CORS middleware so the response
 * cannot leak to a cross-origin browser context. The operator MUST
 * additionally block this path at the reverse proxy so that the
 * public internet cannot scrape it.
 *
 * No request body. No query parameters. No headers are read.
 */

import { Router, type Request, type Response } from 'express';
import type { MetricsRegistry } from '../metrics/registry.js';

export function metricsRouter(registry: MetricsRegistry): Router {
  const r = Router();
  r.get('/metrics', (_req: Request, res: Response) => {
    // Standard Prometheus exposition content-type (see
    // https://prometheus.io/docs/instrumenting/exposition_formats/).
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    // Hardening: no caching of the snapshot; scrape tools want live data.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(registry.render());
  });
  return r;
}
