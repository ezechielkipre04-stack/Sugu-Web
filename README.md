# SUGU — marketplace de gros

SUGU met en relation des commerçants et des grossistes en Côte d’Ivoire. Le projet est une application web complète : catalogue, panier, commandes, comptes clients et grossistes, vérification d’identité (KYC), photos produits et codes de confirmation par WhatsApp/SMS.

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation et lancement](#installation-et-lancement)
- [Comptes de démonstration](#comptes-de-démonstration)
- [Codes de vérification](#codes-de-vérification)
- [Règles métier importantes](#règles-métier-importantes)
- [API](#api)
- [Tests](#tests)
- [Structure du projet](#structure-du-projet)
- [Dépôt Git](#dépôt-git)

## Fonctionnalités

### Catalogue et panier

- Catalogue de démonstration réparti dans six catégories : Alimentation, Vêtements, Mode, Accessoires, Maison et Beauté.
- Recherche par nom, grossiste ou catégorie, filtre par ville et tri par prix.
- Badge « Stock épuisé » lorsqu’un article n’a plus de stock **ou** lorsque l’offre n’a pas été publiée par un grossiste disposant d’un compte.
- Panier persistant, quantités limitées au stock réel, retrait des articles indisponibles.
- Commande refusée si le client n’a pas fait vérifier son identité.

### Comptes et connexion

- Inscription et connexion sur une même page avec nom, numéro de téléphone et mot de passe.
- Lien « Mot de passe oublié ? » placé sous le champ du mot de passe.
- Connexion en deux étapes : le mot de passe est validé par le serveur, puis un code à six chiffres est envoyé par WhatsApp (ou SMS) avant l’ouverture de la session.
- Réinitialisation du mot de passe avec le même mécanisme de code.
- Espace grossiste : publication d’articles, import ou prise de photo, mise à jour du stock, retrait et remise en ligne.

### Vérification d’identité (KYC)

- Nom complet, type et numéro de pièce.
- Recto et verso : import depuis l’appareil **ou** prise de photo.
- Selfie uniquement en prise instantanée, sans import possible.
- Code de vérification envoyé par WhatsApp/SMS avant l’envoi du dossier.
- En démonstration, le dossier est automatiquement marqué comme vérifié (`AUTO_VERIFY_KYC=true`). En production, passez cette option à `false` et validez les dossiers depuis l’administration.

### Administration

L’API fournit aussi les routes d’administration (comptes, dossiers KYC, activité, suspension). Elles sont protégées par le rôle `admin`.

## Architecture

```text
Navigateur (HTML/CSS/JS)
        │  fetch / JSON
        ▼
Serveur Node.js (http natif, routes maison)
        │
        ├── SQLite (node:sqlite) : comptes, produits, commandes, KYC, codes
        └── Fichiers : photos produits et pièces KYC
```

- Le serveur sert à la fois l’API `/api/...` et les fichiers statiques (`index.html`, `style.css`, `app.js`).
- Aucune dépendance npm obligatoire : le projet utilise `node:http`, `node:sqlite` et `node:crypto`.
- Les mots de passe sont hachés avec `scrypt` et un sel aléatoire.
- Les sessions sont stockées en base sous forme de hash de jeton.
- Les codes OTP sont hachés, expirent après cinq minutes et sont limités en tentatives.

## Prérequis

- **Node.js 24 ou supérieur** (nécessaire pour `node:sqlite`).
- Un navigateur récent.
- Facultatif : un compte WhatsApp Cloud API (Meta) ou un fournisseur SMS (Twilio/Termii) pour envoyer de vrais codes.

## Installation et lancement

```bash
# 1. Se placer dans le dossier
cd sugu-web

# 2. Créer la configuration locale
copy server\.env.example server\.env    # Windows
# cp server/.env.example server/.env    # macOS / Linux

# 3. Lancer le serveur
npm start
```

Ouvrir ensuite <http://localhost:4000>.

Au premier démarrage, la base SQLite est créée dans `server/data/sugu.db` et remplie avec les données de démonstration.

### Configuration

Le fichier `server/.env` reprend les variables de `server/.env.example`. Les plus importantes :

| Variable | Rôle | Valeur de démonstration |
| --- | --- | --- |
| `PORT` | Port HTTP | `4000` |
| `APP_ORIGIN` | Origine autorisée pour le CORS | `http://localhost:4000` |
| `OTP_DEBUG` | Affiche le code de test dans l’interface et la console | `true` |
| `AUTO_VERIFY_KYC` | Marque automatiquement les dossiers KYC comme vérifiés | `true` |
| `DEMO_SEED` | Crée les données de démonstration au premier lancement | `true` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Envoi réel par WhatsApp Cloud API | vides |
| `TWILIO_*` ou `TERMII_*` | Envoi SMS de secours | vides |

Sans clé fournisseur, le serveur passe en **mode simulation** : aucun message n’est réellement envoyé, le code apparaît dans la console et dans l’interface sous la mention « Code de test ».

## Comptes de démonstration

| Rôle | Téléphone | Mot de passe |
| --- | --- | --- |
| Client | `07 08 45 12 90` | `Client2.0` |
| Grossiste | `05 44 21 08 76` | `Seller2.0` |
| Administrateur | `07 17 02 76 77` | `Admin2.0` |

Après le mot de passe, saisissez le code affiché dans l’interface (mode simulation) pour ouvrir la session.

Le compte client de démonstration a déjà une identité vérifiée, ce qui permet de tester immédiatement une commande.

## Codes de vérification

Trois usages sont pris en charge :

1. **Connexion** (`purpose=login`) : le code confirme la connexion après validation du mot de passe.
2. **Mot de passe oublié** (`purpose=password_reset`) : le code autorise le choix d’un nouveau mot de passe.
3. **KYC** (`purpose=kyc`) : le code protège l’envoi des documents d’identité.

Sans fournisseur configuré, le code de test est renvoyé par l’API lorsque `OTP_DEBUG=true`. En production, passez `OTP_DEBUG=false` et renseignez les clés WhatsApp ou SMS.

## Règles métier importantes

### Stock épuisé

Un article est considéré comme indisponible si :

- son stock est inférieur ou égal à zéro ;
- **ou** si le grossiste qui le propose n’a pas de compte propriétaire (`owner_id` absent).

Dans le panier, l’article reste visible avec le motif exact (« Stock épuisé » ou « offre non publiée par un grossiste »), mais il ne peut pas être commandé.

### Commande

- Seul un compte `client` peut commander.
- Le client doit avoir un KYC au statut `verifie`.
- Le serveur recalcule les prix, le total et la livraison, puis vérifie le stock dans une transaction.
- La livraison est de 1 500 FCFA, offerte à partir de 50 000 FCFA.

### Photos produits

Le grossiste peut importer une image ou en prendre une avec la caméra. L’image est redimensionnée dans le navigateur, puis stockée côté serveur dans `server/data/products`. Les photos sont servies par `/api/products/:id/photo`.

## API

Quelques routes principales :

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/api/catalog` | Catalogue public (produits et grossistes) |
| `POST` | `/api/auth/register` | Création de compte |
| `POST` | `/api/auth/login` | Vérification du mot de passe, renvoie un `loginToken` |
| `POST` | `/api/auth/login/verify` | Ouverture de session après code OTP |
| `POST` | `/api/auth/code/request` | Demande d’un code WhatsApp/SMS |
| `POST` | `/api/auth/code/verify` | Vérification du code |
| `POST` | `/api/auth/password/reset` | Nouveau mot de passe après code |
| `GET` | `/api/bootstrap` | Données de l’utilisateur connecté |
| `POST` | `/api/orders` | Création d’une commande |
| `PATCH` | `/api/orders/:id/status` | Mise à jour du statut |
| `POST` | `/api/kyc` | Envoi du dossier KYC |
| `POST` | `/api/products` | Publication d’un produit (grossiste) |
| `PATCH` | `/api/products/:id` | Stock, photo ou disponibilité |
| `GET` | `/api/admin/users` | Liste des comptes (admin) |

La documentation détaillée des routes, des erreurs et du modèle de données se trouve dans [`server/README.md`](server/README.md).

## Tests

Le serveur doit tourner avec `OTP_DEBUG=true`.

```bash
npm run smoke
```

Le script `server/smoke-test.mjs` vérifie notamment :

- l’inscription, la connexion en deux étapes et la réinitialisation du mot de passe ;
- le refus d’une commande sans KYC ;
- l’envoi et la consultation des documents KYC ;
- la publication d’un produit avec photo ;
- le cloisonnement des commandes entre client, grossiste et administrateur.

## Structure du projet

```text
sugu-web/
├── index.html              # Interface
├── style.css               # Styles responsive
├── app.js                  # Logique du navigateur
├── assets/
│   └── icon.png            # Image utilisée par les tests
├── server/
│   ├── index.mjs           # Serveur HTTP + fichiers statiques
│   ├── seed.mjs            # Données de démonstration
│   ├── smoke-test.mjs      # Tests de bout en bout
│   ├── lib/                # Base, sécurité, HTTP, images, modèle
│   ├── routes/             # Auth, OTP, catalogue, commandes, KYC, admin
│   ├── .env.example        # Configuration modèle
│   └── data/               # Base SQLite et fichiers (non versionnés)
├── package.json
└── README.md
```

## Dépôt Git

Le dossier `server/data/` et le fichier `server/.env` ne doivent pas être versionnés : ils contiennent la base locale, les documents KYC et les secrets.

```bash
git init
git add .
git commit -m "SUGU : catalogue, panier, KYC et connexion par code"
git branch -M main
git remote add origin https://github.com/<votre-compte>/sugu-web.git
git push -u origin main
```

## Charte graphique

Orange `#FF6B1A`, jaune `#FFC21A`, rouge `#D9382B`, crème `#FFF7EC`, brun `#2A1A12`. Les icônes Lucide et les photos Unsplash sont chargées depuis Internet ; le fonctionnement hors ligne n’est donc pas garanti pour ces éléments.
