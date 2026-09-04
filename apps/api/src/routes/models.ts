import { Router } from 'express';
import type { Registry } from '../providers/registry.js';
import type { ConcurrencyLimiter } from '../safety/concurrency.js';
import type { RateLimiter } from '../safety/rate-limit.js';
import { rateLimitHeaders } from '../safety/rate-limit.js';
import { clientIp } from '../safety/validation.js';
import type { MetricsRegistry } from '../metrics/registry.js';

export interface ModelsRouterDeps {
  registry: Registry;
  rateLimiter: RateLimiter;
  rateLimitName: string;
  requestLimiter: ConcurrencyLimiter;
  metrics: MetricsRegistry;
}

export function modelsRouter(deps: ModelsRouterDeps): Router {
  const { registry, rateLimiter, rateLimitName, requestLimiter, metrics } = deps;
  const router = Router();

  router.get('/models', async (req, res, next) => {
    const ip = clientIp(req);

    const rl = rateLimiter.hit(ip);
    for (const [k, v] of Object.entries(
      rateLimitHeaders(rl, { windowMs: 0, max: rl.limit, name: rateLimitName }),
    )) {
      res.setHeader(k, v);
    }
    if (!rl.allow) {
      metrics.incRateLimitRejection('models');
      res.status(429).json({ error: 'Too many requests.' });
      return;
    }

    if (!requestLimiter.acquire(ip)) {
      res.status(429).json({ error: 'Too many concurrent requests.' });
      return;
    }
    let slotReleased = false;
    const release = () => {
      if (slotReleased) return;
      slotReleased = true;
      requestLimiter.release(ip);
    };
    try {
      const models = await registry.listModels();
      res.json({ models });
    } catch (err) {
      next(err);
    } finally {
      release();
    }
  });

  return router;
}

