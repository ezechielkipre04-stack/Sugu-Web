import { signFileAccess } from './security.mjs';

const KYC_KINDS = { front: 'front_path', back: 'back_path', selfie: 'selfie_path' };
const KYC_TTL = 60 * 60_000;

export function kycFileUrl(baseUrl, userId, kind, row) {
  const column = KYC_KINDS[kind];
  if (!row?.[column]) return undefined;
  const expires = Date.now() + KYC_TTL;
  return `${baseUrl}/api/kyc/${encodeURIComponent(userId)}/${kind}?${signFileAccess(userId, kind, expires)}`;
}

export function serializeKyc(row, userId, baseUrl) {
  if (!row) return { status: 'non_verifie' };
  return {
    status: row.status,
    fullName: row.full_name ?? undefined,
    documentType: row.document_type ?? undefined,
    documentNumber: row.document_number ?? undefined,
    documentFrontUri: kycFileUrl(baseUrl, userId, 'front', row),
    documentBackUri: kycFileUrl(baseUrl, userId, 'back', row),
    selfieUri: kycFileUrl(baseUrl, userId, 'selfie', row),
    submittedAt: row.submitted_at ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    rejectionReason: row.rejection_reason ?? undefined,
  };
}

export function serializeUser(user, kycRow, baseUrl) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    role: user.role,
    city: user.city,
    sellerId: user.seller_id ?? undefined,
    createdAt: user.created_at,
    lastActiveAt: user.last_active_at,
    status: user.status,
    kyc: serializeKyc(kycRow, user.id, baseUrl),
  };
}

export function serializeWholesaler(row) {
  return {
    id: row.id,
    ownerId: row.owner_id ?? undefined,
    name: row.name,
    city: row.city,
    district: row.district,
    distanceKm: row.distance_km,
    rating: row.rating,
    reviews: row.reviews,
    verified: Boolean(row.verified),
    since: row.since,
    phone: row.phone,
    hours: row.hours,
    open: Boolean(row.open),
    x: row.x,
    y: row.y,
    lat: row.lat,
    lng: row.lng,
    initials: row.initials,
    tint: row.tint,
  };
}

export function serializeProduct(row, baseUrl) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    unit: row.unit,
    stock: row.stock,
    minQty: row.min_qty,
    sellerId: row.seller_id,
    image: row.image,
    imageUrl:
      row.image_path && baseUrl
        ? `${baseUrl}/api/products/${encodeURIComponent(row.id)}/photo`
        : undefined,
    tag: row.tag ?? undefined,
    description: row.description,
    active: Boolean(row.active),
  };
}

export function serializeOrder(row, items, baseUrl, photoIds) {
  return {
    id: row.id,
    ref: row.ref,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    phone: row.phone,
    city: row.city,
    address: row.address,
    note: row.note ?? undefined,
    payment: row.payment,
    items: items.map((item) => ({
      productId: item.product_id,
      sellerId: item.seller_id,
      name: item.name,
      price: item.price,
      qty: item.qty,
      unit: item.unit,
      image: item.image,
      imageUrl:
        baseUrl && photoIds?.has(item.product_id)
          ? `${baseUrl}/api/products/${encodeURIComponent(item.product_id)}/photo`
          : undefined,
    })),
    subtotal: row.subtotal,
    deliveryFee: row.delivery_fee,
    total: row.total,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeMessage(row, viewerId) {
  return {
    id: row.id,
    threadId: row.thread_id,
    author: row.sender_id === viewerId ? 'me' : 'them',
    text: row.text,
    at: row.created_at,
  };
}

export function serializeActivity(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    role: row.role,
    type: row.type,
    label: row.label,
    at: row.created_at,
  };
}

export function loadOrders(db, rows, baseUrl) {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => '?').join(',');
  const items = db
    .prepare(
      `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY id ASC`,
    )
    .all(...rows.map((row) => row.id));
  const grouped = new Map();
  for (const item of items) {
    const list = grouped.get(item.order_id) ?? [];
    list.push(item);
    grouped.set(item.order_id, list);
  }

  const photoIds = new Set();
  if (baseUrl) {
    const productIds = [...new Set(items.map((item) => item.product_id))];
    if (productIds.length > 0) {
      const productPlaceholders = productIds.map(() => '?').join(',');
      const rowsWithPhoto = db
        .prepare(
          `SELECT id FROM products WHERE image_path IS NOT NULL AND id IN (${productPlaceholders})`,
        )
        .all(...productIds);
      for (const row of rowsWithPhoto) photoIds.add(row.id);
    }
  }

  return rows.map((row) =>
    serializeOrder(row, grouped.get(row.id) ?? [], baseUrl, photoIds),
  );
}

export function scopedOrders(db, user, baseUrl, limit = 500) {
  if (user.role === 'admin') {
    return loadOrders(
      db,
      db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit),
      baseUrl,
    );
  }
  if (user.role === 'grossiste' && user.seller_id) {
    return loadOrders(
      db,
      db
        .prepare(
          `SELECT DISTINCT o.* FROM orders o
             JOIN order_items oi ON oi.order_id = o.id
            WHERE oi.seller_id = ?
            ORDER BY o.created_at DESC
            LIMIT ?`,
        )
        .all(user.seller_id, limit),
      baseUrl,
    );
  }
  return loadOrders(
    db,
    db
      .prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(user.id, limit),
    baseUrl,
  );
}

export function scopedMessages(db, user, limit = 500) {
  if (user.role === 'admin') {
    return db
      .prepare('SELECT * FROM messages ORDER BY created_at ASC LIMIT ?')
      .all(limit);
  }
  if (user.role === 'grossiste' && user.seller_id) {
    return db
      .prepare(
        'SELECT * FROM messages WHERE thread_id = ? OR sender_id = ? ORDER BY created_at ASC LIMIT ?',
      )
      .all(user.seller_id, user.id, limit);
  }
  return db
    .prepare('SELECT * FROM messages WHERE client_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(user.id, limit);
}

export function scopedActivity(db, user, limit = 300) {
  if (user.role === 'admin') {
    return db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT ?').all(limit);
  }
  return db
    .prepare('SELECT * FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(user.id, limit);
}

export function scopedProducts(db, user) {
  if (user.role === 'admin') {
    return db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  }
  if (user.role === 'grossiste' && user.seller_id) {
    return db
      .prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC')
      .all(user.seller_id);
  }
  return db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC').all();
}

export function bootstrap(db, user, baseUrl) {
  const kycRow = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(user.id);
  const users =
    user.role === 'admin'
      ? db
          .prepare('SELECT * FROM users ORDER BY created_at DESC')
          .all()
          .map((row) =>
            serializeUser(row, db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(row.id), baseUrl),
          )
      : [];

  return {
    user: serializeUser(user, kycRow, baseUrl),
    users,
    products: scopedProducts(db, user).map((row) => serializeProduct(row, baseUrl)),
    wholesalers: db.prepare('SELECT * FROM wholesalers ORDER BY distance_km ASC').all().map(serializeWholesaler),
    orders: scopedOrders(db, user, baseUrl),
    messages: scopedMessages(db, user).map((row) => serializeMessage(row, user.id)),
    activity: scopedActivity(db, user).map(serializeActivity),
  };
}

export function adminUserDetail(db, userId, baseUrl) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return null;
  const kycRow = db.prepare('SELECT * FROM kyc WHERE user_id = ?').get(userId);
  const orders = loadOrders(
    db,
    db.prepare('SELECT * FROM orders WHERE buyer_id = ? ORDER BY created_at DESC').all(userId),
    baseUrl,
  );
  const products = user.seller_id
    ? db
        .prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC')
        .all(user.seller_id)
        .map((row) => serializeProduct(row, baseUrl))
    : [];
  const activity = db
    .prepare('SELECT * FROM activity WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .all(userId)
    .map(serializeActivity);
  return {
    user: serializeUser(user, kycRow, baseUrl),
    orders,
    products,
    activity,
    stats: {
      orderCount: orders.length,
      revenue: orders.reduce((sum, order) => sum + order.total, 0),
      productCount: products.length,
    },
  };
}
