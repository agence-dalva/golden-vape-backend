# Sauvegarde quotidienne de la base

Chaque nuit, un service Railway exporte la base Postgres de production, vérifie que l'export
se relit, l'envoie dans un bucket R2 **privé**, et ne garde que les 30 derniers.

L'offre Hobby de Railway n'a pas d'onglet Backups : ce service est le seul filet de la base.

## Pourquoi un bucket à part

Le bucket des images (`golden-vape-media`) est public : le site y lit les visuels. Une
sauvegarde contient les clients, leurs adresses et leurs commandes ; posée là, elle serait
téléchargeable par quiconque devine son nom. Les sauvegardes vont donc dans un bucket privé,
sous le dossier `database/`, avec une clé d'API qui n'ouvre que ce bucket.

## Mise en place

### Cloudflare R2

1. R2 → **Create bucket** → `golden-vape-backups`. Ne pas activer l'accès public.
2. R2 → **Manage API tokens** → **Create API token** :
   - permission **Object Read & Write** ;
   - **Apply to specific buckets only** → `golden-vape-backups`.
3. Noter l'Access Key ID et le Secret Access Key (le secret ne s'affiche qu'une fois).

### Railway

1. **+ New → GitHub Repo** → `golden-vape-backend`.
2. Settings du nouveau service :
   - **Root Directory** : `/ops/backup` (le Dockerfile est détecté) ;
   - **Watch Paths** : `/ops/backup/**` (il ne se reconstruit pas à chaque modification du backend) ;
   - **Cron Schedule** : `0 2 * * *` (2 h UTC, soit 3 h ou 4 h à Paris) ;
   - **Restart Policy** : Never (un échec reste visible au lieu d'être relancé en boucle).
3. Variables :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (référence, réseau privé) |
   | `R2_ACCOUNT_ID` | identifiant du compte Cloudflare (le même que le backend) |
   | `R2_BACKUP_ACCESS_KEY_ID` | clé du jeton créé plus haut |
   | `R2_BACKUP_SECRET_ACCESS_KEY` | secret du jeton créé plus haut |
   | `R2_BACKUP_BUCKET` | `golden-vape-backups` |
   | `BACKUP_RETENTION` | facultatif, 30 par défaut |

4. Lancer une première exécution à la main (Deploy) et lire les logs : `Sauvegarde terminée.`
   puis vérifier le fichier dans R2 → `golden-vape-backups/database/`.

Un échec (base injoignable, export suspect, envoi refusé) fait sortir le script en erreur :
l'exécution apparaît en rouge dans l'historique du service. Rien n'est supprimé tant qu'une
nouvelle sauvegarde n'a pas été envoyée avec succès.

## Restaurer

1. Télécharger le fichier voulu depuis R2 → `golden-vape-backups/database/`.
2. Le restaurer **dans une base neuve et vide**, jamais par-dessus la production :

   ```sh
   pg_restore --no-owner --no-privileges -d "postgres://…/base_vide" golden-vape_AAAAMMJJ_HHMMSS.dump
   ```

   Utiliser `pg_restore` 18 (`/opt/homebrew/opt/libpq/bin/pg_restore` sur le Mac).
3. Vérifier les comptes (produits, commandes, clients), puis pointer `DATABASE_URL` du backend
   sur cette base et redéployer.

## Tester en local

```sh
docker build -t gv-backup ops/backup
docker run --rm \
  -e DATABASE_URL=postgres://davidplanchon@host.docker.internal:5432/golden_vape \
  -e R2_ACCOUNT_ID=x -e R2_BACKUP_ACCESS_KEY_ID=x -e R2_BACKUP_SECRET_ACCESS_KEY=x \
  -e R2_BACKUP_BUCKET=gv-backups-test -e S3_ENDPOINT=http://host.docker.internal:19090 \
  gv-backup
```

`S3_ENDPOINT` remplace R2 par un faux S3 local, par exemple `adobe/s3mock` sur le port 19090.
