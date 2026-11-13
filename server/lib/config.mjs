import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SERVER_ROOT = fileURLToPath(new URL('..', import.meta.url));

try {
  process.loadEnvFile(path.join(SERVER_ROOT, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') {
    console.warn('[SUGU] Impossible de charger server/.env :', error?.message ?? error);
  }
}

const int = (value, fallback, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
};

export const config = {
  serverRoot: SERVER_ROOT,
  publicDir: process.env.PUBLIC_DIR ?? path.join(SERVER_ROOT, '..'),
  port: int(process.env.PORT, 4000, 1, 65535),
  appOrigins: (process.env.APP_ORIGIN ?? '*')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE ?? '225').replace(/\D/g, ''),
  // À activer uniquement derrière un reverse proxy de confiance : fait confiance
  // à `x-forwarded-for` / `x-forwarded-proto` pour l’IP client et les URLs signées.
  trustProxy: process.env.TRUST_PROXY === 'true',
  otpSecret: process.env.OTP_SECRET ?? 'sugu-dev-secret-change-me',
  otpTtlSeconds: int(process.env.OTP_TTL_SECONDS, 300, 60, 900),
  otpMaxAttempts: int(process.env.OTP_MAX_ATTEMPTS, 5, 1, 10),
  otpDebug: process.env.OTP_DEBUG === 'true',
  whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME ?? 'sugu_verification',
  whatsappTemplateLang: process.env.WHATSAPP_TEMPLATE_LANG ?? 'fr',
  whatsappApiVersion: process.env.WHATSAPP_API_VERSION ?? 'v22.0',
  smsProvider: (process.env.SMS_PROVIDER ?? 'twilio').toLowerCase(),
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioFrom: process.env.TWILIO_FROM ?? '',
  termiiApiKey: process.env.TERMII_API_KEY ?? '',
  termiiSenderId: process.env.TERMII_SENDER_ID ?? 'SUGU',
  dbPath: process.env.DB_PATH ?? path.join(SERVER_ROOT, 'data', 'sugu.db'),
  kycDir: process.env.KYC_DIR ?? path.join(SERVER_ROOT, 'data', 'kyc'),
  productsDir: process.env.PRODUCTS_DIR ?? path.join(SERVER_ROOT, 'data', 'products'),
  sessionTtlDays: int(process.env.SESSION_TTL_DAYS, 30, 1, 365),
  maxUploadBytes: int(process.env.MAX_UPLOAD_BYTES, 4 * 1024 * 1024, 100_000, 12 * 1024 * 1024),
  maxJsonBytes: int(process.env.MAX_JSON_BYTES, 20_000_000, 100_000, 40_000_000),
  demoSeed: process.env.DEMO_SEED !== 'false',
  autoVerifyKyc: process.env.AUTO_VERIFY_KYC !== 'false',
};

export const whatsappReady = Boolean(
  config.whatsappToken && config.whatsappPhoneNumberId && config.whatsappTemplateName,
);

export const smsReady =
  config.smsProvider === 'termii'
    ? Boolean(config.termiiApiKey && config.termiiSenderId)
    : Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioFrom);

export const mockMode = !whatsappReady && !smsReady;
