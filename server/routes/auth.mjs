import { randomBytes } from 'node:crypto';
import { config } from '../lib/config.mjs';
import { checkRate, clientIp, HttpError, readJson } from '../lib/http.mjs';
import {
  createSessionToken,
  hashPassword,
  hashToken,
  normalizePhone,
  phoneKey,
  signVerificationToken,
  verifyPassword,
  verifyVerificationToken,
} from '../lib/security.mjs';
import { serializeUser } from '../lib/model.mjs';

const CITY_COORDS = {
  Bouaflé: [6.9903, -5.7442],
  Daloa: [6.8776, -6.4502],
  Yamoussoukro: [6.8276, -5.2893],
  Abidjan: [5.3599, -4.0083],
};

const TINTS = ['#FFE0C7', '#FFF1C9', '#F4E3D3', '#E3F0E7', '#E4E8F4'];

export function pushActivity(db, user, type, label) {
  db.prepare(
    `INSERT INTO activity (id, user_id, user_name, role, type, label, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    `act_${Date.now()}_${randomBytes(3).toString('hex')}`,
    user.id,
    user.name,
    user.role,
    type,
    label,
    new Date().toISOString(),
  );
}

export function createSession(db, userId) {
  const token = createSessionToken();
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at)
     VALUES (?,?,?,?,?)`,
  ).run(hashToken(token), userId, now, now + config.sessionTtlDays * 86_400_000, now);
  return token;
}

function findUserByPhone(db, phone) {
  const key = phoneKey(phone);
  if (key.length < 8) return null;
  return db.prepare('SELECT * FROM users WHERE phone_key = ?').get(key) ?? null;
}

function authPayload(db, user, baseUrl) {
  const kyc = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(user.id);
  return serializeUser(user, kyc, baseUrl);
}

const DEMO_ACCOUNTS = { client: 'demo-client', grossiste: 'demo-seller' };

export async function demoLogin(db, req, ctx) {
  if (!config.demoSeed) {
    throw new HttpError(404, 'Compte de démonstration indisponible.', 'DEMO_DISABLED');
  }
  if (!checkRate(`demo:${clientIp(req)}`, 30, 15 * 60_000)) {
    throw new HttpError(429, 'Trop de tentatives. Réessayez plus tard.', 'RATE_LIMITED');
  }

  const body = await readJson(req);
  const role = body.role === 'grossiste' ? 'grossiste' : 'client';
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(DEMO_ACCOUNTS[role]);
  if (!user || user.role !== role || user.status !== 'actif') {
    throw new HttpError(
      503,
      'Le compte de démonstration est indisponible. Réinitialisez les données de démonstration.',
      'DEMO_UNAVAILABLE',
    );
  }

  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    user.id,
  );
  pushActivity(db, user, 'connexion', 'Connexion à la démonstration SUGU');

  const token = createSession(db, user.id);
  return { token, user: authPayload(db, user, ctx.baseUrl) };
}

export async function register(db, req, ctx) {
  const body = await readJson(req);
  const name = String(body.name ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const password = String(body.password ?? '');
  const role = body.role === 'grossiste' ? 'grossiste' : 'client';
  const city = String(body.city ?? '').trim() || 'Bouaflé';

  if (name.length < 2) {
    throw new HttpError(400, 'Indiquez votre nom complet.', 'INVALID_NAME');
  }
  if (phoneKey(phone).length < 8) {
    throw new HttpError(400, 'Numéro de téléphone invalide.', 'INVALID_PHONE');
  }
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    throw new HttpError(400, 'Numéro de téléphone invalide.', 'INVALID_PHONE');
  }
  if (password.length < 6) {
    throw new HttpError(400, 'Choisissez un mot de passe d’au moins 6 caractères.', 'WEAK_PASSWORD');
  }
  if (!checkRate(`register:${clientIp(req)}`, 10, 15 * 60_000)) {
    throw new HttpError(429, 'Trop de créations de compte. Réessayez plus tard.', 'RATE_LIMITED');
  }
  if (findUserByPhone(db, phone)) {
    throw new HttpError(
      409,
      'Un compte SUGU existe déjà avec ce numéro. Connectez-vous.',
      'PHONE_TAKEN',
    );
  }

  const credentials = hashPassword(password);
  const now = new Date().toISOString();
  const id = `u_${Date.now()}_${randomBytes(3).toString('hex')}`;
  let sellerId = null;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (role === 'grossiste') {
      sellerId = `w_${Date.now()}_${randomBytes(3).toString('hex')}`;
      const [lat, lng] = CITY_COORDS[city] ?? CITY_COORDS.Bouaflé;
      const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('');
      db.prepare(
        `INSERT INTO wholesalers (id, owner_id, name, city, district, distance_km, rating,
          reviews, verified, since, phone, hours, open, x, y, lat, lng, initials, tint)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        sellerId, id, name, city, 'À renseigner', 0, 5, 0, 0, new Date().getFullYear(),
        phone, '06:00 – 18:00', 1, 0.5, 0.5, lat, lng, initials, TINTS[Date.now() % TINTS.length],
      );
    }

    db.prepare(
      `INSERT INTO users (id, name, phone, phone_key, role, city, status, seller_id,
        password_hash, password_salt, created_at, last_active_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, name, phone, phoneKey(phone), role, city, 'actif', sellerId,
      credentials.hash, credentials.salt, now, now,
    );

    db.prepare('INSERT INTO kyc (user_id, status) VALUES (?, ?)').run(id, 'non_verifie');

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    pushActivity(
      db,
      user,
      'inscription',
      role === 'grossiste' ? 'Création d’un compte grossiste' : 'Création d’un compte commerçant',
    );
    db.exec('COMMIT');

    // La session n’est ouverte qu’après validation du code reçu par WhatsApp/SMS.
    return {
      ok: true,
      user: authPayload(db, user, ctx.baseUrl),
      loginToken: signVerificationToken(normalizedPhone, 'login_password'),
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }
}

export async function login(db, req, ctx) {
  const body = await readJson(req);
  const phone = String(body.phone ?? '').trim();
  const password = String(body.password ?? '');
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    throw new HttpError(400, 'Numéro de téléphone invalide.', 'INVALID_PHONE');
  }

  if (!checkRate(`login-ip:${clientIp(req)}`, 30, 15 * 60_000)) {
    throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'RATE_LIMITED');
  }
  if (!checkRate(`login-phone:${phoneKey(phone)}`, 10, 15 * 60_000)) {
    throw new HttpError(429, 'Trop de tentatives pour ce numéro.', 'RATE_LIMITED');
  }

  const user = findUserByPhone(db, phone);
  if (!user) {
    throw new HttpError(
      404,
      'Aucun compte SUGU n’est associé à ce numéro.',
      'ACCOUNT_NOT_FOUND',
    );
  }
  if (user.status === 'supprime') {
    throw new HttpError(403, 'Ce compte a été supprimé par l’administration.', 'ACCOUNT_DELETED');
  }
  if (user.status === 'suspendu') {
    throw new HttpError(
      403,
      'Ce compte est suspendu. Contactez le support SUGU pour le réactiver.',
      'ACCOUNT_SUSPENDED',
    );
  }
  if (!user.password_hash) {
    throw new HttpError(
      401,
      'Ce compte n’a pas encore de mot de passe. Utilisez « Mot de passe oublié ? ».',
      'PASSWORD_NOT_SET',
    );
  }
  if (!verifyPassword(password, user.password_salt, user.password_hash)) {
    throw new HttpError(
      401,
      user.role === 'admin' ? 'Mot de passe administrateur incorrect.' : 'Mot de passe incorrect.',
      'INVALID_PASSWORD',
    );
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(now, user.id);

  // Le mot de passe est validé, mais aucune session n’est créée ici.
  // Le client doit encore confirmer le code OTP via /api/auth/login/verify.
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  return {
    ok: true,
    user: authPayload(db, fresh, ctx.baseUrl),
    loginToken: signVerificationToken(normalizedPhone, 'login_password'),
  };
}

export async function verifyLogin(db, req, ctx) {
  const body = await readJson(req);
  const phone = String(body.phone ?? '').trim();
  const loginToken = String(body.loginToken ?? '');
  const verificationToken = String(body.verificationToken ?? '');

  const passwordProof = verifyVerificationToken(loginToken);
  const otpProof = verifyVerificationToken(verificationToken);
  if (!passwordProof || passwordProof.purpose !== 'login_password') {
    throw new HttpError(
      401,
      'Mot de passe non validé. Reconnectez-vous.',
      'INVALID_LOGIN_PROOF',
    );
  }
  if (!otpProof || otpProof.purpose !== 'login') {
    throw new HttpError(
      401,
      'Code de vérification invalide ou expiré. Demandez un nouveau code.',
      'INVALID_VERIFICATION',
    );
  }

  const normalized = normalizePhone(phone);
  if (!normalized || passwordProof.phone !== normalized || otpProof.phone !== normalized) {
    throw new HttpError(401, 'Le code ne correspond pas à ce numéro.', 'PHONE_MISMATCH');
  }

  const user = findUserByPhone(db, phone);
  if (!user) {
    throw new HttpError(404, 'Aucun compte SUGU n’est associé à ce numéro.', 'ACCOUNT_NOT_FOUND');
  }
  if (user.status === 'supprime') {
    throw new HttpError(403, 'Ce compte a été supprimé par l’administration.', 'ACCOUNT_DELETED');
  }
  if (user.status === 'suspendu') {
    throw new HttpError(
      403,
      'Ce compte est suspendu. Contactez le support SUGU pour le réactiver.',
      'ACCOUNT_SUSPENDED',
    );
  }

  const token = createSession(db, user.id);
  pushActivity(
    db,
    user,
    'connexion',
    user.role === 'admin' ? 'Connexion à l’espace admin' : 'Connexion à l’application',
  );
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  return { token, user: authPayload(db, fresh, ctx.baseUrl) };
}

export async function logout(db, req, ctx) {
  if (ctx.tokenHash) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(ctx.tokenHash);
  }
  if (ctx.user) {
    pushActivity(db, ctx.user, 'deconnexion', 'Déconnexion');
  }
  return { ok: true };
}

export async function me(db, req, ctx) {
  return { user: authPayload(db, ctx.user, ctx.baseUrl) };
}

export async function resetPassword(db, req, ctx) {
  const body = await readJson(req);
  const phone = String(body.phone ?? '').trim();
  const newPassword = String(body.newPassword ?? '');
  const token = String(body.verificationToken ?? '');

  const payload = verifyVerificationToken(token);
  if (!payload || payload.purpose !== 'password_reset') {
    throw new HttpError(
      401,
      'Code de vérification invalide ou expiré. Demandez un nouveau code.',
      'INVALID_VERIFICATION',
    );
  }
  if (payload.phone !== normalizePhone(phone)) {
    throw new HttpError(
      401,
      'Le code ne correspond pas à ce numéro.',
      'PHONE_MISMATCH',
    );
  }
  if (newPassword.length < 6) {
    throw new HttpError(400, 'Choisissez un mot de passe d’au moins 6 caractères.', 'WEAK_PASSWORD');
  }

  const user = findUserByPhone(db, phone);
  if (!user) {
    throw new HttpError(404, 'Aucun compte SUGU n’est associé à ce numéro.', 'ACCOUNT_NOT_FOUND');
  }
  if (user.status === 'supprime') {
    throw new HttpError(403, 'Ce compte a été supprimé par l’administration.', 'ACCOUNT_DELETED');
  }
  if (user.status === 'suspendu') {
    throw new HttpError(
      403,
      'Ce compte est suspendu. Contactez le support SUGU pour le réactiver.',
      'ACCOUNT_SUSPENDED',
    );
  }

  const credentials = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(
    credentials.hash,
    credentials.salt,
    user.id,
  );
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  pushActivity(db, user, 'mot_de_passe', 'Mot de passe réinitialisé');

  return { ok: true };
}
