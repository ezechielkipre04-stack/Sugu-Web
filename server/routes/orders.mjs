import { randomBytes } from 'node:crypto';
import { HttpError, readJson, requireRole, requireUser } from '../lib/http.mjs';
import { phoneKey } from '../lib/security.mjs';
import {
  loadOrders,
  scopedMessages,
  scopedOrders,
  serializeMessage,
} from '../lib/model.mjs';
import { pushActivity } from './auth.mjs';

const FREE_DELIVERY_THRESHOLD = 50_000;
const DELIVERY_FEE = 1_500;

const STATUSES = new Set([
  'en_attente',
  'confirmee',
  'preparation',
  'en_route',
  'livree',
  'annulee',
]);

const STATUS_LABELS = {
  en_attente: 'en attente',
  confirmee: 'confirmée',
  preparation: 'en préparation',
  en_route: 'en route',
  livree: 'livrée',
  annulee: 'annulée',
};

export async function createOrder(db, req, ctx) {
  const user = requireRole(ctx, ['client']);
  const kyc = db.prepare('SELECT status FROM kyc WHERE user_id = ?').get(user.id);
  if (kyc?.status !== 'verifie') {
    throw new HttpError(
      403,
      'Vérifiez votre identité avant de passer une précommande.',
      'KYC_REQUIRED',
    );
  }
  const body = await readJson(req);

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    throw new HttpError(400, 'Votre panier est vide.', 'EMPTY_CART');
  }

  const city = String(body.city ?? '').trim();
  const address = String(body.address ?? '').trim();
  const phone = String(body.phone ?? '').trim();
  const note = String(body.note ?? '').trim();
  const payment = body.payment === 'livraison' ? 'livraison' : 'mobile_money';

  if (city.length < 2) throw new HttpError(400, 'Choisissez une ville de livraison.', 'INVALID_CITY');
  if (address.length < 4) throw new HttpError(400, 'Indiquez une adresse de livraison.', 'INVALID_ADDRESS');
  if (phoneKey(phone).length < 8) throw new HttpError(400, 'Numéro de livraison invalide.', 'INVALID_PHONE');

  const requested = new Map();
  for (const raw of items) {
    const productId = String(raw?.productId ?? '');
    const qty = Math.round(Number(raw?.qty));
    if (!productId || !Number.isFinite(qty) || qty <= 0) {
      throw new HttpError(400, 'Ligne de commande invalide.', 'INVALID_ITEM');
    }
    requested.set(productId, (requested.get(productId) ?? 0) + qty);
  }

  const ids = [...requested.keys()];
  const placeholders = ids.map(() => '?').join(',');
  const products = db
    .prepare(`SELECT * FROM products WHERE id IN (${placeholders})`)
    .all(...ids);
  if (products.length !== ids.length) {
    throw new HttpError(409, 'Un produit du panier n’est plus disponible.', 'PRODUCT_MISSING');
  }

  const lines = [];
  for (const product of products) {
    const qty = requested.get(product.id);
    if (!product.active) {
      throw new HttpError(409, `« ${product.name} » n’est plus disponible.`, 'PRODUCT_INACTIVE');
    }
    if (product.stock < qty) {
      throw new HttpError(
        409,
        `Stock insuffisant pour « ${product.name} » (${product.stock} restant).`,
        'INSUFFICIENT_STOCK',
      );
    }
    lines.push({
      product,
      qty,
      name: product.name,
      price: product.price,
      unit: product.unit,
      image: product.image,
      sellerId: product.seller_id,
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
  const total = subtotal + deliveryFee;

  const id = `o_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const ref = `SG-${String(Math.floor(1000 + Math.random() * 9000))}`;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const line of lines) {
      const result = db
        .prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?')
        .run(line.qty, line.product.id, line.qty);
      if (Number(result.changes) === 0) {
        throw new HttpError(
          409,
          `Stock insuffisant pour « ${line.product.name} ».`,
          'INSUFFICIENT_STOCK',
        );
      }
    }

    db.prepare(
      `INSERT INTO orders (id, ref, buyer_id, buyer_name, phone, city, address, note, payment,
        subtotal, delivery_fee, total, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, ref, user.id, user.name, phone, city, address, note || null, payment,
      subtotal, deliveryFee, total, 'en_attente', now, now,
    );

    for (const line of lines) {
      db.prepare(
        `INSERT INTO order_items (order_id, product_id, seller_id, name, price, qty, unit, image)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(id, line.product.id, line.sellerId, line.name, line.price, line.qty, line.unit, line.image);
    }

    pushActivity(db, user, 'commande', `Précommande ${ref} · ${Math.round(total)} FCFA`);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }

  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  const rows = loadOrders(db, [row], ctx.baseUrl);
  return { order: rows[0] };
}

export async function listOrders(db, req, ctx) {
  const user = requireUser(ctx);
  return { orders: scopedOrders(db, user, ctx.baseUrl) };
}

export async function updateOrderStatus(db, req, ctx) {
  const user = requireUser(ctx);
  const body = await readJson(req);
  const status = STATUSES.has(body.status) ? body.status : null;
  if (!status) throw new HttpError(400, 'Statut de commande invalide.', 'INVALID_STATUS');

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(ctx.params.id);
  if (!order) throw new HttpError(404, 'Commande introuvable.', 'NOT_FOUND');

  if (user.role !== 'admin' && ['livree', 'annulee'].includes(order.status)) {
    throw new HttpError(409, 'Cette commande est déjà clôturée.', 'ORDER_CLOSED');
  }

  if (user.role === 'grossiste') {
    const owns = db
      .prepare('SELECT COUNT(*) AS count FROM order_items WHERE order_id = ? AND seller_id = ?')
      .get(order.id, user.seller_id);
    if (Number(owns?.count ?? 0) === 0) {
      throw new HttpError(403, 'Cette commande ne concerne pas votre boutique.', 'FORBIDDEN');
    }
    if (!['confirmee', 'preparation', 'en_route', 'livree', 'annulee'].includes(status)) {
      throw new HttpError(403, 'Statut non autorisé pour une boutique.', 'FORBIDDEN');
    }
  } else if (user.role === 'client') {
    if (order.buyer_id !== user.id) {
      throw new HttpError(403, 'Cette commande ne vous appartient pas.', 'FORBIDDEN');
    }
    if (!['livree', 'annulee'].includes(status)) {
      throw new HttpError(
        403,
        'Vous pouvez seulement confirmer la réception ou annuler la commande.',
        'FORBIDDEN',
      );
    }
  }

  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    if (status === 'annulee' && order.status !== 'annulee') {
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
      for (const item of items) {
        db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.qty, item.product_id);
      }
    }

    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now, order.id);
    pushActivity(db, user, 'commande_statut', `Commande ${order.ref} ${STATUS_LABELS[status]}`);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw error;
  }

  const rows = loadOrders(db, [db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)], ctx.baseUrl);
  return { order: rows[0] };
}

const AUTO_REPLIES = [
  'Bien reçu. Je vérifie le stock et je vous confirme dans un instant.',
  'Merci pour votre message. Le prix est ferme pour les quantités indiquées.',
  'Oui, c’est disponible. Vous pouvez passer commande directement sur SUGU.',
  'Je vous confirme la disponibilité demain matin dès l’ouverture.',
];

function pickReply(text) {
  const lower = text.toLowerCase();
  if (lower.includes('prix') || lower.includes('combien')) {
    return 'Le prix affiché sur SUGU est celui du gros. Une remise est possible à partir de 5 cartons.';
  }
  if (lower.includes('livr')) {
    return 'La livraison est possible sous 24 h selon votre quartier. Je vous confirme le créneau.';
  }
  if (lower.includes('stock') || lower.includes('disponible')) {
    return 'Oui, le stock est à jour sur SUGU. Je le réserve dès votre commande.';
  }
  return AUTO_REPLIES[Math.floor(Math.random() * AUTO_REPLIES.length)];
}

export async function sendMessage(db, req, ctx) {
  const user = requireUser(ctx);
  const body = await readJson(req);
  const threadId = ctx.params.threadId;
  const text = String(body.text ?? '').trim();

  if (text.length < 1 || text.length > 2_000) {
    throw new HttpError(400, 'Message vide ou trop long.', 'INVALID_MESSAGE');
  }

  const wholesaler = db.prepare('SELECT * FROM wholesalers WHERE id = ?').get(threadId);
  if (!wholesaler) throw new HttpError(404, 'Grossiste introuvable.', 'NOT_FOUND');

  let clientId;
  if (user.role === 'client') {
    clientId = user.id;
  } else if (user.role === 'grossiste') {
    if (user.seller_id !== threadId) {
      throw new HttpError(403, 'Cette conversation ne concerne pas votre boutique.', 'FORBIDDEN');
    }
    clientId = String(body.clientId ?? '');
    if (!clientId) throw new HttpError(400, 'Destinataire manquant.', 'INVALID_CLIENT');
  } else {
    clientId = String(body.clientId ?? '');
    if (!clientId) throw new HttpError(400, 'Destinataire manquant.', 'INVALID_CLIENT');
  }

  const id = `m_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (id, thread_id, client_id, sender_id, sender_name, text, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, threadId, clientId, user.id, user.name, text, now);

  pushActivity(db, user, 'message', `Message envoyé à ${wholesaler.name}`);

  let autoReply = null;
  if (user.role === 'client') {
    const sellerId = wholesaler.owner_id ?? `shop:${threadId}`;
    const replyId = `m_${Date.now()}_${randomBytes(3).toString('hex')}_r`;
    db.prepare(
      `INSERT INTO messages (id, thread_id, client_id, sender_id, sender_name, text, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(replyId, threadId, clientId, sellerId, wholesaler.name, pickReply(text), new Date(Date.now() + 1).toISOString());
    autoReply = serializeMessage(
      db.prepare('SELECT * FROM messages WHERE id = ?').get(replyId),
      user.id,
    );
  }

  return {
    message: serializeMessage(db.prepare('SELECT * FROM messages WHERE id = ?').get(id), user.id),
    autoReply,
  };
}

export async function listMessages(db, req, ctx) {
  const user = requireUser(ctx);
  return {
    messages: scopedMessages(db, user).map((row) => serializeMessage(row, user.id)),
  };
}
