import {
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { config } from './config.mjs';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = scryptSync(String(password), salt, SCRYPT_KEYLEN);
  let expected;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function signVerificationToken(phone, purpose) {
  const payload = Buffer.from(
    JSON.stringify({ phone, purpose, exp: Date.now() + 10 * 60_000 }),
  ).toString('base64url');
  const signature = createHmac('sha256', config.otpSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyVerificationToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', config.otpSecret).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed?.phone || !parsed?.purpose || !parsed?.exp) return null;
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hashCode(phone, purpose, code) {
  return createHmac('sha256', config.otpSecret)
    .update(`${purpose}:${phone}:${code}`)
    .digest('hex');
}

export function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a), 'hex');
    const right = Buffer.from(String(b), 'hex');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function signFileAccess(userId, kind, expiresAt) {
  const signature = createHmac('sha256', config.otpSecret)
    .update(`kyc:${userId}:${kind}:${expiresAt}`)
    .digest('hex');
  return `exp=${expiresAt}&sig=${signature}`;
}

export function verifyFileAccess(userId, kind, expires, signature) {
  const expected = createHmac('sha256', config.otpSecret)
    .update(`kyc:${userId}:${kind}:${expires}`)
    .digest('hex');
  if (Number(expires) < Date.now()) return false;
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function phoneKey(raw) {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith(config.defaultCountryCode) && digits.length === 13) {
    digits = digits.slice(config.defaultCountryCode.length);
  }
  return digits;
}

export function normalizePhone(raw) {
  const digits = phoneKey(raw);
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${config.defaultCountryCode}${digits}`;
}
