import { HttpError, readJson, requireRole } from '../lib/http.mjs';
import {
  adminUserDetail,
  scopedActivity,
  serializeActivity,
  serializeUser,
} from '../lib/model.mjs';
import { pushActivity } from './auth.mjs';

export async function listUsers(db, req, ctx) {
  requireRole(ctx, ['admin']);
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  return {
    users: rows.map((row) =>
      serializeUser(
        row,
        db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(row.id),
        ctx.baseUrl,
      ),
    ),
  };
}

export async function userDetail(db, req, ctx) {
  requireRole(ctx, ['admin']);
  const detail = adminUserDetail(db, ctx.params.id, ctx.baseUrl);
  if (!detail) throw new HttpError(404, 'Compte introuvable.', 'NOT_FOUND');
  return detail;
}

export async function reviewKyc(db, req, ctx) {
  const admin = requireRole(ctx, ['admin']);
  const body = await readJson(req);
  const decision = body.decision === 'verifie' ? 'verifie' : body.decision === 'rejete' ? 'rejete' : null;
  if (!decision) throw new HttpError(400, 'Décision invalide.', 'INVALID_DECISION');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) throw new HttpError(404, 'Compte introuvable.', 'NOT_FOUND');

  const kycRow = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(target.id);
  if (!kycRow || kycRow.status !== 'en_attente') {
    throw new HttpError(409, 'Aucun dossier en attente pour ce compte.', 'NO_PENDING_KYC');
  }

  const reason =
    decision === 'rejete'
      ? String(body.reason ?? '').trim() || 'Dossier non conforme.'
      : null;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE kyc SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?
      WHERE user_id = ?`,
  ).run(decision, now, admin.name, reason, target.id);

  pushActivity(
    db,
    target,
    decision === 'verifie' ? 'kyc_approuve' : 'kyc_rejete',
    decision === 'verifie'
      ? 'Identité vérifiée par l’administration'
      : 'Dossier d’identité rejeté',
  );

  return {
    ok: true,
    user: serializeUser(
      db.prepare('SELECT * FROM users WHERE id = ?').get(target.id),
      db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(target.id),
      ctx.baseUrl,
    ),
  };
}

export async function setAccountStatus(db, req, ctx) {
  const admin = requireRole(ctx, ['admin']);
  const body = await readJson(req);
  const status = body.status === 'actif' || body.status === 'suspendu' ? body.status : null;
  if (!status) throw new HttpError(400, 'Statut invalide.', 'INVALID_STATUS');

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) throw new HttpError(404, 'Compte introuvable.', 'NOT_FOUND');
  if (target.role === 'admin' || target.id === admin.id) {
    throw new HttpError(403, 'Ce compte ne peut pas être modifié.', 'FORBIDDEN');
  }

  const now = new Date().toISOString();
  db.prepare('UPDATE users SET status = ?, last_active_at = ? WHERE id = ?').run(status, now, target.id);
  if (status === 'suspendu') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  }

  pushActivity(
    db,
    target,
    status === 'suspendu' ? 'compte_suspendu' : 'compte_reactive',
    status === 'suspendu'
      ? 'Compte suspendu par l’administration'
      : 'Compte réactivé par l’administration',
  );

  return {
    ok: true,
    user: serializeUser(
      db.prepare('SELECT * FROM users WHERE id = ?').get(target.id),
      db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(target.id),
      ctx.baseUrl,
    ),
  };
}

export async function deleteAccount(db, req, ctx) {
  const admin = requireRole(ctx, ['admin']);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
  if (!target) throw new HttpError(404, 'Compte introuvable.', 'NOT_FOUND');
  if (target.role === 'admin' || target.id === admin.id) {
    throw new HttpError(403, 'Ce compte ne peut pas être supprimé.', 'FORBIDDEN');
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE users SET status = 'supprime', last_active_at = ? WHERE id = ?").run(now, target.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
  pushActivity(db, target, 'compte_supprime', 'Compte supprimé par l’administration');

  return { ok: true };
}

export async function listActivity(db, req, ctx) {
  const user = requireRole(ctx, ['admin']);
  return {
    activity: scopedActivity(db, user, 300).map(serializeActivity),
  };
}
