import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { config, mockMode, smsReady, whatsappReady } from './lib/config.mjs';
import { openDatabase } from './lib/db.mjs';
import {
  baseUrl,
  corsHeaders,
  getSessionUser,
  HttpError,
  json,
  noContent,
  sweepRateBuckets,
} from './lib/http.mjs';
import { hashToken } from './lib/security.mjs';
import { Router } from './lib/router.mjs';
import { bootstrap } from './lib/model.mjs';
import { seedDatabase } from './seed.mjs';
import { login, logout, me, register, resetPassword, demoLogin, verifyLogin } from './routes/auth.mjs';
import { requestCode, verifyCode } from './routes/otp.mjs';
import {
  createProduct,
  getCatalog,
  getMyProducts,
  getProductPhoto,
  getWholesaler,
  updateProduct,
} from './routes/catalog.mjs';
import {
  createOrder,
  listMessages,
  listOrders,
  sendMessage,
  updateOrderStatus,
} from './routes/orders.mjs';
import {
  deleteAccount,
  listActivity,
  listUsers,
  reviewKyc,
  setAccountStatus,
  userDetail,
} from './routes/admin.mjs';
import { getKycFile, submitKyc } from './routes/kyc.mjs';
import { requireUser } from './lib/http.mjs';

const db = openDatabase();
const seeded = config.demoSeed ? seedDatabase(db) : false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const PUBLIC_ROOT = path.resolve(config.publicDir);

function sendStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }

  let relative = decoded.replace(/^\/+/, '');
  if (!relative) relative = 'index.html';

  const safe = relative
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..' && !part.startsWith('.'));
  if (safe.length === 0) return false;
  if (safe[0] === 'server') return false;

  let filePath = path.join(PUBLIC_ROOT, ...safe);
  let info;
  try {
    info = statSync(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = statSync(filePath);
    }
  } catch {
    return false;
  }
  if (!info.isFile()) return false;

  const mime = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const immutable = mime.startsWith('image/') || mime.startsWith('font/');
  res.writeHead(200, {
    'content-type': mime,
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=86400' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...corsHeaders(req),
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const router = new Router();

router.get('/health', () => ({
  ok: true,
  service: 'sugu-api',
  mock: mockMode,
  seeded,
  providers: { whatsapp: whatsappReady, sms: smsReady, smsProvider: config.smsProvider },
}));

router.post('/api/auth/register', register);
router.post('/api/auth/login', login);
router.post('/api/auth/login/verify', verifyLogin);
router.post('/api/auth/demo', demoLogin);
router.post('/api/auth/logout', logout, { auth: true });
router.get('/api/me', me, { auth: true });
router.post('/api/auth/password/reset', resetPassword);
router.post('/api/auth/code/request', requestCode);
router.post('/api/auth/code/verify', verifyCode);

router.get(
  '/api/bootstrap',
  (database, req, ctx) => bootstrap(database, requireUser(ctx), ctx.baseUrl),
  { auth: true },
);

router.get('/api/catalog', getCatalog);
router.get('/api/wholesalers/:id', getWholesaler);
router.get('/api/products', getMyProducts, { auth: true });
router.get('/api/products/:id/photo', getProductPhoto);
router.post('/api/products', createProduct, { auth: true });
router.patch('/api/products/:id', updateProduct, { auth: true });

router.get('/api/orders', listOrders, { auth: true });
router.post('/api/orders', createOrder, { auth: true });
router.patch('/api/orders/:id/status', updateOrderStatus, { auth: true });

router.get('/api/messages', listMessages, { auth: true });
router.post('/api/messages/:threadId', sendMessage, { auth: true });

router.get('/api/admin/users', listUsers, { auth: true });
router.get('/api/admin/users/:id', userDetail, { auth: true });
router.post('/api/admin/users/:id/kyc', reviewKyc, { auth: true });
router.patch('/api/admin/users/:id/status', setAccountStatus, { auth: true });
router.delete('/api/admin/users/:id', deleteAccount, { auth: true });
router.get('/api/admin/activity', listActivity, { auth: true });

router.post('/api/kyc', submitKyc, { auth: true });
router.get('/api/kyc/:userId/:kind', getKycFile);

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  const isApi =
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/health';
  if (req.method === 'GET' && !isApi) {
    if (sendStatic(req, res, url.pathname)) return;
  }

  const match = router.match(req.method ?? 'GET', url.pathname);

  if (!match) {
    json(req, res, 404, { ok: false, error: 'Route introuvable.', code: 'NOT_FOUND' });
    return;
  }
  if (match.methodNotAllowed) {
    json(req, res, 405, { ok: false, error: 'Méthode non autorisée.', code: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const header = req.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : null;
  const user = token ? getSessionUser(db, req) : null;

  const ctx = {
    db,
    params: match.params,
    user,
    tokenHash: token ? hashToken(token) : null,
    baseUrl: baseUrl(req),
  };

  try {
    if (match.route.options.auth && !user) {
      throw new HttpError(401, 'Session expirée. Reconnectez-vous.', 'UNAUTHENTICATED');
    }

    const result = await match.route.handler(db, req, ctx, res);
    if (res.writableEnded) return;
    if (result === undefined) {
      noContent(req, res);
      return;
    }
    json(req, res, 200, result);
  } catch (error) {
    if (res.writableEnded) return;
    if (error instanceof HttpError) {
      json(req, res, error.status, {
        ok: false,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
      return;
    }
    console.error('[SUGU API] Erreur serveur :', error);
    json(req, res, 500, {
      ok: false,
      error: 'Erreur interne du serveur.',
      code: 'INTERNAL_ERROR',
    });
  }
});

server.listen(config.port, () => {
  console.log(`[SUGU API] Serveur prêt sur http://localhost:${config.port}`);
  console.log(
    `[SUGU API] OTP : ${
      mockMode
        ? 'simulation (aucune clé fournisseur)'
        : `WhatsApp ${whatsappReady ? 'actif' : 'inactif'} · SMS ${smsReady ? 'actif' : 'inactif'}`
    }`,
  );
  console.log(
    `[SUGU API] Base : ${config.dbPath}${seeded ? ' (données de démonstration créées)' : ''}`,
  );
  if (mockMode) {
    console.log('[SUGU API] Les codes de test sont affichés dans ce terminal.');
  }
});

setInterval(() => {
  const now = Date.now();
  db.prepare('DELETE FROM otp_codes WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  sweepRateBuckets();
}, 60_000).unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      try {
        db.close();
      } catch {
        // ignore
      }
      process.exit(0);
    });
  });
}

export { server, db };
