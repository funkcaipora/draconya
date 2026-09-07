#!/usr/bin/env bash
# Backup do Postgres. Assumir a VPS é assumir backup — `account` e `ledger` são o que
# não dá para reconstruir, ainda mais com venda de personagem entre contas prevista (§35).
#
# Uso:
#   ./scripts/backup-postgres.sh                    # local, em ./backups
#   R2_BUCKET=draconya-backups ./scripts/backup-postgres.sh   # envia também para o R2
#
# No cron da VPS:
#   0 4 * * * cd /srv/draconya && ./scripts/backup-postgres.sh >> /var/log/draconya-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SERVICE="${SERVICE:-postgres}"
COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="$BACKUP_DIR/draconya-$TIMESTAMP.sql.gz"

echo "backup: creating $BACKUP_FILE"
$COMPOSE exec -T "$SERVICE" pg_dump -U draconya --format=plain --no-owner draconya \
  | gzip -9 > "$BACKUP_FILE"

# Dump vazio ou truncado é pior que backup nenhum, porque passa despercebido.
SIZE=$(wc -c < "$BACKUP_FILE")
if [ "$SIZE" -lt 1024 ]; then
  echo "backup: FAILED — file has $SIZE bytes, too small to be a valid dump" >&2
  rm -f "$BACKUP_FILE"
  exit 1
fi
echo "backup: ok, $SIZE bytes"

if [ -n "${R2_BUCKET:-}" ]; then
  echo "backup: uploading to R2"
  # Precisa de rclone configurado com um remote chamado `r2`.
  rclone copy "$BACKUP_FILE" "r2:$R2_BUCKET/postgres/"
fi

echo "backup: removing local files older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'draconya-*.sql.gz' -mtime "+$RETENTION_DAYS" -delete

# LEMBRETE: backup que nunca foi restaurado não é backup, é esperança.
# Teste a restauração pelo menos uma vez, e de novo quando o schema mudar de forma:
#   gunzip -c backups/draconya-XXX.sql.gz | docker compose exec -T postgres psql -U draconya -d draconya_teste
