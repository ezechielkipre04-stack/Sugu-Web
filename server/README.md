# SUGU API

Serveur Node.js de SUGU. Il porte désormais **l’authentification, le catalogue, les
commandes, la messagerie, le KYC et les codes de vérification**. L’application Expo ne
contient plus de comptes, de mots de passe ni de commandes en local.

- Node.js **24+** (utilise `node:sqlite`, `process.loadEnvFile`, `fetch`).
- **Aucune dépendance npm** : `node server/index.mjs` suffit.
- Base **SQLite** dans `server/data/sugu.db`, documents KYC dans `server/data/kyc/`.

## Lancer le serveur

```bash
cd sugu-app
copy server\.env.example server\.env
node server/index.mjs
```

Ou depuis la racine du projet :

```bash
npm run server
```

Le serveur écoute par défaut sur `http://localhost:4000`. Vérification :

```bash
curl http://localhost:4000/health
```

Au premier démarrage, la base est créée et remplie avec les données de démonstration
(12 comptes, 6 grossistes, 12 produits, 5 commandes). Pour démarrer sans ces données :

```bash
DEMO_SEED=false
```

## Configurer l’application

Créez `sugu-app/.env` :

```bash
EXPO_PUBLIC_API_URL=http://localhost:4000
```

Sur un téléphone physique, remplacez `localhost` par l’IP locale de la machine qui
exécute le serveur :

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
```

Sur un émulateur Android, `http://10.0.2.2:4000` pointe vers la machine hôte.

## Variables d’environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PORT` | `4000` | Port HTTP |
| `APP_ORIGIN` | `*` | Origines CORS autorisées, séparées par des virgules |
| `TRUST_PROXY` | `false` | Fait confiance à `x-forwarded-for`/`x-forwarded-proto` (reverse proxy) |
| `DEFAULT_COUNTRY_CODE` | `225` | Indicatif ajouté aux numéros locaux |
| `OTP_SECRET` | secret de dev | Signature HMAC des codes, jetons OTP et URLs KYC |
| `OTP_TTL_SECONDS` | `300` | Durée de vie d’un code |
| `OTP_MAX_ATTEMPTS` | `5` | Tentatives autorisées par code |
| `OTP_DEBUG` | `false` | Renvoie `debugCode` et journalise le code (dev uniquement) |
| `SESSION_TTL_DAYS` | `30` | Durée d’une session |
| `DB_PATH` | `server/data/sugu.db` | Chemin SQLite |
| `KYC_DIR` | `server/data/kyc` | Dossier des pièces d’identité |
| `MAX_UPLOAD_BYTES` | `4194304` | Taille maximale d’une image KYC |
| `MAX_JSON_BYTES` | `20000000` | Taille maximale d’un corps JSON |
| `DEMO_SEED` | `true` | Crée les données de démonstration au premier lancement |
| `SMS_PROVIDER` | `twilio` | `twilio` ou `termii` |
| `WHATSAPP_*`, `TWILIO_*`, `TERMII_*` | vides | Clés des fournisseurs d’envoi |

En production : `OTP_DEBUG=false`, `DEMO_SEED=false`, `APP_ORIGIN=https://app.sugu.ci`,
un `OTP_SECRET` long et aléatoire, et un volume persistant pour `DB_PATH` + `KYC_DIR`.

## Fournisseurs WhatsApp et SMS

### WhatsApp Cloud API

1. Créez une application dans **Meta for Developers** et ajoutez le produit
   **WhatsApp**.
2. Associez un numéro WhatsApp Business vérifié.
3. Créez un template d’authentification nommé `sugu_verification` dont le corps
   contient `{{1}}` (le code).
4. Renseignez `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` et
   `WHATSAPP_TEMPLATE_LANG`.

Le serveur envoie le code comme paramètre du corps du template. Le template doit être
approuvé par Meta avant de fonctionner.

### SMS de secours

Twilio :

```bash
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+225...
```

Termii :

```bash
SMS_PROVIDER=termii
TERMII_API_KEY=...
TERMII_SENDER_ID=SUGU
```

Si le canal demandé échoue, le serveur tente l’autre canal. Sans aucune clé, il passe en
**mode simulation** : le code est écrit dans le terminal et, avec `OTP_DEBUG=true`, dans
la réponse `debugCode`. Il n’est jamais affiché dans l’interface.

## API

Toutes les réponses sont en JSON. Les routes protégées attendent
`Authorization: Bearer <token>`. Les erreurs ont la forme
`{ ok: false, error, code }`.

### Santé

```http
GET /health
```

### Authentification

| Méthode | Route | Accès |
| --- | --- | --- |
| `POST` | `/api/auth/register` | public |
| `POST` | `/api/auth/login` | public |
| `POST` | `/api/auth/login/verify` | public, après code OTP |
| `POST` | `/api/auth/demo` | public, si `DEMO_SEED=true` |
| `POST` | `/api/auth/logout` | connecté |
| `GET` | `/api/me` | connecté |
| `POST` | `/api/auth/password/reset` | jeton OTP |
| `POST` | `/api/auth/code/request` | public |
| `POST` | `/api/auth/code/verify` | public |

`POST /api/auth/register` accepte `name`, `phone`, `password`, `role` (`client` ou
`grossiste`) et `city`. Le rôle `admin` ne peut pas être créé par l’API. Un compte
grossiste crée automatiquement sa boutique.

`POST /api/auth/login` accepte `phone` et `password`. Le rôle est toujours celui stocké
en base, jamais celui envoyé par le client. Cette route ne crée pas encore de session :
elle renvoie un `loginToken` signé (10 minutes) une fois le mot de passe validé.

La session n’est ouverte qu’après vérification d’un code `purpose=login` :

```http
POST /api/auth/login/verify

{ "phone": "0717027677", "loginToken": "...", "verificationToken": "..." }
```

Réponse : `{ "token": "...", "user": { ... } }`. Le jeton de session doit ensuite être
envoyé dans l’en-tête `Authorization: Bearer <token>`.

`POST /api/auth/demo` accepte `role` (`client` ou `grossiste`) et ouvre une session sur
le compte de démonstration correspondant, sans exposer de mot de passe dans l’app.

### Vérification par code

```http
POST /api/auth/code/request
Content-Type: application/json

{
  "phone": "0717027677",
  "channel": "whatsapp",
  "purpose": "kyc"
}
```

`purpose` : `kyc`, `password_reset` ou `login`. Réponse :

```json
{ "ok": true, "expiresIn": 300, "channel": "whatsapp", "mock": false }
```

Avec `OTP_DEBUG=true`, la réponse contient aussi `debugCode`.

```http
POST /api/auth/code/verify

{ "phone": "0717027677", "code": "123456", "purpose": "kyc" }
```

Réponse : `{ "ok": true, "verificationToken": "...", "expiresIn": 600 }`.
Ce jeton signé (10 minutes) est obligatoire pour réinitialiser un mot de passe ou
soumettre un dossier KYC.

### Données de l’application

| Méthode | Route | Accès |
| --- | --- | --- |
| `GET` | `/api/bootstrap` | connecté |
| `GET` | `/api/catalog` | public |
| `GET` | `/api/wholesalers/:id` | public |
| `GET` | `/api/products` | connecté |
| `POST` | `/api/products` | grossiste |
| `PATCH` | `/api/products/:id` | propriétaire ou admin |

`/api/bootstrap` renvoie les données visibles selon le rôle :

- **client** : son profil, les produits actifs, tous les grossistes, ses commandes, ses
  messages et son activité ;
- **grossiste** : son profil, ses produits, ses commandes reçues, les messages de sa
  boutique et son activité ;
- **admin** : tous les comptes, tous les produits, toutes les commandes, tous les
  messages et tout le journal d’activité.

### Commandes et messages

| Méthode | Route | Accès |
| --- | --- | --- |
| `GET` | `/api/orders` | connecté |
| `POST` | `/api/orders` | client avec KYC vérifié |
| `PATCH` | `/api/orders/:id/status` | selon le rôle |
| `GET` | `/api/messages` | connecté |
| `POST` | `/api/messages/:threadId` | connecté |

`POST /api/orders` recalcule prix, frais de livraison et total côté serveur, vérifie le
stock, puis le décrémente dans une transaction. Un client ne peut fixer que `livree` ou
`annulee` ; un grossiste gère `confirmee`, `preparation`, `en_route`, `livree`,
`annulee`. Une annulation remet les articles en stock. Une commande clôturée ne peut
plus changer de statut.

`POST /api/messages/:threadId` enregistre le message. Pour un client, le serveur crée
aussi une réponse automatique de la boutique (affichée après 1,7 s côté app).

### Administration

| Méthode | Route | Accès |
| --- | --- | --- |
| `GET` | `/api/admin/users` | admin |
| `GET` | `/api/admin/users/:id` | admin |
| `POST` | `/api/admin/users/:id/kyc` | admin |
| `PATCH` | `/api/admin/users/:id/status` | admin |
| `DELETE` | `/api/admin/users/:id` | admin |
| `GET` | `/api/admin/activity` | admin |

Un compte admin ne peut être ni suspendu ni supprimé par l’API. Une suppression est
logique (`status = supprime`) afin de conserver l’historique d’audit.

### KYC

```http
POST /api/kyc
Authorization: Bearer <token>

{
  "verificationToken": "...",
  "fullName": "Koffi Yao",
  "documentType": "cni",
  "documentNumber": "CI-2025-118420",
  "front": "data:image/jpeg;base64,...",
  "back": "data:image/jpeg;base64,...",
  "selfie": "data:image/jpeg;base64,..."
}
```

Les images sont limitées à 4 Mo, leur type réel est vérifié par signature binaire
(JPEG, PNG, WebP, HEIC), puis écrites dans `KYC_DIR/<userId>/`. Le dossier passe en
`en_attente`; l’admin le valide ou le rejette.

Les URLs renvoyées dans `documentFrontUri`, `documentBackUri` et `selfieUri` sont
**signées et expirent au bout d’une heure** :

```http
GET /api/kyc/:userId/:kind?exp=...&sig=...
```

Aucun header `Authorization` n’est nécessaire pour afficher l’image, mais le lien ne
peut pas être deviné ni réutilisé après expiration.

## Stockage

```
server/data/
  sugu.db        base SQLite (WAL)
  sugu.db-wal
  sugu.db-shm
  kyc/
    <userId>/
      front.jpg
      back.jpg
      selfie.jpg
```

Tables : `users`, `sessions`, `kyc`, `wholesalers`, `products`, `orders`, `order_items`,
`messages`, `activity`, `otp_codes`, `meta`.

`server/data/` et `server/.env` sont ignorés par git.

## Sécurité

- Mots de passe hachés avec **scrypt** et un sel aléatoire par compte ; jamais renvoyés
  par l’API.
- Sessions par jeton aléatoire 256 bits ; seul le **SHA-256** du jeton est stocké.
- OTP hachés en **HMAC-SHA256**, 5 minutes, 5 tentatives, limitation par numéro et IP.
- Jetons de vérification OTP signés en HMAC, valables 10 minutes, liés au numéro et à
  l’usage.
- Rôles et propriété des ressources vérifiés côté serveur à chaque requête.
- URLs des documents KYC signées et temporaires.
- CORS restreint par `APP_ORIGIN` en production.

## Déploiement

Le serveur n’a aucune dépendance npm. Il peut tourner sur Railway, Render, Fly.io, un
VPS ou dans un conteneur (image `node:24-alpine`, requise pour `node:sqlite`).

### Option A — Docker Compose + HTTPS automatique (Caddy)

```bash
cd sugu-app/server
# Dans .env : OTP_SECRET, fournisseurs, puis
#   DOMAIN=api.sugu.ci
#   PUBLIC_ORIGIN=https://app.sugu.ci
docker compose up -d --build
```

Caddy obtient le certificat TLS, redirige le port 80 vers 443 et proxifie vers l’API.
Les données (base SQLite + pièces KYC) vivent dans le volume `sugu-data`.

### Option B — Conteneur seul derrière un TLS existant

```bash
cd sugu-app/server
docker build -t sugu-api .
docker run -d --name sugu-api --env-file .env -p 4000:4000 \
  -v sugu-data:/app/data \
  sugu-api
```

Le conteneur tourne avec l’utilisateur `node` (uid 1000) : si vous montez un dossier de
l’hôte plutôt qu’un volume Docker, donnez-lui cet uid (`chown -R 1000:1000 /srv/sugu`).

Points obligatoires avant d’exposer le service :

1. **HTTPS** devant le serveur (reverse proxy ou plateforme) et
   `EXPO_PUBLIC_API_URL=https://api.sugu.ci` côté app.
2. `APP_ORIGIN` limité aux domaines réels, et `TRUST_PROXY=true` si un reverse proxy
   termine le TLS devant l’API.
3. `OTP_DEBUG=false`, `DEMO_SEED=false`, `OTP_SECRET` long et aléatoire.
4. Volume persistant pour `server/data/` (base + pièces KYC).
5. Sauvegardes régulières de la base et du dossier KYC.
6. Un seul processus Node par base SQLite ; pour plusieurs instances, passer à
   PostgreSQL et à un stockage objet privé (S3/GCS) pour les documents.

## Limites connues

- Paiement Mobile Money **simulé** : aucune transaction réelle.
- Réponse de messagerie **automatique** côté serveur, sans temps réel ni websockets.
- Pas d’OCR, de détection de fraude ni de comparaison faciale automatique sur le KYC.
- Pas de 2FA pour le compte administrateur.
- Pas de notifications push.
- Les documents KYC sont sur disque local : à migrer vers un stockage objet chiffré
  pour une vraie production.
