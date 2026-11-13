/* SUGU web — catalogue, panier, comptes, codes de vérification et KYC. */
'use strict';

const TOKEN_KEY = 'sugu:token';
const CART_KEY = 'sugu:cart';
const $ = (id) => document.getElementById(id);

const money = (value) =>
  new Intl.NumberFormat('fr-FR').format(Math.round(Number(value) || 0)) + ' FCFA';

const read = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};

const safe = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const statusLabels = {
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  preparation: 'En préparation',
  en_route: 'En route',
  livree: 'Livrée',
  annulee: 'Annulée',
};

const kycLabels = {
  non_verifie: 'Identité non vérifiée',
  en_attente: 'Dossier en cours d’examen',
  verifie: 'Identité vérifiée',
  rejete: 'Dossier rejeté',
};

const categories = [
  ['Tous', 'Tout voir', 'layout-grid'],
  ['Alimentation', 'Alimentation', 'wheat'],
  ['Vêtements', 'Vêtements', 'shirt'],
  ['Mode', 'Mode', 'shopping-bag'],
  ['Accessoires', 'Accessoires', 'watch'],
  ['Maison', 'Maison', 'house'],
  ['Beauté', 'Beauté', 'sparkles'],
];

const categoryValues = {
  Alimentation: 'alimentation',
  Vêtements: 'vetements',
  Mode: 'mode',
  Accessoires: 'accessoires',
  Maison: 'maison',
  Beauté: 'beaute',
};

const categoryImages = {
  alimentation: 'rice',
  vetements: 'fabric',
  mode: 'dress',
  accessoires: 'watches',
  maison: 'buckets',
  beaute: 'shea',
  electronique: 'headphones',
};

const imageUrls = {
  rice: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=700&q=80',
  tomatoes: 'https://images.unsplash.com/photo-1546094096-0df4bcaaa337?auto=format&fit=crop&w=700&q=80',
  oil: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=700&q=80',
  mangoes: 'https://images.unsplash.com/photo-1553279768-865429fa0078?auto=format&fit=crop&w=700&q=80',
  onions: 'https://images.unsplash.com/photo-1508747703725-719777637510?auto=format&fit=crop&w=700&q=80',
  maize: 'https://images.unsplash.com/photo-1601593768797-6d3b1e4e6b0a?auto=format&fit=crop&w=700&q=80',
  fabric: 'https://images.unsplash.com/photo-1528459105426-b9548367069b?auto=format&fit=crop&w=700&q=80',
  tshirts: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=700&q=80',
  wax: 'https://images.unsplash.com/photo-1590736969955-71cc94901144?auto=format&fit=crop&w=700&q=80',
  dress: 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=80',
  scarf: 'https://images.unsplash.com/photo-1601924994987-69e26d50dc26?auto=format&fit=crop&w=700&q=80',
  shoes: 'https://images.unsplash.com/photo-1543163521-1bf539c55dd2?auto=format&fit=crop&w=700&q=80',
  watches: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?auto=format&fit=crop&w=700&q=80',
  soap: 'https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=700&q=80',
  buckets: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?auto=format&fit=crop&w=700&q=80',
  utensils: 'https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=700&q=80',
  shea: 'https://images.unsplash.com/photo-1608248543803-ba4f8c70ae0b?auto=format&fit=crop&w=700&q=80',
  perfume: 'https://images.unsplash.com/photo-1541643600914-78b084683601?auto=format&fit=crop&w=700&q=80',
  coconut: 'https://images.unsplash.com/photo-1580984969071-a8da5656c2fb?auto=format&fit=crop&w=700&q=80',
  headphones: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=700&q=80',
};

const fallbackImage =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="500"><rect width="700" height="500" fill="#fff0df"/><circle cx="350" cy="250" r="120" fill="#FFC21A" opacity=".55"/><text x="350" y="270" font-family="Arial" font-size="58" font-weight="700" fill="#2A1A12" text-anchor="middle">Sugu</text></svg>`,
  );

let token = localStorage.getItem(TOKEN_KEY);
let currentUser = null;
let products = [];
let wholesalers = [];
let myProducts = [];
let orders = [];
let cart = read(CART_KEY, []).filter((item) => item && typeof item.id === 'string' && item.qty > 0);
let selectedCategory = 'Tous';
let searchTerm = '';
let selectedCity = 'all';
let ascending = true;
let authMode = 'login';
let authRole = 'client';
let authMessage = '';
let authPhonePrefill = '';
let pendingOtp = null;
let pendingLoginToken = null;
let modalOnClose = null;
let cameraStream = null;
let kycDraft = null;
let productDraft = null;

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && token) headers.authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Serveur injoignable. Lancez « npm start » puis rechargez la page.', 'NETWORK');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && auth) clearSession();
    throw new ApiError(data.error || 'Une erreur est survenue.', data.code);
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Session et données                                                  */
/* ------------------------------------------------------------------ */

function setSession(newToken, user) {
  token = newToken;
  localStorage.setItem(TOKEN_KEY, newToken);
  currentUser = user;
}

function clearSession() {
  token = null;
  currentUser = null;
  orders = [];
  myProducts = [];
  localStorage.removeItem(TOKEN_KEY);
}

function wholesalerMap() {
  return new Map(wholesalers.map((wholesaler) => [wholesaler.id, wholesaler]));
}

function decorateProduct(product) {
  const seller = wholesalerMap().get(product.sellerId);
  const publishedByWholesaler = Boolean(seller?.ownerId);
  const available = Boolean(product.active !== false && product.stock > 0 && publishedByWholesaler);
  return {
    ...product,
    sellerName: seller?.name ?? 'Grossiste SUGU',
    city: seller?.city ?? '—',
    imageSrc: product.imageUrl || imageUrls[product.image] || fallbackImage,
    publishedByWholesaler,
    available,
  };
}

function stockMessage(product) {
  if (!product.publishedByWholesaler) return 'Stock épuisé — offre non publiée par un grossiste';
  if (product.stock <= 0) return 'Stock épuisé';
  return `Disponible chez le grossiste · ${product.stock} unités`;
}

function cartLines() {
  return cart
    .map((item) => {
      const product = products.find((entry) => entry.id === item.id);
      if (!product) return null;
      const qty = Math.min(item.qty, Math.max(product.stock, 0));
      return { product, qty: qty || item.qty, lineTotal: product.price * (qty || 0) };
    })
    .filter(Boolean);
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartCount();
}

function pruneCart() {
  const before = cart.length;
  cart = cart.filter((item) => products.some((product) => product.id === item.id));
  if (cart.length !== before) saveCart();
}

async function refreshAll() {
  const catalog = await api('/api/catalog');
  wholesalers = catalog.wholesalers;
  products = catalog.products.map(decorateProduct);

  if (token) {
    try {
      const data = await api('/api/bootstrap');
      currentUser = data.user;
      orders = data.orders;
      if (currentUser.role === 'grossiste') {
        myProducts = (await api('/api/products')).products;
      } else {
        myProducts = [];
      }
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') {
        clearSession();
      } else {
        throw error;
      }
    }
  } else {
    currentUser = null;
    orders = [];
    myProducts = [];
  }

  pruneCart();
  renderProducts();
  refreshHeader();
  updateCartCount();
}

/* ------------------------------------------------------------------ */
/* Rendu du catalogue                                                  */
/* ------------------------------------------------------------------ */

function refreshHeader() {
  $('profileBtn').innerHTML = currentUser
    ? `<span>${safe(
        currentUser.name
          .split(/\s+/)
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase(),
      )}</span>`
    : '<i data-lucide="user-round"></i>';
  $('profileBtn').title = currentUser ? currentUser.name : 'Se connecter';
  $('sellerBtn').textContent =
    currentUser?.role === 'grossiste' ? 'Mon espace grossiste' : 'Devenir grossiste';
  if (window.lucide) lucide.createIcons();
}

function renderCategories() {
  $('categories').innerHTML = categories
    .map(
      ([value, label, icon]) =>
        `<button class="category ${selectedCategory === value ? 'active' : ''}" data-category="${value}"><i data-lucide="${icon}"></i> ${label}</button>`,
    )
    .join('');
  if (window.lucide) lucide.createIcons();
}

function renderProducts() {
  const term = searchTerm.trim().toLowerCase();
  let list = products.filter(
    (product) =>
      (selectedCategory === 'Tous' || product.category === categoryValues[selectedCategory]) &&
      `${product.name} ${product.sellerName} ${product.category}`.toLowerCase().includes(term) &&
      (selectedCity === 'all' || product.city === selectedCity),
  );
  list.sort((a, b) => (ascending ? a.price - b.price : b.price - a.price));

  $('productGrid').innerHTML = list
    .map(
      (product) => `<article class="product-card ${product.available ? '' : 'is-out'}">
      <div class="product-visual">
        <img class="product-photo" src="${safe(product.imageSrc)}" alt="${safe(product.name)}" loading="lazy" onerror="this.onerror=null;this.src='${fallbackImage}'"/>
        <span class="product-tag">${safe(product.tag || (product.available ? 'Disponible' : 'Stock épuisé'))}</span>
        <span class="verified ${product.available ? '' : 'out'}"><i data-lucide="${product.available ? 'badge-check' : 'alert-circle'}"></i> ${product.available ? 'Sugu' : 'Épuisé'}</span>
      </div>
      <div class="product-info">
        <div class="product-meta"><span class="location"><i data-lucide="map-pin"></i> ${safe(product.city)}</span><span>${Number(product.stock)} unités</span></div>
        <h3>${safe(product.name)}</h3>
        <p class="seller-name">${safe(product.sellerName)}</p>
        <div class="product-bottom">
          <div class="price">${money(product.price)}<small> / ${safe(product.unit)}</small></div>
          <button class="add-btn" data-add="${safe(product.id)}" aria-label="Ajouter ${safe(product.name)} au panier" ${product.available ? '' : 'disabled'}><i data-lucide="plus"></i></button>
        </div>
        <div class="stock-note ${product.available ? '' : 'out'}">${safe(stockMessage(product))}</div>
      </div>
    </article>`,
    )
    .join('');

  $('resultCount').textContent = `${list.length} produit${list.length > 1 ? 's' : ''} disponible${list.length > 1 ? 's' : ''}`;
  $('productGrid').classList.toggle('hidden', list.length === 0);
  $('emptyState').classList.toggle('hidden', list.length > 0);
  if (window.lucide) lucide.createIcons();
}

function updateCartCount() {
  $('cartCount').textContent = cart.reduce((sum, item) => sum + item.qty, 0);
}

function addToCart(id) {
  if (!currentUser) {
    openAuth('login', 'client', 'Connectez-vous pour ajouter des produits au panier.');
    return;
  }
  if (currentUser.role !== 'client') {
    toast('Seuls les comptes clients peuvent commander.', 'error');
    return;
  }
  const product = products.find((entry) => entry.id === id);
  if (!product) return;
  if (!product.available) {
    toast(stockMessage(product), 'error');
    return;
  }
  const existing = cart.find((item) => item.id === id);
  if (existing && existing.qty >= product.stock) {
    toast(`Stock maximum atteint pour « ${product.name} ».`, 'error');
    return;
  }
  if (existing) existing.qty += 1;
  else cart.push({ id, qty: 1 });
  saveCart();
  toast(`${product.name} ajouté au panier`);
}

/* ------------------------------------------------------------------ */
/* Modale générique                                                    */
/* ------------------------------------------------------------------ */

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
}

function openModal(html, { wide = false, onClose = null } = {}) {
  const modal = document.querySelector('.modal');
  if (modalOnClose && modalOnClose !== onClose) {
    try {
      modalOnClose();
    } catch {
      /* ignore */
    }
  }
  modalOnClose = onClose;
  modal.classList.toggle('wide', wide);
  $('modalContent').innerHTML = html;
  $('modalBackdrop').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal() {
  stopCamera();
  $('modalBackdrop').classList.add('hidden');
  $('modalContent').innerHTML = '';
  const callback = modalOnClose;
  modalOnClose = null;
  if (callback) {
    try {
      callback();
    } catch {
      /* ignore */
    }
  }
}

function toast(message, type = '') {
  const element = $('toast');
  element.textContent = message;
  element.className = `toast show ${type}`.trim();
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
}

/* ------------------------------------------------------------------ */
/* Authentification                                                    */
/* ------------------------------------------------------------------ */

function openAuth(mode = 'login', role = 'client', message = '', phone = '') {
  authMode = mode;
  authRole = role;
  authMessage = message;
  authPhonePrefill = phone;
  renderAuth();
}

function renderAuth() {
  openModal(
    `<h2 id="modalTitle">${authMode === 'signup' ? 'Créer votre compte' : 'Connexion à Sugu'}</h2>
     <p class="modal-subtitle">${safe(
       authMessage ||
         (authMode === 'signup'
           ? 'Un seul compte pour acheter en gros ou vendre vos produits.'
           : 'Retrouvez votre catalogue, votre panier et vos commandes.'),
     )}</p>
     <form data-form="auth">
       <div class="form-field">
         <label for="authRole">Type de compte</label>
         <select id="authRole">
           <option value="client" ${authRole === 'client' ? 'selected' : ''}>Client / commerçant</option>
           <option value="grossiste" ${authRole === 'grossiste' ? 'selected' : ''}>Grossiste</option>
         </select>
       </div>
       ${
         authMode === 'signup'
           ? `<div class="form-field"><label for="authName">Nom complet ou entreprise</label><input id="authName" required placeholder="Ex. Awa Koné"/></div>`
           : `<div class="form-field"><label for="authName">Nom complet ou entreprise <span class="label-hint">facultatif</span></label><input id="authName" placeholder="Votre nom" autocomplete="name"/></div>`
       }
       <div class="form-field">
         <label for="authPhone">Numéro de téléphone</label>
         <input id="authPhone" type="tel" inputmode="tel" required placeholder="07 00 00 00 00" value="${safe(authPhonePrefill)}"/>
       </div>
       <div class="form-field">
         <label for="authPassword">Mot de passe</label>
         <input id="authPassword" type="password" required minlength="6" placeholder="6 caractères minimum" autocomplete="${authMode === 'signup' ? 'new-password' : 'current-password'}"/>
         <button type="button" class="inline-link" data-action="forgot">Mot de passe oublié ?</button>
       </div>
       <p class="form-error hidden" id="authError"></p>
       <button class="btn btn-orange full" type="submit" id="authSubmit">${authMode === 'signup' ? 'Créer mon compte' : 'Me connecter'}</button>
     </form>
     <button class="btn btn-dark full" data-action="auth-switch">${authMode === 'signup' ? 'J’ai déjà un compte — Connexion' : 'Créer un nouveau compte'}</button>`,
  );
  setTimeout(() => $('authPhone')?.focus(), 50);
}

async function submitAuth() {
  const mode = authMode;
  const role = $('authRole').value;
  const name = ($('authName')?.value ?? '').trim();
  const phone = $('authPhone').value.trim();
  const password = $('authPassword').value;
  const error = $('authError');
  error.classList.add('hidden');

  if (mode === 'signup' && name.length < 2) {
    error.textContent = 'Indiquez votre nom complet.';
    error.classList.remove('hidden');
    return;
  }
  if (phone.replace(/\D/g, '').length < 8) {
    error.textContent = 'Entrez un numéro de téléphone valide.';
    error.classList.remove('hidden');
    return;
  }
  if (password.length < 6) {
    error.textContent = 'Le mot de passe doit contenir au moins 6 caractères.';
    error.classList.remove('hidden');
    return;
  }

  const button = $('authSubmit');
  button.disabled = true;
  button.textContent = 'Vérification…';

  try {
    const data = await api(mode === 'signup' ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      auth: false,
      body:
        mode === 'signup'
          ? { name, phone, password, role, city: 'Bouaflé' }
          : { phone, password },
    });
    pendingLoginToken = data.loginToken || null;
    if (!pendingLoginToken) {
      throw new ApiError('Connexion momentanément indisponible. Réessayez.', 'NO_LOGIN_TOKEN');
    }
    await startLoginOtp(phone, pendingLoginToken);
    if (!currentUser) {
      const authButton = $('authSubmit');
      if (authButton) {
        authButton.disabled = false;
        authButton.textContent = mode === 'signup' ? 'Créer mon compte' : 'Me connecter';
      }
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = mode === 'signup' ? 'Créer mon compte' : 'Me connecter';
    $('authError').textContent = error.message;
    $('authError').classList.remove('hidden');
  }
}

async function startLoginOtp(phone, loginToken) {
  try {
    await requestOtp(phone, 'login', {
      title: 'Vérifiez votre connexion',
      description: 'Saisissez le code reçu pour ouvrir votre session SUGU.',
      onSuccess: async (verificationToken) => {
        const data = await api('/api/auth/login/verify', {
          method: 'POST',
          auth: false,
          body: { phone, loginToken, verificationToken },
        });
        pendingLoginToken = null;
        setSession(data.token, data.user);
        await refreshAll();
        closeModal();
        toast(`Bienvenue ${currentUser?.name ?? ''} !`.trim(), 'success');
      },
      onCancel: () => {
        pendingLoginToken = null;
        clearSession();
        refreshHeader();
      },
    });
  } catch (error) {
    pendingLoginToken = null;
    clearSession();
    refreshHeader();
    toast(error.message, 'error');
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch {
    /* ignore */
  }
  clearSession();
  closeModal();
  await refreshAll();
  toast('Vous êtes déconnecté.');
}

/* ------------------------------------------------------------------ */
/* Codes de vérification                                               */
/* ------------------------------------------------------------------ */

async function requestOtp(phone, purpose, options = {}) {
  const channel = options.channel || 'whatsapp';
  const result = await api('/api/auth/code/request', {
    method: 'POST',
    auth: false,
    body: { phone, channel, purpose },
  });
  pendingOtp = {
    phone,
    purpose,
    channel: result.channel || channel,
    debugCode: result.debugCode,
    mock: result.mock,
    title: options.title || 'Code de vérification',
    description: options.description || '',
    onSuccess: options.onSuccess,
    onCancel: options.onCancel,
  };
  renderOtp();
}

function renderOtp() {
  if (!pendingOtp) return;
  const { phone, channel, debugCode, title, description, purpose } = pendingOtp;
  openModal(
    `<h2 id="modalTitle">${safe(title)}</h2>
     <p class="modal-subtitle">${safe(description || 'Entrez le code à 6 chiffres reçu par WhatsApp ou SMS.')}</p>
     <div class="otp-phone"><i data-lucide="message-circle"></i> ${safe(phone)}</div>
     <div class="otp-channels">
       <button type="button" class="otp-channel ${channel === 'whatsapp' ? 'active' : ''}" data-action="otp-resend" data-channel="whatsapp"><i data-lucide="message-circle"></i> WhatsApp</button>
       <button type="button" class="otp-channel ${channel === 'sms' ? 'active' : ''}" data-action="otp-resend" data-channel="sms"><i data-lucide="smartphone"></i> SMS</button>
     </div>
     ${debugCode ? `<div class="otp-hint">Code de test : <strong>${safe(debugCode)}</strong></div>` : ''}
     <form data-form="otp">
       <div class="form-field">
         <label for="otpCode">Code à 6 chiffres</label>
         <input id="otpCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" required/>
       </div>
       <p class="form-error hidden" id="otpError"></p>
       <button class="btn btn-orange full" type="submit" id="otpSubmit">Valider le code</button>
     </form>
     <button type="button" class="inline-link" data-action="otp-resend" data-channel="${channel}">Renvoyer le code</button>
     <p class="modal-note">${
       purpose === 'login'
         ? 'Votre session ne s’ouvre qu’après validation du code.'
         : purpose === 'password_reset'
           ? 'Le code confirme que ce numéro vous appartient.'
           : 'Le code protège l’envoi de vos documents.'
     }</p>`,
  );
  setTimeout(() => $('otpCode')?.focus(), 80);
}

async function resendOtp(channel) {
  if (!pendingOtp) return;
  try {
    const result = await api('/api/auth/code/request', {
      method: 'POST',
      auth: false,
      body: { phone: pendingOtp.phone, channel, purpose: pendingOtp.purpose },
    });
    pendingOtp.channel = result.channel || channel;
    pendingOtp.debugCode = result.debugCode;
    pendingOtp.mock = result.mock;
    renderOtp();
    toast('Nouveau code envoyé.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function verifyOtp() {
  if (!pendingOtp) return;
  const code = ($('otpCode')?.value ?? '').replace(/\D/g, '');
  const error = $('otpError');
  if (code.length !== 6) {
    error.textContent = 'Entrez les 6 chiffres du code.';
    error.classList.remove('hidden');
    return;
  }
  const button = $('otpSubmit');
  button.disabled = true;
  button.textContent = 'Validation…';
  try {
    const result = await api('/api/auth/code/verify', {
      method: 'POST',
      auth: false,
      body: { phone: pendingOtp.phone, code, purpose: pendingOtp.purpose },
    });
    const success = pendingOtp.onSuccess;
    if (success) await success(result.verificationToken);
    pendingOtp = null;
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Valider le code';
    const errorBox = $('otpError');
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } else {
      toast(error.message, 'error');
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mot de passe oublié                                                 */
/* ------------------------------------------------------------------ */

function openForgot(phone = '') {
  openModal(
    `<h2 id="modalTitle">Mot de passe oublié</h2>
     <p class="modal-subtitle">Recevez un code de vérification, puis choisissez un nouveau mot de passe.</p>
     <form data-form="forgot">
       <div class="form-field">
         <label for="forgotPhone">Numéro de téléphone</label>
         <input id="forgotPhone" type="tel" inputmode="tel" required placeholder="07 00 00 00 00" value="${safe(phone)}"/>
       </div>
       <p class="form-error hidden" id="forgotError"></p>
       <button class="btn btn-orange full" type="submit">Recevoir le code</button>
     </form>
     <button type="button" class="inline-link" data-action="auth-back">Revenir à la connexion</button>`,
  );
}

async function submitForgot() {
  const phone = $('forgotPhone').value.trim();
  const error = $('forgotError');
  if (phone.replace(/\D/g, '').length < 8) {
    error.textContent = 'Entrez un numéro de téléphone valide.';
    error.classList.remove('hidden');
    return;
  }
  try {
    await requestOtp(phone, 'password_reset', {
      title: 'Réinitialiser le mot de passe',
      description: 'Saisissez le code reçu pour choisir un nouveau mot de passe.',
      onSuccess: (verificationToken) => openResetPassword(phone, verificationToken),
    });
  } catch (error) {
    $('forgotError').textContent = error.message;
    $('forgotError').classList.remove('hidden');
  }
}

function openResetPassword(phone, verificationToken) {
  openModal(
    `<h2 id="modalTitle">Nouveau mot de passe</h2>
     <p class="modal-subtitle">Choisissez un mot de passe d’au moins 6 caractères pour ${safe(phone)}.</p>
     <form data-form="reset">
       <input type="hidden" id="resetToken" value="${safe(verificationToken)}"/>
       <input type="hidden" id="resetPhone" value="${safe(phone)}"/>
       <div class="form-field"><label for="resetPassword">Nouveau mot de passe</label><input id="resetPassword" type="password" required minlength="6" autocomplete="new-password"/></div>
       <div class="form-field"><label for="resetConfirm">Confirmer le mot de passe</label><input id="resetConfirm" type="password" required minlength="6" autocomplete="new-password"/></div>
       <p class="form-error hidden" id="resetError"></p>
       <button class="btn btn-orange full" type="submit">Enregistrer le mot de passe</button>
     </form>`,
  );
}

async function submitReset() {
  const password = $('resetPassword').value;
  const confirm = $('resetConfirm').value;
  const error = $('resetError');
  if (password.length < 6) {
    error.textContent = 'Choisissez au moins 6 caractères.';
    error.classList.remove('hidden');
    return;
  }
  if (password !== confirm) {
    error.textContent = 'Les deux mots de passe ne correspondent pas.';
    error.classList.remove('hidden');
    return;
  }
  try {
    const phone = $('resetPhone').value;
    await api('/api/auth/password/reset', {
      method: 'POST',
      auth: false,
      body: {
        phone,
        newPassword: password,
        verificationToken: $('resetToken').value,
      },
    });
    openAuth('login', 'client', 'Mot de passe mis à jour. Connectez-vous.', phone);
    toast('Mot de passe mis à jour.', 'success');
  } catch (error) {
    $('resetError').textContent = error.message;
    $('resetError').classList.remove('hidden');
  }
}

/* ------------------------------------------------------------------ */
/* Photos : import et caméra                                           */
/* ------------------------------------------------------------------ */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image illisible.'));
    };
    image.src = url;
  });
}

async function fileToDataUrl(file, maxSize = 1500) {
  const image = await loadImage(file);
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

function syncKycDraft() {
  if (!kycDraft || !$('kycName')) return;
  kycDraft.fullName = $('kycName').value;
  kycDraft.documentType = $('kycType').value;
  kycDraft.documentNumber = $('kycNumber').value;
}

function syncProductDraft() {
  if (!productDraft || !$('pName')) return;
  productDraft.name = $('pName').value;
  productDraft.category = $('pCategory').value;
  productDraft.city = $('pCity').value;
  productDraft.price = $('pPrice').value;
  productDraft.stock = $('pStock').value;
  productDraft.unit = $('pUnit').value;
  productDraft.description = $('pDescription').value;
}

function pickImage(target) {
  if (target === 'product') syncProductDraft();
  else syncKycDraft();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setPhoto(target, dataUrl);
    } catch (error) {
      toast(error.message || 'Impossible de lire cette image.', 'error');
    }
  };
  document.body.appendChild(input);
  input.click();
}

function setPhoto(target, dataUrl) {
  if (target === 'product') {
    productDraft = productDraft || {};
    productDraft.photo = dataUrl;
    renderPublishForm();
    return;
  }
  kycDraft = kycDraft || {};
  kycDraft[target] = dataUrl;
  renderKycForm();
}

async function openCamera(target) {
  if (target === 'product') syncProductDraft();
  else syncKycDraft();
  const selfie = target === 'selfie';
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('La caméra n’est pas disponible. Utilisez l’import pour les pièces.', 'error');
    return;
  }
  stopCamera();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: selfie ? 'user' : 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    });
  } catch {
    toast(
      selfie
        ? 'Autorisez la caméra pour prendre le selfie.'
        : 'Autorisez la caméra, ou importez la photo depuis la galerie.',
      'error',
    );
    return;
  }

  openModal(
    `<h2 id="modalTitle">${selfie ? 'Selfie de contrôle' : 'Prendre une photo'}</h2>
     <p class="modal-subtitle">${selfie ? 'Placez votre visage au centre du cadre, de face.' : 'Cadrez le document bien à plat, sans reflet.'}</p>
     <div class="camera-wrap ${selfie ? 'camera-selfie' : ''}">
       <video id="cameraVideo" autoplay playsinline muted></video>
       <div class="camera-guide ${selfie ? 'camera-oval' : ''}"></div>
     </div>
     <button class="btn btn-orange full" data-action="camera-capture" data-target="${target}" id="cameraCapture"><i data-lucide="camera"></i> Capturer</button>
     <button class="btn btn-dark full" data-action="camera-cancel" data-target="${target}">Annuler</button>`,
    { onClose: stopCamera },
  );

  const video = $('cameraVideo');
  video.srcObject = cameraStream;
  try {
    await video.play();
  } catch {
    /* le navigateur déclenchera la lecture au premier rendu */
  }
}

function captureCamera(target) {
  const video = $('cameraVideo');
  if (!video || !video.videoWidth) {
    toast('La caméra n’est pas encore prête. Réessayez.', 'error');
    return;
  }
  const maxSize = 1500;
  const scale = Math.min(1, maxSize / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  stopCamera();
  closeModal();
  setPhoto(target, dataUrl);
}

/* ------------------------------------------------------------------ */
/* KYC                                                                 */
/* ------------------------------------------------------------------ */

function openKyc() {
  if (!currentUser) {
    openAuth('login', 'client', 'Connectez-vous pour vérifier votre identité.');
    return;
  }
  kycDraft = {
    fullName: currentUser.kyc?.fullName || currentUser.name,
    documentType: currentUser.kyc?.documentType || 'cni',
    documentNumber: currentUser.kyc?.documentNumber || '',
    front: null,
    back: null,
    selfie: null,
    otpSent: false,
    debugCode: null,
    verificationToken: null,
    busy: false,
  };
  renderKycForm();
}

function photoBox(target, label, hint, { cameraOnly = false, facing = 'environment' } = {}) {
  const data = kycDraft?.[target];
  return `<div class="photo-field">
    <div class="photo-label"><strong>${label}</strong><span>${hint}</span></div>
    <div class="photo-preview ${data ? 'has-photo' : ''}">
      ${
        data
          ? `<img src="${data}" alt="${safe(label)}"/>`
          : `<span class="photo-empty"><i data-lucide="${cameraOnly ? 'user-round' : 'id-card'}"></i>${cameraOnly ? 'Prenez votre selfie maintenant' : 'Ajoutez la photo'}</span>`
      }
    </div>
    <div class="photo-actions">
      ${
        cameraOnly
          ? ''
          : `<button type="button" class="photo-btn" data-action="import" data-target="${target}"><i data-lucide="image"></i> ${data ? 'Remplacer' : 'Importer'}</button>`
      }
      <button type="button" class="photo-btn" data-action="camera" data-target="${target}"><i data-lucide="camera"></i> ${data ? 'Reprendre' : cameraOnly ? 'Prendre le selfie' : 'Prendre une photo'}</button>
    </div>
    ${cameraOnly ? '<small class="photo-note">Le selfie se prend obligatoirement à l’instant, sans import.</small>' : ''}
  </div>`;
}

function renderKycForm() {
  if (!kycDraft || !currentUser) return;
  const verified = currentUser.kyc?.status === 'verifie';
  const pending = currentUser.kyc?.status === 'en_attente';
  const rejected = currentUser.kyc?.status === 'rejete';

  openModal(
    `<h2 id="modalTitle">Vérification d’identité</h2>
     <p class="modal-subtitle">Renseignez votre pièce, ajoutez le recto, le verso et un selfie instantané, puis confirmez avec un code.</p>
     ${
       verified
         ? `<div class="kyc-banner ok"><i data-lucide="shield-check"></i><div><strong>Identité vérifiée</strong><span>Vous pouvez passer vos précommandes.</span></div></div>`
         : pending
           ? `<div class="kyc-banner wait"><i data-lucide="clock"></i><div><strong>Dossier en cours d’examen</strong><span>Vous pouvez renvoyer un dossier si nécessaire.</span></div></div>`
           : rejected
             ? `<div class="kyc-banner bad"><i data-lucide="alert-circle"></i><div><strong>Dossier précédent rejeté</strong><span>${safe(currentUser.kyc?.rejectionReason || 'Vérifiez la lisibilité de vos documents.')}</span></div></div>`
             : ''
     }
     <form data-form="kyc">
       <div class="form-field"><label for="kycName">Nom complet</label><input id="kycName" required value="${safe(kycDraft.fullName)}" placeholder="Tel qu’il apparaît sur la pièce"/></div>
       <div class="form-grid">
         <div class="form-field"><label for="kycType">Type de document</label>
           <select id="kycType">
             <option value="cni" ${kycDraft.documentType === 'cni' ? 'selected' : ''}>CNI</option>
             <option value="passeport" ${kycDraft.documentType === 'passeport' ? 'selected' : ''}>Passeport</option>
             <option value="permis" ${kycDraft.documentType === 'permis' ? 'selected' : ''}>Permis</option>
           </select>
         </div>
         <div class="form-field"><label for="kycNumber">Numéro du document</label><input id="kycNumber" required value="${safe(kycDraft.documentNumber)}" placeholder="Ex. CI-2025-118420"/></div>
       </div>
       ${photoBox('front', 'Pièce d’identité · Recto', 'Informations et photo lisibles')}
       ${photoBox('back', 'Pièce d’identité · Verso', 'Verso complet, sans reflet')}
       ${photoBox('selfie', 'Selfie instantané', 'Visage dégagé, de face', { cameraOnly: true })}
       <div class="kyc-otp">
         <div class="kyc-otp-head"><i data-lucide="message-circle"></i><strong>Confirmation du numéro</strong></div>
         ${
           kycDraft.verificationToken
             ? `<div class="kyc-verified"><i data-lucide="check-circle"></i> Numéro ${safe(currentUser.phone)} vérifié</div>`
             : kycDraft.otpSent
               ? `<p>Un code a été envoyé au ${safe(currentUser.phone)}.</p>
                  ${kycDraft.debugCode ? `<div class="otp-hint">Code de test : <strong>${safe(kycDraft.debugCode)}</strong></div>` : ''}
                  <div class="otp-inline">
                    <input id="kycOtp" inputmode="numeric" maxlength="6" placeholder="000000" aria-label="Code de vérification"/>
                    <button type="button" class="btn btn-dark" data-action="kyc-otp-verify">Valider</button>
                  </div>
                  <button type="button" class="inline-link" data-action="kyc-otp-send">Renvoyer le code</button>`
               : `<p>Un code à 6 chiffres protège l’envoi de vos documents.</p>
                  <button type="button" class="btn btn-dark full" data-action="kyc-otp-send"><i data-lucide="message-circle"></i> Recevoir le code par WhatsApp</button>`
         }
       </div>
       <p class="form-error hidden" id="kycError"></p>
       <button class="btn btn-orange full" type="submit" id="kycSubmit" ${kycDraft.verificationToken ? '' : 'disabled'}>Envoyer pour vérification</button>
     </form>`,
    { wide: true },
  );
}

async function sendKycCode() {
  if (!currentUser) return;
  syncKycDraft();
  try {
    const result = await api('/api/auth/code/request', {
      method: 'POST',
      auth: false,
      body: { phone: currentUser.phone, channel: 'whatsapp', purpose: 'kyc' },
    });
    kycDraft.otpSent = true;
    kycDraft.debugCode = result.debugCode;
    renderKycForm();
    toast('Code envoyé par WhatsApp.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function verifyKycCode() {
  syncKycDraft();
  const code = ($('kycOtp')?.value ?? '').replace(/\D/g, '');
  if (code.length !== 6) {
    toast('Entrez les 6 chiffres du code.', 'error');
    return;
  }
  try {
    const result = await api('/api/auth/code/verify', {
      method: 'POST',
      auth: false,
      body: { phone: currentUser.phone, code, purpose: 'kyc' },
    });
    kycDraft.verificationToken = result.verificationToken;
    renderKycForm();
    toast('Numéro vérifié.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function submitKyc() {
  if (!kycDraft) return;
  syncKycDraft();
  const error = $('kycError');
  const fullName = $('kycName').value.trim();
  const documentType = $('kycType').value;
  const documentNumber = $('kycNumber').value.trim();

  const problems = [];
  if (fullName.length < 2) problems.push('Indiquez votre nom complet.');
  if (documentNumber.length < 5) problems.push('Entrez le numéro du document.');
  if (!kycDraft.front) problems.push('Ajoutez le recto de la pièce.');
  if (!kycDraft.back) problems.push('Ajoutez le verso de la pièce.');
  if (!kycDraft.selfie) problems.push('Prenez un selfie instantané.');
  if (!kycDraft.verificationToken) problems.push('Validez le code reçu par WhatsApp.');

  if (problems.length > 0) {
    error.textContent = problems[0];
    error.classList.remove('hidden');
    return;
  }

  const button = $('kycSubmit');
  button.disabled = true;
  button.textContent = 'Envoi en cours…';

  try {
    const result = await api('/api/kyc', {
      method: 'POST',
      body: {
        verificationToken: kycDraft.verificationToken,
        fullName,
        documentType,
        documentNumber,
        front: kycDraft.front,
        back: kycDraft.back,
        selfie: kycDraft.selfie,
      },
    });
    await refreshAll();
    closeModal();
    toast(
      result.kyc?.status === 'verifie'
        ? 'Identité vérifiée. Vous pouvez commander.'
        : 'Dossier envoyé. Il sera examiné rapidement.',
      'success',
    );
    profileModal();
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Envoyer pour vérification';
    $('kycError').textContent = error.message;
    $('kycError').classList.remove('hidden');
  }
}

/* ------------------------------------------------------------------ */
/* Profil                                                              */
/* ------------------------------------------------------------------ */

function profileModal() {
  if (!currentUser) {
    openAuth('login');
    return;
  }
  const kyc = currentUser.kyc?.status ?? 'non_verifie';
  const kycClass = kyc === 'verifie' ? 'ok' : kyc === 'rejete' ? 'bad' : kyc === 'en_attente' ? 'wait' : 'idle';
  openModal(
    `<h2 id="modalTitle">Mon compte</h2>
     <p class="modal-subtitle">${safe(currentUser.name)} · ${currentUser.role === 'grossiste' ? 'Compte grossiste' : 'Compte client'}<br>${safe(currentUser.phone)}${currentUser.city ? ` · ${safe(currentUser.city)}` : ''}</p>
     <div class="kyc-status ${kycClass}"><i data-lucide="${kyc === 'verifie' ? 'shield-check' : kyc === 'rejete' ? 'alert-circle' : kyc === 'en_attente' ? 'clock' : 'shield'}"></i><span>${safe(kycLabels[kyc])}</span></div>
     <button class="btn btn-orange full" data-action="kyc-open">${kyc === 'verifie' ? 'Mettre à jour mon identité' : 'Vérifier mon identité'}</button>
     <button class="btn btn-dark full" data-action="orders">${currentUser.role === 'grossiste' ? 'Voir les commandes reçues' : 'Voir mes commandes'}</button>
     ${
       currentUser.role === 'grossiste'
         ? `<button class="btn btn-dark full" data-action="products">Gérer mes produits</button>`
         : ''
     }
     <button class="btn btn-dark full" data-action="logout">Se déconnecter</button>`,
  );
}

/* ------------------------------------------------------------------ */
/* Panier et commande                                                  */
/* ------------------------------------------------------------------ */

function cartRow(line) {
  const { product, qty } = line;
  const available = product.available;
  return `<div class="cart-line ${available ? '' : 'unavailable'}">
    <div class="cart-emoji"><img src="${safe(product.imageSrc)}" alt="" onerror="this.onerror=null;this.src='${fallbackImage}'"/></div>
    <div class="cart-line-main">
      <strong>${safe(product.name)}</strong>
      <small>${money(product.price)} / ${safe(product.unit)}</small>
      ${
        available
          ? ''
          : `<span class="stock-badge out"><i data-lucide="alert-circle"></i> ${safe(stockMessage(product))}</span>`
      }
    </div>
    ${
      available
        ? `<div class="qty-controls"><button type="button" data-action="cart-minus" data-id="${safe(product.id)}" aria-label="Diminuer">−</button><strong>${qty}</strong><button type="button" data-action="cart-plus" data-id="${safe(product.id)}" aria-label="Augmenter">+</button></div>`
        : `<button type="button" class="qty-remove" data-action="cart-remove" data-id="${safe(product.id)}" aria-label="Retirer">×</button>`
    }
  </div>`;
}

function renderCart() {
  if (!currentUser) {
    openAuth('login', 'client', 'Créez un compte client ou connectez-vous pour commander.');
    return;
  }
  if (currentUser.role !== 'client') {
    toast('Connectez-vous avec un compte client pour commander.', 'error');
    return;
  }
  if (!cart.length) {
    openModal(
      `<h2 id="modalTitle">Votre panier</h2>
       <p class="modal-subtitle">Votre panier est encore vide. Ajoutez des produits pour préparer votre commande.</p>
       <button class="btn btn-orange full" data-action="continue-shopping">Explorer les produits</button>`,
    );
    return;
  }

  const lines = cartLines();
  const availableLines = lines.filter((line) => line.product.available);
  const total = availableLines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
  const unavailable = lines.length - availableLines.length;

  openModal(
    `<h2 id="modalTitle">Votre panier</h2>
     <p class="modal-subtitle">Vérifiez les quantités avant d’envoyer votre commande.</p>
     ${lines.map(cartRow).join('')}
     <div class="cart-total"><span>Total estimatif</span><strong>${money(total)}</strong></div>
     ${
       unavailable > 0
         ? `<p class="cart-warning"><i data-lucide="alert-circle"></i> ${unavailable} article${unavailable > 1 ? 's' : ''} en stock épuisé ${unavailable > 1 ? 'ne seront pas commandés. Retirez-les' : 'ne sera pas commandé. Retirez-le'} ou attendez le réassort.</p>`
         : ''
     }
     <p class="modal-note">Livraison : 1 500 FCFA, offerte dès 50 000 FCFA d’achat.</p>
     <button class="btn btn-orange full" data-action="checkout" ${availableLines.length ? '' : 'disabled'}>Passer ma commande</button>`,
  );
}

function changeCartQty(id, delta) {
  const item = cart.find((entry) => entry.id === id);
  const product = products.find((entry) => entry.id === id);
  if (!item || !product) return;
  if (delta > 0 && item.qty >= product.stock) {
    toast(`Stock maximum atteint (${product.stock}).`, 'error');
    return;
  }
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter((entry) => entry.id !== id);
  saveCart();
  renderCart();
}

function removeCartItem(id) {
  cart = cart.filter((entry) => entry.id !== id);
  saveCart();
  renderCart();
}

function checkoutForm() {
  const lines = cartLines().filter((line) => line.product.available);
  if (!lines.length) {
    toast('Aucun article disponible à commander.', 'error');
    return;
  }
  if (currentUser.kyc?.status !== 'verifie') {
    openModal(
      `<h2 id="modalTitle">Identité requise</h2>
       <p class="modal-subtitle">Vérifiez votre identité avant de confirmer une précommande. Cela prend quelques minutes.</p>
       <div class="kyc-status idle"><i data-lucide="shield"></i><span>${safe(kycLabels[currentUser.kyc?.status ?? 'non_verifie'])}</span></div>
       <button class="btn btn-orange full" data-action="kyc-open">Vérifier mon identité</button>
       <button class="btn btn-dark full" data-action="back-to-cart">Retour au panier</button>`,
    );
    return;
  }

  const subtotal = lines.reduce((sum, line) => sum + line.product.price * line.qty, 0);
  const delivery = subtotal >= 50000 ? 0 : 1500;
  openModal(
    `<h2 id="modalTitle">Finaliser la commande</h2>
     <p class="modal-subtitle">Le grossiste confirme le stock et le créneau de livraison.</p>
     <form data-form="checkout">
       <div class="form-field"><label for="deliveryPhone">Téléphone</label><input id="deliveryPhone" type="tel" required value="${safe(currentUser.phone)}" placeholder="07 00 00 00 00"/></div>
       <div class="form-grid">
         <div class="form-field"><label for="deliveryCity">Ville de livraison</label>
           <select id="deliveryCity" required>
             <option value="">Choisir</option>
             ${['Bouaflé', 'Daloa', 'Yamoussoukro', 'Abidjan', 'Autre'].map((city) => `<option ${city === currentUser.city ? 'selected' : ''}>${city}</option>`).join('')}
           </select>
         </div>
         <div class="form-field"><label for="deliveryAddress">Quartier / repère</label><input id="deliveryAddress" required placeholder="Marché central"/></div>
       </div>
       <div class="form-field"><label for="paymentMode">Paiement</label>
         <select id="paymentMode"><option value="mobile_money">Mobile Money</option><option value="livraison">Paiement à la livraison</option></select>
       </div>
       <div class="form-field"><label for="buyerNote">Précisions (facultatif)</label><textarea id="buyerNote" rows="2" placeholder="Instructions…"></textarea></div>
       <div class="cart-total"><span>Total${delivery ? ' + livraison' : ' (livraison offerte)'}</span><strong>${money(subtotal + delivery)}</strong></div>
       <p class="form-error hidden" id="checkoutError"></p>
       <button class="btn btn-orange full" type="submit" id="checkoutSubmit">Confirmer la commande</button>
     </form>`,
  );
}

async function submitCheckout() {
  const error = $('checkoutError');
  const city = $('deliveryCity').value;
  const address = $('deliveryAddress').value.trim();
  const phone = $('deliveryPhone').value.trim();
  if (!city) {
    error.textContent = 'Choisissez une ville de livraison.';
    error.classList.remove('hidden');
    return;
  }
  if (address.length < 4) {
    error.textContent = 'Indiquez un quartier ou un repère précis.';
    error.classList.remove('hidden');
    return;
  }
  const lines = cartLines().filter((line) => line.product.available);
  const button = $('checkoutSubmit');
  button.disabled = true;
  button.textContent = 'Envoi en cours…';

  try {
    const result = await api('/api/orders', {
      method: 'POST',
      body: {
        items: lines.map((line) => ({ productId: line.product.id, qty: line.qty })),
        city,
        address,
        phone,
        note: $('buyerNote').value.trim(),
        payment: $('paymentMode').value,
      },
    });
    cart = cart.filter((item) => !lines.some((line) => line.product.id === item.id));
    saveCart();
    await refreshAll();
    const order = result.order;
    openModal(
      `<h2 id="modalTitle">Commande enregistrée</h2>
       <p class="modal-subtitle">Référence <strong>${safe(order.ref)}</strong></p>
       <div class="order-item"><strong>${safe(order.city)} · ${money(order.total)}</strong><br>${safe(statusLabels[order.status] || order.status)}<br>${order.items.reduce((sum, item) => sum + item.qty, 0)} article(s)</div>
       <button class="btn btn-orange full" data-action="orders">Suivre ma commande</button>
       <button class="btn btn-dark full" data-action="continue-shopping">Continuer mes achats</button>`,
    );
    toast('Votre commande a été envoyée au grossiste.', 'success');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Confirmer la commande';
    if (error.code === 'KYC_REQUIRED') {
      toast('Vérifiez votre identité avant de commander.', 'error');
      openKyc();
      return;
    }
    if (error.code === 'INSUFFICIENT_STOCK' || error.code === 'PRODUCT_MISSING') {
      await refreshAll();
    }
    $('checkoutError').textContent = error.message;
    $('checkoutError').classList.remove('hidden');
  }
}

/* ------------------------------------------------------------------ */
/* Commandes                                                           */
/* ------------------------------------------------------------------ */

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function orderActions(order) {
  if (!currentUser) return '';
  const actions = [];
  if (currentUser.role === 'grossiste') {
    if (order.status === 'en_attente') {
      actions.push(['confirmee', 'Confirmer'], ['annulee', 'Refuser']);
    } else if (order.status === 'confirmee') {
      actions.push(['preparation', 'Préparer'], ['annulee', 'Annuler']);
    } else if (order.status === 'preparation') {
      actions.push(['en_route', 'Marquer en route']);
    } else if (order.status === 'en_route') {
      actions.push(['livree', 'Marquer livrée']);
    }
  } else if (currentUser.role === 'client') {
    if (order.status === 'en_route') actions.push(['livree', 'Confirmer la réception']);
    if (['en_attente', 'confirmee'].includes(order.status)) actions.push(['annulee', 'Annuler']);
  }
  if (!actions.length) return '';
  return `<div class="order-actions">${actions
    .map(
      ([status, label]) =>
        `<button type="button" class="mini-btn ${status === 'annulee' ? 'danger' : ''}" data-action="order-status" data-id="${safe(order.id)}" data-status="${status}">${label}</button>`,
    )
    .join('')}</div>`;
}

function renderOrders() {
  if (!currentUser) {
    openAuth('login');
    return;
  }
  const seller = currentUser.role === 'grossiste';
  openModal(
    `<h2 id="modalTitle">${seller ? 'Commandes reçues' : 'Mes commandes'}</h2>
     <p class="modal-subtitle">${seller ? 'Commandes contenant vos produits.' : 'Historique et suivi de vos précommandes.'}</p>
     ${
       orders.length
         ? orders
             .map((order) => {
               const items = seller
                 ? order.items.filter((item) => item.sellerId === currentUser.sellerId)
                 : order.items;
               if (seller && items.length === 0) return '';
               const displayedTotal = seller
                 ? items.reduce((sum, item) => sum + item.price * item.qty, 0)
                 : order.total;
               return `<div class="order-item">
                 <div class="order-head"><strong>${safe(order.ref)} · ${money(displayedTotal)}</strong><span class="order-status ${safe(order.status)}">${safe(statusLabels[order.status] || order.status)}</span></div>
                 <div class="order-sub">${safe(formatDate(order.createdAt))} · ${safe(order.city)}${seller ? ` · ${safe(order.buyerName)}` : ''}</div>
                 <div class="order-lines">${items
                   .map((item) => `<span>${safe(item.name)} × ${item.qty}</span>`)
                   .join('')}</div>
                 ${orderActions(order)}
               </div>`;
             })
             .join('')
         : `<p class="modal-subtitle">${seller ? 'Aucune commande reçue pour vos produits.' : 'Vous n’avez pas encore passé de commande.'}</p>`
     }`,
    { wide: true },
  );
}

async function updateOrderStatus(id, status) {
  try {
    await api(`/api/orders/${encodeURIComponent(id)}/status`, {
      method: 'PATCH',
      body: { status },
    });
    await refreshAll();
    renderOrders();
    toast(`Commande ${statusLabels[status]?.toLowerCase() || 'mise à jour'}.`, 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Espace grossiste                                                    */
/* ------------------------------------------------------------------ */

function sellerDashboard() {
  renderSellerDashboard();
}

function renderSellerDashboard() {
  if (!currentUser) {
    openAuth('login', 'grossiste', 'Connectez-vous ou créez un compte grossiste pour publier vos produits.');
    return;
  }
  if (currentUser.role !== 'grossiste') {
    toast('Cet espace est réservé aux grossistes.', 'error');
    return;
  }
  const received = orders.length;
  const published = myProducts.filter((product) => product.active).length;
  openModal(
    `<h2 id="modalTitle">Espace grossiste</h2>
     <p class="modal-subtitle">Bonjour ${safe(currentUser.name)}. Publiez vos articles et suivez vos commandes.</p>
     <div class="seller-dashboard">
       <div class="dashboard-tile"><strong>${published}</strong><small>Produits en ligne</small></div>
       <div class="dashboard-tile"><strong>${received}</strong><small>Commandes reçues</small></div>
     </div>
     <button class="btn btn-orange full" data-action="publish"><i data-lucide="plus-circle"></i> Publier un produit</button>
     <button class="btn btn-dark full" data-action="orders">Consulter les commandes</button>
     <h3 class="mini-title">Mon catalogue</h3>
     ${
       myProducts.length
         ? myProducts
             .map(
               (product) => `<div class="seller-product ${product.active ? '' : 'inactive'}">
                 <img src="${safe(product.imageUrl || imageUrls[product.image] || fallbackImage)}" alt="" onerror="this.onerror=null;this.src='${fallbackImage}'"/>
                 <div class="seller-product-main">
                   <strong>${safe(product.name)}</strong>
                   <small>${money(product.price)} / ${safe(product.unit)} · ${product.stock} unités</small>
                   <span class="seller-state">${product.active ? 'En ligne' : 'Retiré du catalogue'}</span>
                 </div>
                 <div class="seller-product-actions">
                   <div class="stock-editor">
                     <input type="number" min="0" value="${Number(product.stock)}" id="stock-${safe(product.id)}" aria-label="Stock de ${safe(product.name)}"/>
                     <button type="button" class="mini-btn" data-action="save-stock" data-id="${safe(product.id)}">Stock</button>
                   </div>
                   <button type="button" class="mini-btn ${product.active ? 'danger' : ''}" data-action="toggle-product" data-id="${safe(product.id)}" data-active="${product.active ? '0' : '1'}">${product.active ? 'Retirer' : 'Remettre en ligne'}</button>
                 </div>
               </div>`,
             )
             .join('')
         : '<p class="modal-subtitle">Vous n’avez pas encore publié de produit.</p>'
     }`,
    { wide: true },
  );
}

function openPublishForm() {
  if (!currentUser) {
    openAuth('login', 'grossiste');
    return;
  }
  if (currentUser.role !== 'grossiste') {
    toast('Seuls les comptes grossistes peuvent publier.', 'error');
    return;
  }
  productDraft = {
    photo: productDraft?.photo || null,
    name: '',
    category: 'alimentation',
    city: currentUser.city || 'Bouaflé',
    price: '',
    stock: '',
    unit: '',
    description: '',
  };
  renderPublishForm();
}

function renderPublishForm() {
  const photo = productDraft?.photo;
  openModal(
    `<h2 id="modalTitle">Publier un produit</h2>
     <p class="modal-subtitle">Ajoutez une photo et les informations de vente. L’article apparaîtra dans le catalogue.</p>
     <form data-form="product">
       <div class="form-field"><label for="pName">Nom du produit</label><input id="pName" required placeholder="Ex. Riz local parfumé" value="${safe(productDraft?.name ?? '')}"/></div>
       <div class="form-grid">
         <div class="form-field"><label for="pCategory">Catégorie</label>
           <select id="pCategory">${Object.keys(categoryValues).map((label) => `<option value="${categoryValues[label]}" ${productDraft?.category === categoryValues[label] ? 'selected' : ''}>${label}</option>`).join('')}</select>
         </div>
         <div class="form-field"><label for="pCity">Ville</label>
           <select id="pCity">${['Bouaflé', 'Daloa', 'Yamoussoukro', 'Abidjan'].map((city) => `<option ${city === (productDraft?.city || currentUser.city) ? 'selected' : ''}>${city}</option>`).join('')}</select>
         </div>
       </div>
       <div class="form-grid">
         <div class="form-field"><label for="pPrice">Prix (FCFA)</label><input id="pPrice" type="number" min="1" required placeholder="15000" value="${safe(productDraft?.price ?? '')}"/></div>
         <div class="form-field"><label for="pStock">Stock disponible</label><input id="pStock" type="number" min="0" required placeholder="20" value="${safe(productDraft?.stock ?? '')}"/></div>
       </div>
       <div class="form-field"><label for="pUnit">Unité de vente</label><input id="pUnit" required placeholder="sac de 25 kg, caisse…" value="${safe(productDraft?.unit ?? '')}"/></div>
       <div class="form-field"><label for="pDescription">Description</label><textarea id="pDescription" rows="3" required minlength="10" placeholder="Qualité, provenance, conditionnement…">${safe(productDraft?.description ?? '')}</textarea></div>
       <div class="photo-field">
         <div class="photo-label"><strong>Photo du produit</strong><span>Importez une photo ou prenez-la maintenant</span></div>
         <div class="photo-preview ${photo ? 'has-photo' : ''}">
           ${photo ? `<img src="${photo}" alt="Photo du produit"/>` : '<span class="photo-empty"><i data-lucide="package"></i>Ajoutez une photo</span>'}
         </div>
         <div class="photo-actions">
           <button type="button" class="photo-btn" data-action="import" data-target="product"><i data-lucide="image"></i> Importer</button>
           <button type="button" class="photo-btn" data-action="camera" data-target="product"><i data-lucide="camera"></i> Prendre une photo</button>
         </div>
       </div>
       <p class="form-error hidden" id="productError"></p>
       <button class="btn btn-orange full" type="submit" id="productSubmit">Publier dans le catalogue</button>
     </form>`,
    { wide: true },
  );
}

async function submitProduct() {
  syncProductDraft();
  const error = $('productError');
  const name = $('pName').value.trim();
  const category = $('pCategory').value;
  const price = Number($('pPrice').value);
  const stock = Number($('pStock').value);
  const unit = $('pUnit').value.trim();
  const description = $('pDescription').value.trim();
  const city = $('pCity').value;

  const problems = [];
  if (name.length < 2) problems.push('Indiquez le nom du produit.');
  if (!Number.isFinite(price) || price <= 0) problems.push('Entrez un prix valide.');
  if (!Number.isFinite(stock) || stock < 0) problems.push('Entrez un stock valide.');
  if (unit.length < 1) problems.push('Indiquez l’unité de vente.');
  if (description.length < 10) problems.push('Ajoutez une description d’au moins 10 caractères.');
  if (problems.length) {
    error.textContent = problems[0];
    error.classList.remove('hidden');
    return;
  }

  const button = $('productSubmit');
  button.disabled = true;
  button.textContent = 'Publication…';
  try {
    await api('/api/products', {
      method: 'POST',
      body: {
        name,
        category,
        price,
        stock,
        unit,
        description,
        city,
        image: categoryImages[category] || 'rice',
        ...(productDraft?.photo ? { photo: productDraft.photo } : {}),
      },
    });
    await refreshAll();
    productDraft = null;
    sellerDashboard();
    toast('Votre produit est publié.', 'success');
  } catch (error) {
    button.disabled = false;
    button.textContent = 'Publier dans le catalogue';
    $('productError').textContent = error.message;
    $('productError').classList.remove('hidden');
  }
}

async function saveStock(id) {
  const input = $(`stock-${id}`);
  const stock = Number(input?.value);
  if (!Number.isFinite(stock) || stock < 0) {
    toast('Entrez un stock valide.', 'error');
    return;
  }
  try {
    await api(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { stock },
    });
    await refreshAll();
    sellerDashboard();
    toast('Stock mis à jour.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function toggleProduct(id, active) {
  try {
    await api(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { active: active === '1' },
    });
    await refreshAll();
    sellerDashboard();
    toast(active === '1' ? 'Produit remis en ligne.' : 'Produit retiré du catalogue.', 'success');
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------------------ */
/* Actions de la modale                                                */
/* ------------------------------------------------------------------ */

async function onModalClick(event) {
  const trigger = event.target.closest('[data-action]');
  if (!trigger) return;
  const action = trigger.dataset.action;
  const id = trigger.dataset.id;
  const target = trigger.dataset.target;

  switch (action) {
    case 'auth-switch':
      openAuth(authMode === 'signup' ? 'login' : 'signup', $('authRole')?.value || authRole);
      break;
    case 'forgot':
      openForgot($('authPhone')?.value?.trim() || '');
      break;
    case 'auth-back':
      openAuth('login', 'client');
      break;
    case 'otp-resend':
      await resendOtp(trigger.dataset.channel);
      break;
    case 'kyc-open':
      openKyc();
      break;
    case 'orders':
      renderOrders();
      break;
    case 'products':
      sellerDashboard();
      break;
    case 'logout':
      await logout();
      break;
    case 'publish':
      openPublishForm();
      break;
    case 'import':
      pickImage(target);
      break;
    case 'camera':
      await openCamera(target);
      break;
    case 'camera-capture':
      captureCamera(target);
      break;
    case 'camera-cancel':
      stopCamera();
      closeModal();
      if (target === 'product') renderPublishForm();
      else renderKycForm();
      break;
    case 'kyc-otp-send':
      await sendKycCode();
      break;
    case 'kyc-otp-verify':
      await verifyKycCode();
      break;
    case 'continue-shopping':
      closeModal();
      $('catalogue')?.scrollIntoView({ behavior: 'smooth' });
      break;
    case 'back-to-cart':
      renderCart();
      break;
    case 'cart-minus':
      changeCartQty(id, -1);
      break;
    case 'cart-plus':
      changeCartQty(id, 1);
      break;
    case 'cart-remove':
      removeCartItem(id);
      break;
    case 'checkout':
      checkoutForm();
      break;
    case 'order-status':
      await updateOrderStatus(id, trigger.dataset.status);
      break;
    case 'save-stock':
      await saveStock(id);
      break;
    case 'toggle-product':
      await toggleProduct(id, trigger.dataset.active);
      break;
    default:
      break;
  }
}

async function onModalSubmit(event) {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();

  switch (form.dataset.form) {
    case 'auth':
      await submitAuth();
      break;
    case 'otp':
      await verifyOtp();
      break;
    case 'forgot':
      await submitForgot();
      break;
    case 'reset':
      await submitReset();
      break;
    case 'kyc':
      await submitKyc();
      break;
    case 'checkout':
      await submitCheckout();
      break;
    case 'product':
      await submitProduct();
      break;
    default:
      break;
  }
}

/* ------------------------------------------------------------------ */
/* Événements globaux                                                  */
/* ------------------------------------------------------------------ */

$('categories').addEventListener('click', (event) => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  selectedCategory = button.dataset.category;
  renderCategories();
  renderProducts();
});

$('searchInput').addEventListener('input', (event) => {
  searchTerm = event.target.value;
  renderProducts();
});

$('cityFilter').addEventListener('change', (event) => {
  selectedCity = event.target.value;
  renderProducts();
});

$('searchBtn').onclick = () => {
  searchTerm = $('searchInput').value;
  selectedCity = $('cityFilter').value;
  renderProducts();
  $('catalogue').scrollIntoView({ behavior: 'smooth' });
};

$('sortBtn').onclick = () => {
  ascending = !ascending;
  $('sortBtn').innerHTML = `${ascending ? 'Prix : croissant' : 'Prix : décroissant'} <i data-lucide="arrow-up-down"></i>`;
  renderProducts();
  if (window.lucide) lucide.createIcons();
};

$('productGrid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-add]');
  if (button) addToCart(button.dataset.add);
});

$('resetFilters').onclick = () => {
  selectedCategory = 'Tous';
  searchTerm = '';
  selectedCity = 'all';
  $('searchInput').value = '';
  $('cityFilter').value = 'all';
  renderCategories();
  renderProducts();
};

$('publishTopBtn').onclick = () => {
  if (currentUser?.role === 'grossiste') openPublishForm();
  else openAuth('signup', 'grossiste', 'Créez votre compte grossiste pour publier vos produits.');
};

$('cartBtn').onclick = renderCart;
$('ordersBtn').onclick = () => (currentUser ? renderOrders() : openAuth('login'));
$('sellerBtn').onclick = () =>
  currentUser?.role === 'grossiste'
    ? sellerDashboard()
    : openAuth('signup', 'grossiste', 'Créez votre compte professionnel pour vendre sur Sugu.');
$('profileBtn').onclick = profileModal;

$('modalClose').onclick = closeModal;
$('modalBackdrop').addEventListener('click', (event) => {
  if (event.target === $('modalBackdrop')) closeModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeModal();
});

$('modalContent').addEventListener('click', onModalClick);
$('modalContent').addEventListener('submit', onModalSubmit);

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */

async function boot() {
  renderCategories();
  try {
    await refreshAll();
  } catch (error) {
    toast(error.message, 'error');
    products = [];
    renderProducts();
  }
}

boot();
