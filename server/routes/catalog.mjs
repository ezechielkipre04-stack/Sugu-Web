import { randomBytes } from 'node:crypto';
import { config } from '../lib/config.mjs';
import { deleteImage, readImage, writeImage } from '../lib/images.mjs';
import { HttpError, readJson, requireRole, requireUser, sendFile } from '../lib/http.mjs';
import { pushActivity } from './auth.mjs';
import {
  serializeProduct,
  serializeWholesaler,
} from '../lib/model.mjs';

const CATEGORIES = new Set([
  'alimentation',
  'vetements',
  'mode',
  'accessoires',
  'maison',
  'beaute',
  'electronique',
]);

const IMAGES = new Set([
  'rice', 'tomatoes', 'oil', 'mangoes', 'onions', 'maize',
  'fabric', 'tshirts', 'wax', 'dress', 'scarf', 'shoes',
  'watches', 'soap', 'buckets', 'utensils', 'shea', 'perfume',
  'coconut', 'headphones',
]);

function photoInput(body) {
  if (typeof body.photo === 'string' && body.photo.length > 0) return body.photo;
  if (typeof body.image === 'string' && body.image.startsWith('data:')) return body.image;
  return null;
}

export async function getCatalog(db, req, ctx) {
  return {
    wholesalers: db.prepare('SELECT * FROM wholesalers ORDER BY distance_km ASC').all().map(serializeWholesaler),
    products: db
      .prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC')
      .all()
      .map((row) => serializeProduct(row, ctx.baseUrl)),
  };
}

export async function getWholesaler(db, req, ctx) {
  const row = db.prepare('SELECT * FROM wholesalers WHERE id = ?').get(ctx.params.id);
  if (!row) throw new HttpError(404, 'Grossiste introuvable.', 'NOT_FOUND');
  const products = db
    .prepare('SELECT * FROM products WHERE seller_id = ? AND active = 1 ORDER BY created_at DESC')
    .all(row.id)
    .map((product) => serializeProduct(product, ctx.baseUrl));
  return { wholesaler: serializeWholesaler(row), products };
}

export async function getProductPhoto(db, req, ctx, res) {
  const row = db.prepare('SELECT image_path FROM products WHERE id = ?').get(ctx.params.id);
  if (!row?.image_path) throw new HttpError(404, 'Photo introuvable.', 'NOT_FOUND');
  const image = readImage(config.productsDir, row.image_path);
  sendFile(req, res, image.buffer, image.mime, 'public, max-age=300');
}

export async function createProduct(db, req, ctx) {
  const user = requireRole(ctx, ['grossiste']);
  if (!user.seller_id) {
    throw new HttpError(403, 'Aucune boutique associée à ce compte.', 'NO_SHOP');
  }
  const body = await readJson(req);
  const name = String(body.name ?? '').trim();
  const category = CATEGORIES.has(body.category) ? body.category : null;
  const price = Number(body.price);
  const stock = Math.round(Number(body.stock));
  const unit = String(body.unit ?? '').trim();
  const description = String(body.description ?? '').trim();
  const image = IMAGES.has(body.image) ? body.image : 'rice';
  const photo = photoInput(body);

  if (name.length < 2) throw new HttpError(400, 'Nom du produit trop court.', 'INVALID_NAME');
  if (!category) throw new HttpError(400, 'Catégorie invalide.', 'INVALID_CATEGORY');
  if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'Prix invalide.', 'INVALID_PRICE');
  if (!Number.isFinite(stock) || stock < 0) throw new HttpError(400, 'Stock invalide.', 'INVALID_STOCK');
  if (unit.length < 1) throw new HttpError(400, 'Indiquez l’unité de vente.', 'INVALID_UNIT');
  if (description.length < 10) throw new HttpError(400, 'Description trop courte.', 'INVALID_DESCRIPTION');

  const id = `p_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const imagePath = photo ? writeImage(config.productsDir, id, photo) : null;

  try {
    db.prepare(
      `INSERT INTO products (id, seller_id, name, category, price, unit, stock, min_qty,
        image, image_path, tag, description, active, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, user.seller_id, name, category, price, unit, stock, 1,
      image, imagePath, null, description, 1, now,
    );
  } catch (error) {
    if (imagePath) deleteImage(config.productsDir, imagePath);
    throw error;
  }

  pushActivity(db, user, 'produit', `Produit publié : ${name}`);
  return {
    product: serializeProduct(
      db.prepare('SELECT * FROM products WHERE id = ?').get(id),
      ctx.baseUrl,
    ),
  };
}

export async function updateProduct(db, req, ctx) {
  const user = requireRole(ctx, ['grossiste', 'admin']);
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ctx.params.id);
  if (!product) throw new HttpError(404, 'Produit introuvable.', 'NOT_FOUND');
  if (user.role !== 'admin' && product.seller_id !== user.seller_id) {
    throw new HttpError(403, 'Ce produit appartient à une autre boutique.', 'FORBIDDEN');
  }

  const body = await readJson(req);
  const nextStock =
    body.stock === undefined ? product.stock : Math.max(0, Math.round(Number(body.stock)));
  const nextActive =
    body.active === undefined ? product.active : body.active ? 1 : 0;
  const nextImage =
    body.image === undefined || !IMAGES.has(body.image) ? product.image : body.image;

  if (!Number.isFinite(nextStock)) {
    throw new HttpError(400, 'Stock invalide.', 'INVALID_STOCK');
  }

  let nextImagePath = product.image_path ?? null;
  if (body.photo === null) {
    if (nextImagePath) deleteImage(config.productsDir, nextImagePath);
    nextImagePath = null;
  } else {
    const photo = photoInput(body);
    if (photo) {
      nextImagePath = writeImage(config.productsDir, product.id, photo, nextImagePath);
    }
  }

  db.prepare('UPDATE products SET stock = ?, active = ?, image = ?, image_path = ? WHERE id = ?').run(
    nextStock,
    nextActive,
    nextImage,
    nextImagePath,
    product.id,
  );

  if (body.stock !== undefined) {
    pushActivity(db, user, 'stock', `Stock mis à jour : ${product.name} (${nextStock})`);
  } else if (body.active !== undefined) {
    pushActivity(
      db,
      user,
      'produit',
      `${product.active ? 'Produit retiré' : 'Produit remis en ligne'} : ${product.name}`,
    );
  } else if (photoInput(body) || body.photo === null) {
    pushActivity(db, user, 'produit', `Photo mise à jour : ${product.name}`);
  }

  return {
    product: serializeProduct(
      db.prepare('SELECT * FROM products WHERE id = ?').get(product.id),
      ctx.baseUrl,
    ),
  };
}

export async function getMyProducts(db, req, ctx) {
  const user = requireUser(ctx);
  if (user.role === 'admin') {
    return {
      products: db
        .prepare('SELECT * FROM products ORDER BY created_at DESC')
        .all()
        .map((row) => serializeProduct(row, ctx.baseUrl)),
    };
  }
  if (!user.seller_id) return { products: [] };
  return {
    products: db
      .prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY created_at DESC')
      .all(user.seller_id)
      .map((row) => serializeProduct(row, ctx.baseUrl)),
  };
}
