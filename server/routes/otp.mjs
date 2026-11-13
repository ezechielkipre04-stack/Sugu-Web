import { randomInt } from 'node:crypto';
import { config } from '../lib/config.mjs';
import { deliverCode } from '../lib/delivery.mjs';
import { checkRate, clientIp, HttpError, readJson } from '../lib/http.mjs';
import {
  hashCode,
  normalizePhone,
  safeEqualHex,
  signVerificationToken,
} from '../lib/security.mjs';

const PURPOSES = new Set(['kyc', 'password_reset', 'login']);

export async function requestCode(db, req) {
  const body = await readJson(req);
  const phone = normalizePhone(body.phone);
  if (!phone) {
    throw new HttpError(400, 'Numéro de téléphone invalide.', 'INVALID_PHONE');
  }

  const channel = body.channel === 'sms' ? 'sms' : 'whatsapp';
  const purpose = PURPOSES.has(body.purpose) ? body.purpose : 'login';

  if (!checkRate(`otp-phone:${purpose}:${phone}`, 5, 15 * 60_000)) {
    throw new HttpError(
      429,
      'Trop de demandes pour ce numéro. Réessayez dans quelques minutes.',
      'RATE_LIMITED',
    );
  }
  if (!checkRate(`otp-ip:${clientIp(req)}`, 30, 15 * 60_000)) {
    throw new HttpError(
      429,
      'Trop de demandes depuis cet appareil. Réessayez dans quelques minutes.',
      'RATE_LIMITED',
    );
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(
    `INSERT INTO otp_codes (phone, purpose, hash, expires_at, attempts)
     VALUES (?,?,?,?,0)
     ON CONFLICT(phone, purpose) DO UPDATE SET
       hash = excluded.hash,
       expires_at = excluded.expires_at,
       attempts = 0`,
  ).run(phone, purpose, hashCode(phone, purpose, code), Date.now() + config.otpTtlSeconds * 1000);

  let deliveredChannel;
  try {
    deliveredChannel = await deliverCode(phone, channel, code);
  } catch (error) {
    db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(phone, purpose);
    console.error('[SUGU OTP] Envoi impossible :', error?.message ?? error);
    throw new HttpError(
      502,
      'Impossible d’envoyer le code pour le moment. Réessayez.',
      'DELIVERY_FAILED',
    );
  }

  return {
    ok: true,
    expiresIn: config.otpTtlSeconds,
    channel: deliveredChannel,
    mock: deliveredChannel === 'mock',
    ...(config.otpDebug ? { debugCode: code } : {}),
  };
}

export async function verifyCode(db, req) {
  const body = await readJson(req);
  const phone = normalizePhone(body.phone);
  const code = String(body.code ?? '').replace(/\D/g, '');
  const purpose = PURPOSES.has(body.purpose) ? body.purpose : 'login';

  if (!phone) {
    throw new HttpError(400, 'Numéro de téléphone invalide.', 'INVALID_PHONE');
  }
  if (!/^\d{6}$/.test(code)) {
    throw new HttpError(400, 'Entrez le code à 6 chiffres.', 'INVALID_CODE');
  }

  const entry = db
    .prepare('SELECT * FROM otp_codes WHERE phone = ? AND purpose = ?')
    .get(phone, purpose);

  if (!entry || entry.expires_at < Date.now()) {
    db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(phone, purpose);
    throw new HttpError(
      400,
      'Code expiré ou introuvable. Demandez un nouveau code.',
      'CODE_EXPIRED',
    );
  }

  const attempts = entry.attempts + 1;
  if (attempts > config.otpMaxAttempts) {
    db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(phone, purpose);
    throw new HttpError(429, 'Trop de tentatives. Demandez un nouveau code.', 'TOO_MANY_ATTEMPTS');
  }
  db.prepare('UPDATE otp_codes SET attempts = ? WHERE phone = ? AND purpose = ?').run(
    attempts,
    phone,
    purpose,
  );

  if (!safeEqualHex(entry.hash, hashCode(phone, purpose, code))) {
    throw new HttpError(400, 'Code incorrect.', 'WRONG_CODE');
  }

  db.prepare('DELETE FROM otp_codes WHERE phone = ? AND purpose = ?').run(phone, purpose);

  return {
    ok: true,
    verificationToken: signVerificationToken(phone, purpose),
    expiresIn: 600,
  };
}
