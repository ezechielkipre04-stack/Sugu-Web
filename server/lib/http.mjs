import { config } from './config.mjs';
import { hashToken } from './security.mjs';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed =
    config.appOrigins.includes('*') || !origin
      ? '*'
      : config.appOrigins.includes(origin)
        ? origin
        : null;
  if (!allowed) return {};
  return {
    'access-control-allow-origin': allowed,
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  };
}

export function json(req, res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...securityHeaders(),
    ...corsHeaders(req),
  });
  res.end(payload);
}

export function noContent(req, res) {
  res.writeHead(204, {
    'cache-control': 'no-store',
    ...securityHeaders(),
    ...corsHeaders(req),
  });
  res.end();
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > config.maxJsonBytes) {
        tooLarge = true;
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (tooLarge) {
        reject(new HttpError(413, 'Contenu trop volumineux.', 'PAYLOAD_TOO_LARGE'));
        return;
      }
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Corps JSON invalide.', 'INVALID_JSON'));
      }
    });
    req.on('error', () => reject(new HttpError(400, 'Requête interrompue.', 'REQUEST_ERROR')));
  });
}

export function baseUrl(req) {
  const forwardedProto = config.trustProxy ? req.headers['x-forwarded-proto'] : undefined;
  const proto =
    typeof forwardedProto === 'string' && forwardedProto.length > 0
      ? forwardedProto.split(',')[0].trim()
      : 'http';
  const host = req.headers.host ?? `localhost:${config.port}`;
  return `${proto}://${host}`;
}

export function clientIp(req) {
  if (!config.trustProxy) return req.socket.remoteAddress ?? 'unknown';
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

const buckets = new Map();

export function checkRate(key, limit, windowMs) {
  const cutoff = Date.now() - windowMs;
  const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp >= cutoff);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(Date.now());
  buckets.set(key, recent);
  return true;
}

export function sweepRateBuckets(windowMs = 15 * 60_000) {
  const cutoff = Date.now() - windowMs;
  for (const [key, timestamps] of buckets) {
    const recent = timestamps.filter((value) => value >= cutoff);
    if (recent.length === 0) buckets.delete(key);
    else buckets.set(key, recent);
  }
}

export function getSessionUser(db, req) {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.*, s.token_hash, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(hashToken(token));

  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  if (row.status !== 'actif') return null;

  return row;
}

export function requireUser(ctx) {
  if (!ctx.user) {
    throw new HttpError(401, 'Session expirée. Reconnectez-vous.', 'UNAUTHENTICATED');
  }
  return ctx.user;
}

export function requireRole(ctx, roles) {
  const user = requireUser(ctx);
  if (!roles.includes(user.role)) {
    throw new HttpError(403, 'Accès réservé.', 'FORBIDDEN');
  }
  return user;
}

export function sendFile(req, res, buffer, mime, cacheControl = 'private, max-age=300') {
  res.writeHead(200, {
    'content-type': mime,
    'content-length': buffer.length,
    'content-disposition': 'inline',
    'cache-control': cacheControl,
    ...securityHeaders(),
    ...corsHeaders(req),
  });
  res.end(buffer);
}
