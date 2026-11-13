import path from 'node:path';
import { config } from '../lib/config.mjs';
import { readImage, writeImage } from '../lib/images.mjs';
import { HttpError, readJson, requireUser, sendFile } from '../lib/http.mjs';
import {
  normalizePhone,
  verifyFileAccess,
  verifyVerificationToken,
} from '../lib/security.mjs';
import { serializeKyc } from '../lib/model.mjs';
import { pushActivity } from './auth.mjs';

const KINDS = { front: 'front_path', back: 'back_path', selfie: 'selfie_path' };
const DOCUMENT_TYPES = new Set(['cni', 'passeport', 'permis']);

function saveImage(userId, kind, dataUrl, previousPath) {
  return writeImage(path.join(config.kycDir, userId), kind, dataUrl, previousPath);
}

export async function submitKyc(db, req, ctx) {
  const user = requireUser(ctx);
  const body = await readJson(req);

  const payload = verifyVerificationToken(body.verificationToken);
  if (!payload || payload.purpose !== 'kyc') {
    throw new HttpError(
      401,
      'Code de vérification invalide ou expiré. Demandez un nouveau code.',
      'INVALID_VERIFICATION',
    );
  }
  if (payload.phone !== normalizePhone(user.phone)) {
    throw new HttpError(401, 'Le code ne correspond pas à votre numéro.', 'PHONE_MISMATCH');
  }

  const fullName = String(body.fullName ?? '').trim();
  const documentType = DOCUMENT_TYPES.has(body.documentType) ? body.documentType : null;
  const documentNumber = String(body.documentNumber ?? '').trim();

  if (fullName.length < 2) throw new HttpError(400, 'Indiquez votre nom complet.', 'INVALID_NAME');
  if (!documentType) throw new HttpError(400, 'Type de document invalide.', 'INVALID_DOCUMENT');
  if (documentNumber.length < 5) {
    throw new HttpError(400, 'Numéro de document invalide.', 'INVALID_DOCUMENT_NUMBER');
  }

  const existing = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(user.id);
  const uploads = {
    front: body.front ? saveImage(user.id, 'front', body.front, existing?.front_path) : existing?.front_path,
    back: body.back ? saveImage(user.id, 'back', body.back, existing?.back_path) : existing?.back_path,
    selfie: body.selfie ? saveImage(user.id, 'selfie', body.selfie, existing?.selfie_path) : existing?.selfie_path,
  };

  if (!uploads.front || !uploads.back || !uploads.selfie) {
    throw new HttpError(
      400,
      'Ajoutez le recto, le verso et le selfie de contrôle.',
      'MISSING_DOCUMENTS',
    );
  }

  const now = new Date().toISOString();
  const status = config.autoVerifyKyc ? 'verifie' : 'en_attente';
  db.prepare(
    `INSERT INTO kyc (user_id, status, full_name, document_type, document_number,
      front_path, back_path, selfie_path, submitted_at, reviewed_at, reviewed_by, rejection_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)
     ON CONFLICT(user_id) DO UPDATE SET
       status = excluded.status,
       full_name = excluded.full_name,
       document_type = excluded.document_type,
       document_number = excluded.document_number,
       front_path = excluded.front_path,
       back_path = excluded.back_path,
       selfie_path = excluded.selfie_path,
       submitted_at = excluded.submitted_at,
       reviewed_at = excluded.reviewed_at,
       reviewed_by = excluded.reviewed_by,
       rejection_reason = NULL`,
  ).run(
    user.id, status, fullName, documentType, documentNumber,
    uploads.front, uploads.back, uploads.selfie, now,
    config.autoVerifyKyc ? now : null,
    config.autoVerifyKyc ? 'Vérification automatique (démonstration)' : null,
  );

  pushActivity(
    db,
    user,
    config.autoVerifyKyc ? 'kyc_approuve' : 'kyc_soumis',
    config.autoVerifyKyc ? 'Dossier d’identité vérifié automatiquement' : 'Dossier d’identité soumis',
  );

  const row = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(user.id);
  return { ok: true, kyc: serializeKyc(row, user.id, ctx.baseUrl) };
}

export async function getKycFile(db, req, ctx, res) {
  const { userId, kind } = ctx.params;
  const column = KINDS[kind];
  if (!column) throw new HttpError(404, 'Fichier introuvable.', 'NOT_FOUND');

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const expires = url.searchParams.get('exp');
  const signature = url.searchParams.get('sig');
  if (!expires || !signature || !verifyFileAccess(userId, kind, expires, signature)) {
    throw new HttpError(403, 'Lien expiré. Rechargez la page.', 'EXPIRED_LINK');
  }

  const row = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(userId);
  const relative = row?.[column];
  if (!relative) throw new HttpError(404, 'Document introuvable.', 'NOT_FOUND');

  const image = readImage(path.join(config.kycDir, userId), relative);
  sendFile(req, res, image.buffer, image.mime);
}
