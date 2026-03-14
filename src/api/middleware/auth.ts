import { timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../../types.js';

/**
 * Basic Auth middleware.
 * Activated only when config.api.auth is present.
 * /api/health is always public (for health checks).
 */
export function createBasicAuthMiddleware(config: AppConfig) {
  const authConfig = config.api.auth;

  if (!authConfig?.username || !authConfig?.password) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const expectedCredentials = Buffer.from(
    `${authConfig.username}:${authConfig.password}`,
  ).toString('base64');

  return (req: Request, res: Response, next: NextFunction) => {
    if (
      req.path === '/api/health' &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="nakama"').json({ error: 'Authentication required' });
      return;
    }

    const provided = authHeader.slice(6);
    const a = Buffer.from(provided);
    const b = Buffer.from(expectedCredentials);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="nakama"').json({ error: 'Invalid credentials' });
      return;
    }

    next();
  };
}
