#!/bin/sh
# Sauvegarde de la base Postgres de production vers un bucket R2 privé.
#
# Lancé chaque nuit par Railway (service « cron », voir README.md). Le conteneur exporte la
# base, vérifie que l'export se relit, l'envoie dans R2, puis ne garde que les N derniers.
# Toute erreur fait échouer l'exécution : Railway la marque en rouge dans l'historique.
set -eu

: "${DATABASE_URL:?DATABASE_URL manquante}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID manquante}"
: "${R2_BACKUP_ACCESS_KEY_ID:?R2_BACKUP_ACCESS_KEY_ID manquante}"
: "${R2_BACKUP_SECRET_ACCESS_KEY:?R2_BACKUP_SECRET_ACCESS_KEY manquante}"
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET manquante}"

PREFIXE="${BACKUP_PREFIX:-database}"
RETENTION="${BACKUP_RETENTION:-30}"
# Surchargeable pour tester en local contre un faux S3 (MinIO).
ENDPOINT="${S3_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

export AWS_ACCESS_KEY_ID="$R2_BACKUP_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_BACKUP_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION=auto
# R2 n'accepte pas toutes les sommes de contrôle que l'AWS CLI v2 ajoute par défaut.
export AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED
export AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED

s3() { aws --endpoint-url "$ENDPOINT" s3 "$@"; }

NOM="golden-vape_$(date -u +%Y%m%d_%H%M%S).dump"
FICHIER="/tmp/$NOM"

# Le réseau privé de Railway peut mettre quelques secondes à répondre au démarrage du conteneur.
essai=0
until pg_isready -d "$DATABASE_URL" -q; do
  essai=$((essai + 1))
  if [ "$essai" -ge 30 ]; then
    echo "La base ne répond pas après 60 s." >&2
    exit 1
  fi
  sleep 2
done

echo "Export de la base…"
pg_dump "$DATABASE_URL" -Fc --no-owner --no-privileges -f "$FICHIER"

# Un export qui ne se relit pas, ou presque vide, ne remplace jamais les bons.
TABLES=$(pg_restore -l "$FICHIER" | grep -c "TABLE DATA" || true)
if [ "$TABLES" -lt 50 ]; then
  echo "Export suspect : $TABLES tables seulement. Rien n'est envoyé ni supprimé." >&2
  exit 1
fi
TAILLE=$(du -h "$FICHIER" | cut -f1)
echo "Export relu : $TABLES tables, $TAILLE."

s3 cp "$FICHIER" "s3://$R2_BACKUP_BUCKET/$PREFIXE/$NOM" --only-show-errors
echo "Envoyé : s3://$R2_BACKUP_BUCKET/$PREFIXE/$NOM"

# Rétention : les N plus récents restent. Le tri par nom vaut un tri par date (horodatage UTC).
s3 ls "s3://$R2_BACKUP_BUCKET/$PREFIXE/" \
  | awk '{print $4}' \
  | grep '^golden-vape_.*\.dump$' \
  | sort -r \
  | tail -n +"$((RETENTION + 1))" \
  | while read -r ancien; do
      s3 rm "s3://$R2_BACKUP_BUCKET/$PREFIXE/$ancien" --only-show-errors
      echo "Supprimé (au-delà de $RETENTION) : $ancien"
    done

rm -f "$FICHIER"
echo "Sauvegarde terminée."
