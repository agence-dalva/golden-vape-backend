# Golden Vape — Backend Medusa v2

## Stack

- **Medusa 2.17** — headless e-commerce
- **PostgreSQL** — Neon en prod, local en dev
- **Redis** — requis en prod (events, cache, workflows)
- **Cloudflare R2** — stockage des médias produits
- **Railway** — hébergement du backend + Redis

---

## Développement local

### Prérequis

- Node 20+
- Yarn 1.22+
- PostgreSQL local (`postgres://davidplanchon@localhost:5432/golden_vape`)

### Installation

```bash
# Depuis la racine /backend
yarn install

# Copier et remplir les variables d'env
cp apps/backend/.env.example apps/backend/.env

# Lancer les migrations
cd apps/backend
../../node_modules/.bin/medusa db:migrate

# Démarrer en dev
cd ../..
yarn backend:dev
```

### Scripts d'import (à lancer une seule fois)

```bash
cd apps/backend

# 1. Importer les catégories PrestaShop
../../node_modules/.bin/medusa exec src/scripts/import-categories.ts

# 2. Importer les produits PrestaShop
../../node_modules/.bin/medusa exec src/scripts/import-products.ts

# 3. Uploader les images sur R2 et les lier aux produits
../../node_modules/.bin/medusa exec src/scripts/upload-images.ts
```

---

## Déploiement Railway

### 1. Créer les services sur Railway

Dans ton projet Railway, créer **3 services** :

| Service | Type |
|---------|------|
| `backend` | GitHub repo → Dockerfile |
| `postgres` | Plugin PostgreSQL |
| `redis` | Plugin Redis |

### 2. Connecter le repo GitHub

- Service `backend` → Settings → Source → GitHub repo `golden-vape-backend`
- Root Directory : `/` (racine du repo)
- Dockerfile Path : `apps/backend/Dockerfile`

> Railway build depuis la racine du repo, le Dockerfile COPY depuis `apps/backend/`.

### 3. Variables d'environnement sur Railway

Dans le service `backend` → Variables, ajouter :

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

JWT_SECRET=<openssl rand -hex 32>
COOKIE_SECRET=<openssl rand -hex 32>

STORE_CORS=https://golden-vape.fr
ADMIN_CORS=https://admin.golden-vape.fr
AUTH_CORS=https://admin.golden-vape.fr
MEDUSA_BACKEND_URL=https://<ton-domaine-railway>.up.railway.app

R2_ACCOUNT_ID=<voir .env local>
R2_ACCESS_KEY_ID=<voir .env local>
R2_SECRET_ACCESS_KEY=<voir .env local>
R2_BUCKET=golden-vape-media
R2_PUBLIC_URL=<voir .env local>
```

> `${{Postgres.DATABASE_URL}}` et `${{Redis.REDIS_URL}}` sont des références Railway qui se résolvent automatiquement depuis les plugins.

### 4. Générer de vrais secrets

```bash
openssl rand -hex 32   # pour JWT_SECRET
openssl rand -hex 32   # pour COOKIE_SECRET
```

Ne jamais utiliser `supersecret` en production.

### 5. Premier déploiement

Railway déclenche automatiquement un build dès que tu pushs sur `main`.

Au démarrage du conteneur :
```
medusa db:migrate && medusa start
```

Les migrations tournent à chaque déploiement — safe car Medusa ne ré-applique pas les migrations déjà exécutées.

### 6. Vérifier que ça marche

```bash
curl https://<ton-domaine>.up.railway.app/health
# → { "status": "ok" }
```

---

## Variables d'environnement — référence complète

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | URL PostgreSQL (`?sslmode=require` pour Neon) |
| `REDIS_URL` | URL Redis |
| `JWT_SECRET` | Secret JWT — `openssl rand -hex 32` |
| `COOKIE_SECRET` | Secret cookie — `openssl rand -hex 32` |
| `STORE_CORS` | Origines autorisées storefront |
| `ADMIN_CORS` | Origines autorisées admin |
| `AUTH_CORS` | Origines autorisées auth |
| `MEDUSA_BACKEND_URL` | URL publique du backend |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 Secret Key |
| `R2_BUCKET` | Nom du bucket R2 |
| `R2_PUBLIC_URL` | URL publique R2 |

---

## Module custom — Caractéristiques produit

Un module `productAttribute` permet d'ajouter des caractéristiques structurées aux produits (Taux de nicotine, Contenance, PG/VG...).

- Gérer les types : admin → **Caractéristiques** (sidebar)
- Ajouter des valeurs : widget sur chaque fiche produit
- API store : `GET /store/products/:id/attributes`
