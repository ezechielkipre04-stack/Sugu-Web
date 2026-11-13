/**
 * Test de bout en bout de l'API SUGU.
 *
 * Prérequis : le serveur doit tourner sur http://localhost:4000 avec OTP_DEBUG=true.
 * Lancement : node server/smoke-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './lib/db.mjs';
import { config } from './lib/config.mjs';

const BASE = process.env.SUGU_API_URL ?? `http://localhost:${config.port}`;
const TEST_PHONE = '0700000001';
const TEST_PASSWORD = 'Test1234';
const TEST_PASSWORD_2 = 'Test5678';
const ASSET = path.join(config.serverRoot, '..', 'assets', 'icon.png');

const db = openDatabase();

function assert(condition, message) {
  if (!condition) throw new Error(`ÉCHEC : ${message}`);
  console.log(`  ok  ${message}`);
}

async function api(pathname, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload, headers: response.headers };
}

async function expectError(pathname, options, status, label) {
  const result = await api(pathname, options);
  assert(result.status === status, `${label} (${result.status})`);
}

/** Termine une connexion : demande un code, le vérifie, puis ouvre la session. */
async function finishLogin(phone, loginToken) {
  const otpRequest = await api('/api/auth/code/request', {
    method: 'POST',
    body: { phone, channel: 'whatsapp', purpose: 'login' },
  });
  if (otpRequest.status !== 200) return otpRequest;
  const otpVerify = await api('/api/auth/code/verify', {
    method: 'POST',
    body: { phone, code: otpRequest.payload.debugCode, purpose: 'login' },
  });
  if (otpVerify.status !== 200) return otpVerify;
  return api('/api/auth/login/verify', {
    method: 'POST',
    body: {
      phone,
      loginToken,
      verificationToken: otpVerify.payload.verificationToken,
    },
  });
}

async function loginWithOtp(phone, password) {
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { phone, password },
  });
  if (login.status !== 200 || !login.payload.loginToken) return login;
  return finishLogin(phone, login.payload.loginToken);
}

function cleanup() {
  const user = db.prepare('SELECT id FROM users WHERE phone_key = ?').get(TEST_PHONE);
  if (!user) return;
  const orders = db.prepare('SELECT id FROM orders WHERE buyer_id = ?').all(user.id);
  for (const order of orders) {
    const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
    for (const item of items) {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(item.qty, item.product_id);
    }
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  }
  db.prepare('DELETE FROM messages WHERE client_id = ? OR sender_id = ?').run(user.id, user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM kyc WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM activity WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  try {
    fs.rmSync(path.join(config.kycDir, user.id), { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function run() {
  console.log(`\nSUGU API — ${BASE}\n`);
  const health = await api('/health');
  assert(health.status === 200 && health.payload.ok, 'le serveur répond');
  assert(health.payload.seeded === false || health.payload.seeded === true, 'base initialisée');

  cleanup();

  console.log('\nAuthentification');
  await expectError('/api/auth/login', { method: 'POST', body: { phone: TEST_PHONE, password: 'x' } }, 404, 'numéro inconnu rejeté');
  const admin = await loginWithOtp('0717027677', 'Admin2.0');
  assert(admin.status === 200 && admin.payload.user.role === 'admin', 'connexion admin');
  assert(!('password' in admin.payload.user), 'aucun mot de passe renvoyé');
  const adminToken = admin.payload.token;

  const bootstrap = await api('/api/bootstrap', { token: adminToken });
  assert(bootstrap.status === 200, 'bootstrap admin');
  assert(bootstrap.payload.users.length >= 10, 'comptes visibles par l’admin');
  assert(bootstrap.payload.orders.length >= 5, 'commandes visibles par l’admin');

  const demo = await api('/api/auth/demo', { method: 'POST', body: { role: 'client' } });
  assert(demo.status === 200 && demo.payload.user.role === 'client', 'connexion démo sans mot de passe embarqué');
  const demoAdmin = await api('/api/auth/demo', { method: 'POST', body: { role: 'admin' } });
  assert(demoAdmin.payload.user.role !== 'admin', 'démo limitée aux rôles publics');

  const register = await api('/api/auth/register', {
    method: 'POST',
    body: {
      name: 'Client Test',
      phone: TEST_PHONE,
      password: TEST_PASSWORD,
      role: 'client',
      city: 'Bouaflé',
    },
  });
  assert(register.status === 200 && register.payload.user.role === 'client', 'inscription client');
  const registered = await finishLogin(TEST_PHONE, register.payload.loginToken);
  assert(registered.status === 200 && Boolean(registered.payload.token), 'session ouverte après code');
  let clientToken = registered.payload.token;
  assert(register.payload.user.status === 'actif', 'compte actif');

  await expectError('/api/orders', {
    method: 'POST',
    token: clientToken,
    body: {
      city: 'Bouaflé', address: 'Quartier test', phone: TEST_PHONE, payment: 'mobile_money',
      items: [{ productId: 'p1', qty: 1 }],
    },
  }, 403, 'commande refusée sans identité vérifiée');

  console.log('\nKYC et documents');
  const otpRequest = await api('/api/auth/code/request', {
    method: 'POST',
    body: { phone: TEST_PHONE, channel: 'whatsapp', purpose: 'kyc' },
  });
  assert(otpRequest.status === 200 && otpRequest.payload.debugCode, 'code KYC demandé');
  const otpVerify = await api('/api/auth/code/verify', {
    method: 'POST',
    body: { phone: TEST_PHONE, code: otpRequest.payload.debugCode, purpose: 'kyc' },
  });
  assert(otpVerify.status === 200 && otpVerify.payload.verificationToken, 'code KYC vérifié');
  const kycToken = otpVerify.payload.verificationToken;

  await expectError('/api/kyc', {
    method: 'POST',
    token: clientToken,
    body: { verificationToken: 'faux', fullName: 'Test', documentType: 'cni', documentNumber: 'CI-12345' },
  }, 401, 'jeton KYC invalide refusé');

  const image = fs.readFileSync(ASSET).toString('base64');
  const dataUrl = `data:image/png;base64,${image}`;
  const kyc = await api('/api/kyc', {
    method: 'POST',
    token: clientToken,
    body: {
      verificationToken: kycToken,
      fullName: 'Client Test',
      documentType: 'cni',
      documentNumber: 'CI-2026-000001',
      front: dataUrl,
      back: dataUrl,
      selfie: dataUrl,
    },
  });
  assert(
    kyc.status === 200 && ['en_attente', 'verifie'].includes(kyc.payload.kyc.status),
    'dossier KYC transmis',
  );

  const adminWithKyc = await api('/api/bootstrap', { token: adminToken });
  const submitted = adminWithKyc.payload.users.find((user) => user.phone === TEST_PHONE);
  assert(['en_attente', 'verifie'].includes(submitted?.kyc.status), 'dossier visible par l’admin');
  assert(Boolean(submitted?.kyc.documentFrontUri), 'URL signée du recto générée');

  const fileResponse = await fetch(submitted.kyc.documentFrontUri);
  assert(fileResponse.status === 200, 'document KYC accessible via URL signée');
  assert(
    (fileResponse.headers.get('content-type') ?? '').startsWith('image/'),
    'document servi avec un type image',
  );

  if (submitted?.kyc.status === 'en_attente') {
    const reviewed = await api(`/api/admin/users/${submitted.id}/kyc`, {
      method: 'POST',
      token: adminToken,
      body: { decision: 'verifie' },
    });
    assert(reviewed.status === 200 && reviewed.payload.user.kyc.status === 'verifie', 'KYC validé par l’admin');
  }

  const clientAfterReview = await api('/api/bootstrap', { token: clientToken });
  assert(clientAfterReview.payload.user.kyc.status === 'verifie', 'statut KYC visible côté client');

  await expectError('/api/auth/register', {
    method: 'POST',
    body: { name: 'Doublon', phone: TEST_PHONE, password: TEST_PASSWORD, role: 'client' },
  }, 409, 'numéro déjà utilisé refusé');

  await expectError('/api/auth/login', {
    method: 'POST',
    body: { phone: TEST_PHONE, password: 'mauvais' },
  }, 401, 'mauvais mot de passe refusé');

  console.log('\nCatalogue et commandes');
  const catalog = await api('/api/catalog');
  const rice = catalog.payload.products.find((product) => product.id === 'p1');
  assert(Boolean(rice), 'catalogue public accessible');
  const initialStock = rice.stock;

  const order = await api('/api/orders', {
    method: 'POST',
    token: clientToken,
    body: {
      city: 'Bouaflé',
      address: 'Quartier test, rue 12',
      phone: TEST_PHONE,
      payment: 'mobile_money',
      items: [{ productId: 'p1', qty: 2 }],
    },
  });
  assert(order.status === 200, 'commande créée');
  assert(order.payload.order.total === 18500 * 2 + 1500, 'total calculé par le serveur');
  assert(order.payload.order.status === 'en_attente', 'statut initial correct');

  const afterOrder = await api('/api/catalog');
  const riceAfter = afterOrder.payload.products.find((product) => product.id === 'p1');
  assert(riceAfter.stock === initialStock - 2, 'stock décrémenté côté serveur');

  await expectError(`/api/orders/${order.payload.order.id}/status`, {
    method: 'PATCH',
    token: clientToken,
    body: { status: 'confirmee' },
  }, 403, 'client ne peut pas confirmer à la place du grossiste');

  await expectError('/api/orders', {
    method: 'POST',
    token: clientToken,
    body: {
      city: 'Bouaflé', address: 'Test', phone: TEST_PHONE, payment: 'livraison',
      items: [{ productId: 'p1', qty: 99999 }],
    },
  }, 409, 'stock insuffisant refusé');

  const sellerLogin = await loginWithOtp('0544210876', 'Seller2.0');
  assert(sellerLogin.status === 200, 'connexion grossiste');
  const sellerToken = sellerLogin.payload.token;
  const sellerOrders = await api('/api/orders', { token: sellerToken });
  assert(
    sellerOrders.payload.orders.some((candidate) => candidate.id === order.payload.order.id),
    'commande visible par le grossiste concerné',
  );

  const statusUpdate = await api(`/api/orders/${order.payload.order.id}/status`, {
    method: 'PATCH',
    token: sellerToken,
    body: { status: 'confirmee' },
  });
  assert(statusUpdate.status === 200 && statusUpdate.payload.order.status === 'confirmee', 'statut mis à jour par le grossiste');

  const otherSeller = await api('/api/auth/login', {
    method: 'POST',
    body: { phone: '0107335820', password: 'x' },
  });
  assert(otherSeller.status === 401, 'grossiste non propriétaire ne peut pas se connecter sans mot de passe');

  console.log('\nPhotos produits');
  const photo = `data:image/png;base64,${fs.readFileSync(ASSET).toString('base64')}`;
  const createdProduct = await api('/api/products', {
    method: 'POST',
    token: sellerToken,
    body: {
      name: 'Tomates photo test',
      category: 'alimentation',
      price: 1200,
      stock: 15,
      unit: 'panier de 5 kg',
      description: 'Tomates fraîches du marché pour le test de publication.',
      image: 'tomatoes',
      photo,
    },
  });
  assert(
    createdProduct.status === 200 && Boolean(createdProduct.payload.product.imageUrl),
    'produit publié avec une photo',
  );
  const productId = createdProduct.payload.product.id;

  const photoResponse = await fetch(createdProduct.payload.product.imageUrl);
  assert(photoResponse.status === 200, 'photo du produit servie');
  assert(
    (photoResponse.headers.get('content-type') ?? '').startsWith('image/'),
    'photo servie avec un type image',
  );

  const publicPhoto = await fetch(`${BASE}/api/products/${productId}/photo`);
  assert(publicPhoto.status === 200, 'photo accessible sans signature');

  const catalogWithPhoto = await api('/api/catalog');
  assert(
    catalogWithPhoto.payload.products.some(
      (product) => product.id === productId && Boolean(product.imageUrl),
    ),
    'photo visible dans le catalogue',
  );

  await expectError('/api/products', {
    method: 'POST',
    token: clientToken,
    body: {
      name: 'Produit interdit',
      category: 'alimentation',
      price: 1000,
      stock: 1,
      unit: 'sac',
      description: 'Un client ne doit pas pouvoir publier.',
      photo,
    },
  }, 403, 'client ne peut pas publier de produit');

  await expectError('/api/products', {
    method: 'POST',
    token: sellerToken,
    body: {
      name: 'Photo cassée',
      category: 'alimentation',
      price: 1000,
      stock: 1,
      unit: 'sac',
      description: 'Photo invalide pour vérifier le rejet.',
      photo: 'data:image/png;base64,AAAA',
    },
  }, 400, 'photo invalide refusée');

  const replacedPhoto = await api(`/api/products/${productId}`, {
    method: 'PATCH',
    token: sellerToken,
    body: { photo },
  });
  assert(
    replacedPhoto.status === 200 && Boolean(replacedPhoto.payload.product.imageUrl),
    'photo remplacée',
  );

  const removedPhoto = await api(`/api/products/${productId}`, {
    method: 'PATCH',
    token: sellerToken,
    body: { photo: null },
  });
  assert(
    removedPhoto.status === 200 && !removedPhoto.payload.product.imageUrl,
    'photo supprimée',
  );
  await expectError(`/api/products/${productId}/photo`, {}, 404, 'photo absente renvoie 404');

  db.prepare('DELETE FROM activity WHERE label LIKE ?').run('%Tomates photo test%');
  db.prepare('DELETE FROM products WHERE id = ?').run(productId);
  if (fs.existsSync(config.productsDir)) {
    for (const file of fs.readdirSync(config.productsDir)) {
      if (file.startsWith(productId)) {
        fs.rmSync(path.join(config.productsDir, file), { force: true });
      }
    }
  }

  console.log('\nMessagerie');
  const message = await api('/api/messages/w1', {
    method: 'POST',
    token: clientToken,
    body: { text: 'Bonjour, quel est le prix du riz ?' },
  });
  assert(message.status === 200 && message.payload.autoReply, 'message envoyé avec réponse automatique');
  const clientMessages = await api('/api/messages', { token: clientToken });
  assert(clientMessages.payload.messages.length >= 2, 'conversation récupérée côté client');

  console.log('\nRéinitialisation du mot de passe');
  const resetOtp = await api('/api/auth/code/request', {
    method: 'POST',
    body: { phone: TEST_PHONE, channel: 'whatsapp', purpose: 'password_reset' },
  });
  assert(resetOtp.status === 200 && resetOtp.payload.debugCode, 'code de réinitialisation demandé');
  const resetVerify = await api('/api/auth/code/verify', {
    method: 'POST',
    body: { phone: TEST_PHONE, code: resetOtp.payload.debugCode, purpose: 'password_reset' },
  });
  assert(resetVerify.status === 200, 'code de réinitialisation vérifié');

  await expectError('/api/auth/password/reset', {
    method: 'POST',
    body: { phone: TEST_PHONE, newPassword: TEST_PASSWORD_2, verificationToken: 'faux' },
  }, 401, 'réinitialisation sans jeton refusée');

  const reset = await api('/api/auth/password/reset', {
    method: 'POST',
    body: {
      phone: TEST_PHONE,
      newPassword: TEST_PASSWORD_2,
      verificationToken: resetVerify.payload.verificationToken,
    },
  });
  assert(reset.status === 200, 'mot de passe réinitialisé');

  await expectError('/api/auth/login', {
    method: 'POST',
    body: { phone: TEST_PHONE, password: TEST_PASSWORD },
  }, 401, 'ancien mot de passe refusé');

  const relogin = await loginWithOtp(TEST_PHONE, TEST_PASSWORD_2);
  assert(relogin.status === 200, 'connexion avec le nouveau mot de passe');
  clientToken = relogin.payload.token;

  console.log('\nCloisonnement des données');
  const otherClient = await api('/api/bootstrap', { token: 'invalide' });
  assert(otherClient.status === 401, 'jeton invalide refusé');

  const anonymousAdmin = await api('/api/admin/users');
  assert(anonymousAdmin.status === 401, 'admin inaccessible sans session');

  const clientAdminAttempt = await api('/api/admin/users', { token: clientToken });
  assert(clientAdminAttempt.status === 403, 'admin interdit à un client');

  const sellerAdminAttempt = await api('/api/admin/users', { token: sellerToken });
  assert(sellerAdminAttempt.status === 403, 'admin interdit à un grossiste');

  console.log('\nNettoyage');
  cleanup();
  console.log('  ok  données de test supprimées');

  console.log('\nTous les tests sont passés.\n');
}

run()
  .catch((error) => {
    console.error(`\n${error.message}\n`);
    try {
      cleanup();
    } catch {
      // ignore
    }
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
  });
