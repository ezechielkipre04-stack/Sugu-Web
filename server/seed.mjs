import { hashPassword } from './lib/security.mjs';
import { nowIso, setMeta, transaction } from './lib/db.mjs';

const DAY = 86_400_000;
const iso = (days, hours = 0) =>
  new Date(Date.now() - days * DAY - hours * 3_600_000).toISOString();

const wholesalers = [
  ['w1', 'Grossiste Koffi', 'Bouaflé', 'Marché central', 2.4, 4.8, 126, 1, 2016, '07 08 45 12 90', '06:00 – 18:00', 1, 0.3, 0.36, 6.9935, -5.748, 'GK', '#FFE0C7'],
  ['w2', 'Marché Central Daloa', 'Daloa', 'Grand marché', 1.1, 4.6, 89, 1, 2012, '05 76 30 22 14', '05:30 – 19:00', 1, 0.63, 0.28, 6.881, -6.453, 'MD', '#FFF1C9'],
  ['w3', 'Chez Mariam', 'Yamoussoukro', 'Habitat', 3.8, 4.9, 204, 1, 2019, '01 42 08 76 33', '07:00 – 17:30', 1, 0.52, 0.63, 6.824, -5.292, 'CM', '#F4E3D3'],
  ['w4', "Coopérative N'Zi", 'Bouaflé', 'Quartier Dioulabougou', 4.2, 4.7, 73, 1, 2018, '07 55 19 40 02', '06:00 – 16:00', 0, 0.22, 0.66, 6.984, -5.739, 'NZ', '#E3F0E7'],
  ['w5', 'Grossiste Traoré', 'Daloa', 'Tazibouo', 5.6, 4.4, 51, 0, 2020, '05 08 62 71 45', '07:30 – 18:30', 1, 0.75, 0.54, 6.871, -6.441, 'GT', '#FBE4DF'],
  ['w6', 'Entrepôt du Centre', 'Yamoussoukro', 'Zone industrielle', 7.1, 4.5, 98, 1, 2015, '01 07 33 58 20', '06:30 – 17:00', 1, 0.44, 0.17, 6.833, -5.281, 'EC', '#E4E8F4'],
];

const products = [
  // Alimentation
  ['p1', 'w1', 'Riz local parfumé', 'alimentation', 18500, 'sac de 25 kg', 24, 1, 'rice', 'Très demandé', "Riz blanc local, trié et ensaché à Bouaflé. Grain long, bonne tenue à la cuisson. Idéal pour la restauration de quartier comme pour la revente au détail."],
  ['p2', 'w2', 'Tomates fraîches', 'alimentation', 6500, 'caisse de 15 kg', 18, 2, 'tomatoes', 'Récolte du jour', "Tomates récoltées le matin même dans la région de Daloa. Calibre moyen, chair ferme. Livraison possible sous 24 h pour garder toute la fraîcheur."],
  ['p3', 'w3', 'Huile de palme rouge', 'alimentation', 12000, 'bidon de 5 L', 32, 1, 'oil', null, "Huile de palme artisanale, pressée à froid. Robe rouge profonde et goût franc, très recherchée pour la cuisine traditionnelle."],
  ['p4', 'w4', 'Mangues Kent', 'alimentation', 4500, 'caisse de 10 kg', 15, 2, 'mangoes', 'Saison', "Mangues Kent de la coopérative, calibrées et triées. Parfaites pour la vente au détail ou la transformation. Stock limité à la saison."],
  ['p5', 'w5', 'Oignons violets', 'alimentation', 9000, 'sac de 10 kg', 40, 1, 'onions', null, "Oignons violets secs, conservés en entrepôt ventilé. Bonne durée de conservation et calibre régulier."],
  ['p6', 'w6', 'Maïs jaune', 'alimentation', 14000, 'sac de 50 kg', 21, 1, 'maize', 'Populaire', "Maïs jaune séché, destiné à l'alimentation animale ou à la transformation. Sacs cousus et stockés au sec."],
  // Vêtements
  ['p7', 'w2', 'Chemises en lot', 'vetements', 15000, 'lot de 10 pièces', 12, 1, 'fabric', 'Nouveau', "Lot de chemises pour homme, tailles et couleurs assorties. Articles de second choix en très bon état, prêts à la revente."],
  ['p8', 'w4', 'T-shirts unis', 'vetements', 22000, 'lot de 20 pièces', 9, 1, 'tshirts', null, "T-shirts coton unis, tailles S à XL. Lot idéal pour compléter un étal de marché ou une boutique de quartier."],
  ['p13', 'w1', 'Pagnes wax', 'vetements', 32000, 'lot de 6 pagnes', 14, 1, 'wax', 'Nouveau', "Pagnes wax aux motifs variés, tissu résistant et couleurs éclatantes. Lot de six pièces pour la couture ou la revente au détail."],
  // Mode
  ['p14', 'w6', 'Robes en wax', 'mode', 28000, 'lot de 5 robes', 11, 1, 'dress', 'Tendance', "Robes en wax confectionnées par des ateliers ivoiriens. Coupes ajustées, tailles S à XL. Prêtes à être exposées en boutique."],
  ['p15', 'w3', 'Foulards et pagnes', 'mode', 9500, 'lot de 12 foulards', 25, 1, 'scarf', null, "Foulards assortis en tissu léger, motifs traditionnels. Un lot coloré pour compléter une collection d'accessoires."],
  // Accessoires
  ['p9', 'w5', 'Sandales en cuir', 'accessoires', 12000, 'lot de 12 paires', 26, 1, 'shoes', null, "Sandales en cuir cousues main, pointures 38 à 45. Fabrication locale, semelles renforcées."],
  ['p12', 'w6', 'Casques audio', 'accessoires', 18000, 'unité', 16, 1, 'headphones', null, "Casques audio sans fil, autonomie 12 h, avec câble de secours. Produit testé, garantie 3 mois par l'entrepôt."],
  ['p16', 'w2', 'Montres classiques', 'accessoires', 21000, 'lot de 6 montres', 19, 1, 'watches', 'Bon prix', "Montres à bracelet cuir, cadran sobre et mouvement à quartz. Lot de six pièces idéal pour la revente en boutique."],
  // Maison
  ['p10', 'w3', 'Savon de Marseille', 'maison', 8500, 'carton de 24 pains', 34, 1, 'soap', 'Bon prix', "Savon multi-usage en carton de 24 pains. Très demandé pour la lessive et la toilette, conditionnement prêt pour la revente."],
  ['p11', 'w1', 'Bassines plastiques', 'maison', 6000, 'lot de 10 bassines', 7, 1, 'buckets', 'Stock limité', "Bassines en plastique alimentaire, 20 litres. Lot de 10, coloris assortis. Stock limité sur ce réassort."],
  ['p17', 'w6', 'Ustensiles de cuisine', 'maison', 13500, 'lot de 15 pièces', 0, 1, 'utensils', 'Réassort attendu', "Louches, spatules et cuillères en inox pour équiper une cuisine de restaurant. Lot complet de quinze ustensiles résistants."],
  // Beauté
  ['p18', 'w2', 'Crème de karité', 'beaute', 7500, 'carton de 12 pots', 31, 1, 'shea', 'Très demandé', "Beurre de karité brut, conditionné en pots de 250 ml. Hydratant naturel très apprécié pour la peau et les cheveux."],
  ['p19', 'w4', 'Parfums en lot', 'beaute', 26000, 'lot de 10 flacons', 13, 1, 'perfume', null, "Parfums d'ambiance et eaux de toilette en flacons de 50 ml. Assortiment de senteurs florales et boisées."],
  ['p20', 'w6', 'Huile de coco', 'beaute', 11000, 'carton de 12 bouteilles', 22, 1, 'coconut', 'Populaire', "Huile de coco vierge pressée à froid, bouteilles de 500 ml. Utilisée en cosmétique, en cuisine et pour les soins capillaires."],
];

const accounts = [
  {
    id: 'demo-client', name: 'Kipré Ezéchiel', phone: '07 08 45 12 90', role: 'client',
    city: 'Bouaflé', password: 'Client2.0', createdAt: iso(120), lastActiveAt: iso(0, 1),
    kyc: ['verifie', 'Kipré Ezéchiel', 'cni', 'CI-2021-448210', iso(88), iso(87), 'Admin SUGU'],
  },
  {
    id: 'demo-seller', name: 'Koffi Yao', phone: '05 44 21 08 76', role: 'grossiste',
    city: 'Bouaflé', sellerId: 'w1', password: 'Seller2.0', createdAt: iso(210),
    lastActiveAt: iso(0, 3), kyc: ['verifie', 'Koffi Yao', 'cni', 'CI-2018-771903', iso(200), iso(199), 'Admin SUGU'],
  },
  {
    id: 'admin-principal', name: 'Administrateur SUGU', phone: '07 17 02 76 77', role: 'admin',
    city: 'Abidjan', password: 'Admin2.0', createdAt: iso(400), lastActiveAt: iso(0, 0),
    kyc: ['verifie', 'Administrateur SUGU', 'passeport', 'CI-P-ADMIN-001', iso(400), iso(400), 'Système'],
  },
  {
    id: 'guest-awa', name: 'Awa Koné', phone: '05 61 22 74 08', role: 'client', city: 'Daloa',
    createdAt: iso(3), lastActiveAt: iso(0, 6),
    kyc: ['en_attente', 'Awa Koné', 'cni', 'CI-2025-118420', iso(0, 6), null, null],
  },
  {
    id: 'guest-bakary', name: 'Bakary Traoré', phone: '07 09 18 33 56', role: 'client',
    city: 'Bouaflé', createdAt: iso(32), lastActiveAt: iso(0, 1),
    kyc: ['verifie', 'Bakary Traoré', 'cni', 'CI-2022-093114', iso(31), iso(30), 'Admin SUGU'],
  },
  {
    id: 'guest-mariam', name: 'Mariam Coulibaly', phone: '01 42 08 76 33', role: 'client',
    city: 'Yamoussoukro', createdAt: iso(12), lastActiveAt: iso(2),
    kyc: ['non_verifie', null, null, null, null, null, null],
  },
  {
    id: 'guest-souleymane', name: 'Souleymane Bamba', phone: '05 08 62 71 45', role: 'client',
    city: 'Abidjan', status: 'suspendu', createdAt: iso(60), lastActiveAt: iso(8),
    kyc: ['rejete', null, null, null, iso(9), iso(8), 'Admin SUGU', 'Document illisible et numéro incohérent.'],
  },
  {
    id: 'guest-fanta', name: 'Fanta Diarra', phone: '07 55 19 40 02', role: 'client',
    city: 'Bouaflé', createdAt: iso(22), lastActiveAt: iso(0, 0),
    kyc: ['non_verifie', null, null, null, null, null, null],
  },
  {
    id: 'guest-ibrahim', name: 'Ibrahim Konaté', phone: '07 09 21 44 63', role: 'grossiste',
    city: 'Daloa', sellerId: 'w2', createdAt: iso(180), lastActiveAt: iso(1),
    kyc: ['non_verifie', null, null, null, null, null, null],
  },
  {
    id: 'guest-nadia', name: 'Nadia Kouassi', phone: '05 76 30 22 14', role: 'client',
    city: 'Daloa', createdAt: iso(1), lastActiveAt: iso(0, 3),
    kyc: ['en_attente', 'Nadia Kouassi', 'passeport', 'CI-P-552014', iso(1, 3), null, null],
  },
  {
    id: 'guest-kouassi', name: 'Kouassi Ernest', phone: '01 07 33 58 20', role: 'grossiste',
    city: 'Yamoussoukro', sellerId: 'w6', createdAt: iso(5), lastActiveAt: iso(0, 4),
    kyc: ['non_verifie', null, null, null, null, null, null],
  },
  {
    id: 'guest-aminata', name: 'Aminata Traoré', phone: '01 00 11 22 33', role: 'client',
    city: 'Abidjan', createdAt: iso(95), lastActiveAt: iso(0, 5),
    kyc: ['non_verifie', null, null, null, null, null, null],
  },
];

const productById = new Map(products.map((row) => [row[0], row]));

const orderItem = (productId, qty) => {
  const product = productById.get(productId);
  return {
    productId,
    sellerId: product[1],
    name: product[2],
    price: product[4],
    qty,
    unit: product[5],
    image: product[8],
  };
};

const seededOrders = [
  {
    id: 'o1', ref: 'SG-4821', buyerId: 'demo-client', buyerName: 'Kipré Ezéchiel',
    phone: '07 08 45 12 90', city: 'Bouaflé', address: 'Dioulabougou, face à la pharmacie du marché',
    payment: 'mobile_money', status: 'en_route', createdAt: iso(1, 4),
    items: [orderItem('p1', 2), orderItem('p3', 1)], deliveryFee: 1500,
  },
  {
    id: 'o2', ref: 'SG-4730', buyerId: 'demo-client', buyerName: 'Kipré Ezéchiel',
    phone: '07 08 45 12 90', city: 'Bouaflé', address: 'Dioulabougou, face à la pharmacie du marché',
    payment: 'livraison', status: 'livree', createdAt: iso(7, 2),
    items: [orderItem('p4', 3), orderItem('p2', 2)], deliveryFee: 1500,
  },
  {
    id: 'o3', ref: 'SG-4602', buyerId: 'demo-client', buyerName: 'Kipré Ezéchiel',
    phone: '07 08 45 12 90', city: 'Bouaflé', address: 'Dioulabougou, face à la pharmacie du marché',
    payment: 'mobile_money', status: 'livree', createdAt: iso(15, 5),
    items: [orderItem('p8', 1), orderItem('p10', 2)], deliveryFee: 1500,
  },
  {
    id: 'o4', ref: 'SG-4830', buyerId: 'guest-awa', buyerName: 'Awa Koné',
    phone: '05 61 22 74 08', city: 'Daloa', address: 'Quartier Tazibouo, près du château d’eau',
    payment: 'livraison', status: 'en_attente', createdAt: iso(0, 6),
    items: [orderItem('p1', 5), orderItem('p6', 2)], deliveryFee: 0,
    note: 'Livraison avant midi si possible.',
  },
  {
    id: 'o5', ref: 'SG-4825', buyerId: 'guest-bakary', buyerName: 'Bakary Traoré',
    phone: '07 09 18 33 56', city: 'Bouaflé', address: 'Marché central, boutique 14',
    payment: 'mobile_money', status: 'confirmee', createdAt: iso(1, 1),
    items: [orderItem('p4', 4), orderItem('p7', 1)], deliveryFee: 1500,
  },
].map((order) => {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  return { ...order, subtotal, total: subtotal + order.deliveryFee, updatedAt: order.createdAt };
});

const seededMessages = [
  ['m1', 'w1', 'demo-client', 'demo-seller', 'Koffi Yao', demoText(0, 9), 'Bonjour et bienvenue chez Grossiste Koffi. Dites-moi ce qu’il vous faut pour votre boutique.'],
  ['m2', 'w1', 'demo-client', 'demo-client', 'Kipré Ezéchiel', demoText(0, 8), 'Bonjour. Est-ce que vous avez encore du riz local en sac de 25 kg ?'],
  ['m3', 'w1', 'demo-client', 'demo-seller', 'Koffi Yao', demoText(0, 7), 'Oui, 24 sacs disponibles à 18 500 F. Livraison possible demain matin sur Bouaflé.'],
  ['m4', 'w2', 'demo-client', 'guest-ibrahim', 'Ibrahim Konaté', demoText(3, 3), 'Bonjour, bienvenue au Marché Central Daloa. Tomates fraîches et chemises disponibles cette semaine.'],
];

function demoText(days, hours) {
  return iso(days, hours);
}

function rowUser(account) {
  return {
    id: account.id,
    name: account.name,
    phone: account.phone,
    role: account.role,
    city: account.city,
    sellerId: account.sellerId ?? null,
    password: account.password ?? null,
    status: account.status ?? 'actif',
    createdAt: account.createdAt,
    lastActiveAt: account.lastActiveAt,
    kyc: account.kyc,
  };
}

export function seedDatabase(db) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (Number(existing?.count ?? 0) > 0) return false;

  transaction(db, () => {
    for (const raw of wholesalers) {
      const [id, name, city, district, distanceKm, rating, reviews, verified, since, phone, hours, open, x, y, lat, lng, initials, tint] = raw;
      const owner =
        id === 'w1' ? 'demo-seller' : id === 'w2' ? 'guest-ibrahim' : id === 'w6' ? 'guest-kouassi' : null;
      db.prepare(
        `INSERT INTO wholesalers (id, owner_id, name, city, district, distance_km, rating, reviews,
          verified, since, phone, hours, open, x, y, lat, lng, initials, tint)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, owner, name, city, district, distanceKm, rating, reviews, verified, since, phone, hours, open, x, y, lat, lng, initials, tint);
    }

    for (const product of products) {
      const [id, sellerId, name, category, price, unit, stock, minQty, image, tag, description] = product;
      db.prepare(
        `INSERT INTO products (id, seller_id, name, category, price, unit, stock, min_qty,
          image, tag, description, active, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(id, sellerId, name, category, price, unit, stock, minQty, image, tag, description, 1, iso(60));
    }

    for (const account of accounts) {
      const user = rowUser(account);
      const credentials = user.password ? hashPassword(user.password) : null;
      const key = user.phone.replace(/\D/g, '');
      db.prepare(
        `INSERT INTO users (id, name, phone, phone_key, role, city, status, seller_id,
          password_hash, password_salt, created_at, last_active_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(user.id, user.name, user.phone, key, user.role, user.city, user.status, user.sellerId,
        credentials?.hash ?? null, credentials?.salt ?? null, user.createdAt, user.lastActiveAt);

      const [status, fullName, documentType, documentNumber, submittedAt, reviewedAt, reviewedBy, rejectionReason] = user.kyc;
      db.prepare(
        `INSERT INTO kyc (user_id, status, full_name, document_type, document_number,
          submitted_at, reviewed_at, reviewed_by, rejection_reason)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(user.id, status, fullName, documentType, documentNumber, submittedAt, reviewedAt, reviewedBy, rejectionReason ?? null);
    }

    for (const order of seededOrders) {
      db.prepare(
        `INSERT INTO orders (id, ref, buyer_id, buyer_name, phone, city, address, note, payment,
          subtotal, delivery_fee, total, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(order.id, order.ref, order.buyerId, order.buyerName, order.phone, order.city, order.address,
        order.note ?? null, order.payment, order.subtotal, order.deliveryFee, order.total,
        order.status, order.createdAt, order.updatedAt);

      for (const item of order.items) {
        db.prepare(
          `INSERT INTO order_items (order_id, product_id, seller_id, name, price, qty, unit, image)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).run(order.id, item.productId, item.sellerId, item.name, item.price, item.qty, item.unit, item.image);
      }
    }

    for (const [id, threadId, clientId, senderId, senderName, createdAt, text] of seededMessages) {
      db.prepare(
        `INSERT INTO messages (id, thread_id, client_id, sender_id, sender_name, text, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(id, threadId, clientId, senderId, senderName, text, createdAt);
    }

    const byId = new Map(accounts.map((account) => [account.id, rowUser(account)]));
    const seller = byId.get('demo-seller');
    const client = byId.get('demo-client');

    const activityRows = [
      ['act-login-admin', byId.get('admin-principal'), 'connexion', 'Connexion à l’espace admin', iso(0, 0)],
      ['act-order-awa', byId.get('guest-awa'), 'commande', 'Précommande SG-4830 · 92 500 FCFA', iso(0, 6)],
      ['act-kyc-awa', byId.get('guest-awa'), 'kyc_soumis', 'Dossier d’identité soumis (CNI)', iso(0, 6)],
      ['act-login-fanta', byId.get('guest-fanta'), 'connexion', 'Connexion à l’application', iso(0, 0)],
      ['act-order-bakary', byId.get('guest-bakary'), 'commande', 'Précommande SG-4825 · 60 500 FCFA', iso(1, 1)],
      ['act-kyc-nadia', byId.get('guest-nadia'), 'kyc_soumis', 'Dossier d’identité soumis (passeport)', iso(1, 3)],
      ['act-stock-koffi', seller, 'stock', 'Stock mis à jour : Riz local parfumé', iso(1, 2)],
      ['act-produit-ibrahim', byId.get('guest-ibrahim'), 'produit', 'Produit publié : Tomates fraîches', iso(1, 4)],
      ['act-suspend-souleymane', byId.get('guest-souleymane'), 'compte_suspendu', 'Compte suspendu par l’administration', iso(2, 1)],
      ['act-rejet-souleymane', byId.get('guest-souleymane'), 'kyc_rejete', 'Dossier d’identité rejeté', iso(8, 0)],
      ['act-login-mariam', byId.get('guest-mariam'), 'connexion', 'Connexion à l’application', iso(2, 3)],
      ['act-kyc-bakary', byId.get('guest-bakary'), 'kyc_approuve', 'Identité vérifiée par Admin SUGU', iso(30, 0)],
      ['act-order-demo', client, 'commande', 'Précommande SG-4821 · 50 500 FCFA', iso(1, 4)],
      ['act-login-demo', client, 'connexion', 'Connexion à l’application', iso(0, 1)],
      ['act-message-demo', client, 'message', 'Message envoyé à Grossiste Koffi', iso(0, 7)],
    ];

    for (let day = 0; day < 7; day += 1) {
      accounts.slice(0, 7).forEach((account, index) => {
        activityRows.push([
          `act-daily-${day}-${index}`,
          byId.get(account.id),
          'connexion',
          'Connexion à l’application',
          iso(day, 2 + index),
        ]);
      });
    }

    for (const [id, user, type, label, at] of activityRows) {
      if (!user) continue;
      db.prepare(
        `INSERT INTO activity (id, user_id, user_name, role, type, label, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(id, user.id, user.name, user.role, type, label, at);
    }

    setMeta(db, 'seed_version', '1');
    setMeta(db, 'seeded_at', nowIso());
  });

  return true;
}
