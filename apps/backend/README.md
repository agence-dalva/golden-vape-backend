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

---

## Nettoyer les options/inventaire fantômes après une migration produit

Quand des produits sont importés sans option explicite (ex: import PrestaShop brut), Medusa
crée automatiquement pour chacun une option `Titre` avec une seule valeur `Default`, une
variante `Default` correspondante, et parfois un `inventory_item` associé sans stock réel.
Sur un gros catalogue ça pollue rapidement l'admin (des milliers d'options "Titre"/"Size"/
"Color" inutiles dans **Réglages → Options de produit**).

Objectif : détacher ces options fantômes de leurs produits, supprimer les variantes `Default`
devenues orphelines, et vider l'inventaire qui ne reflète aucun vrai stock — **sans toucher
aux fiches produit elles-mêmes** (titre, prix, images, description, catégories restent
intacts), et **sans toucher aux options qui contiennent de vraies données** (ex: une option
`Dosage` ou `Déclinaison` avec de vraies valeurs de contenance/couleur/dosage).

### Avant de commencer

1. **Faire un backup / snapshot de la base** (obligatoire, opération destructive) :
   ```bash
   pg_dump "$DATABASE_URL" \
     -t product -t product_variant -t product_option -t product_option_value \
     -t product_variant_option -t inventory_item -t inventory_level \
     -t product_variant_inventory_item \
     --data-only --column-inserts > backup_pre_cleanup_$(date +%Y%m%d_%H%M%S).sql
   ```
   Sur Neon, un snapshot de branche suffit aussi.

2. **Identifier le périmètre réel avant de généraliser.** Ne jamais supposer que "Titre/Size/
   Color" sont les seuls noms concernés — lister les options par titre et leur nombre de
   valeurs/produits, et vérifier au cas par cas lesquelles sont de vrais résidus vs de
   vraies données à garder :
   ```sql
   SELECT po.title, count(*) FROM product_option po
   WHERE po.deleted_at IS NULL GROUP BY po.title ORDER BY count(*) DESC;

   -- Pour une option donnée, voir concrètement quels produits/variantes l'utilisent
   -- avant de décider de la garder ou la supprimer :
   SELECT p.title, p.status, pov.value
   FROM product_variant_option pvo
   JOIN product_option_value pov ON pov.id = pvo.option_value_id
   JOIN product_option po ON po.id = pov.option_id
   JOIN product_variant pv ON pv.id = pvo.variant_id
   JOIN product p ON p.id = pv.product_id
   WHERE po.title = '<titre à vérifier>'
   ORDER BY p.title;
   ```

### Étape 1 — Détacher les options fantômes de leurs produits

Adapter la liste `title NOT IN (...)` aux options à **garder** (celles qui contiennent de
vraies données, identifiées à l'étape précédente) :

```sql
DELETE FROM product_product_option ppo
USING product_option po
WHERE po.id = ppo.product_option_id
  AND po.deleted_at IS NULL
  AND po.title NOT IN ('Dosage', 'Déclinaison'); -- options à garder
```

Ceci ne fait que retirer le lien produit↔option ; ni le produit ni l'option elle-même ne
sont supprimés à ce stade.

### Étape 2 — Supprimer les variantes devenues orphelines

Une variante devient orpheline quand son produit n'a plus aucune option active après
l'étape 1 (typiquement la variante `Default`) :

```sql
UPDATE product_variant pv
SET deleted_at = now()
WHERE pv.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM product_product_option ppo WHERE ppo.product_id = pv.product_id
  );

-- Nettoyer les liens variante↔valeur d'option des variantes qu'on vient de supprimer
DELETE FROM product_variant_option pvo
USING product_variant pv
WHERE pv.id = pvo.variant_id AND pv.deleted_at IS NOT NULL;
```

### Étape 3 — Purger définitivement les options détachées

L'étape 1 ne fait que détacher — les lignes `product_option` restent en base tant qu'on ne
les soft-delete pas explicitement :

```sql
UPDATE product_option
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND title NOT IN ('Dosage', 'Déclinaison'); -- même liste qu'à l'étape 1

UPDATE product_option_value pov
SET deleted_at = now()
FROM product_option po
WHERE po.id = pov.option_id AND po.deleted_at IS NOT NULL AND pov.deleted_at IS NULL;
```

### Étape 4 — Vider l'inventaire (si le stock affiché ne reflète rien de réel)

```sql
UPDATE product_variant_inventory_item SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE inventory_level SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE inventory_item SET deleted_at = now() WHERE deleted_at IS NULL;
```

### Vérification finale

```sql
SELECT 'options actives' AS label, count(*) FROM product_option WHERE deleted_at IS NULL
UNION ALL SELECT 'variantes actives', count(*) FROM product_variant WHERE deleted_at IS NULL
UNION ALL SELECT 'inventory items actifs', count(*) FROM inventory_item WHERE deleted_at IS NULL;

SELECT title, count(*) FROM product_option WHERE deleted_at IS NULL GROUP BY title;
```

Seules les options qu'on a explicitement gardées doivent apparaître dans le dernier résultat.

### Pourquoi du SQL brut plutôt que les workflows Medusa

Les workflows officiels (`updateProductsWorkflow` avec `options: []`, `deleteProductOptionsWorkflow`,
`deleteProductVariantsWorkflow`, `deleteInventoryItemWorkflow`) sont l'approche recommandée
quand on a accès à `medusa exec` (voir historique du repo pour un exemple de script en 3
étapes suivant ce pattern). Le SQL ci-dessus est l'équivalent direct pour un contexte où on
veut exécuter la purge directement contre la base (ex: Neon) sans repasser par un script
Node. Dans les deux cas : toujours tester le périmètre exact sur une copie/un environnement
de dev avant de reproduire sur une base de production.
