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

DESTINO="${DESTINO:-./backups}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"
SERVICO="${SERVICO:-postgres}"
COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml}"

mkdir -p "$DESTINO"
CARIMBO="$(date -u +%Y%m%dT%H%M%SZ)"
ARQUIVO="$DESTINO/draconya-$CARIMBO.sql.gz"

echo "backup: gerando $ARQUIVO"
$COMPOSE exec -T "$SERVICO" pg_dump -U draconya --format=plain --no-owner draconya \
  | gzip -9 > "$ARQUIVO"

# Dump vazio ou truncado é pior que backup nenhum, porque passa despercebido.
TAMANHO=$(wc -c < "$ARQUIVO")
if [ "$TAMANHO" -lt 1024 ]; then
  echo "backup: FALHOU — arquivo com $TAMANHO bytes, pequeno demais para ser real" >&2
  rm -f "$ARQUIVO"
  exit 1
fi
echo "backup: ok, $TAMANHO bytes"

if [ -n "${R2_BUCKET:-}" ]; then
  echo "backup: enviando para o R2"
  # Precisa de rclone configurado com um remote chamado `r2`.
  rclone copy "$ARQUIVO" "r2:$R2_BUCKET/postgres/"
fi

echo "backup: removendo locais com mais de $RETENCAO_DIAS dias"
find "$DESTINO" -name 'draconya-*.sql.gz' -mtime "+$RETENCAO_DIAS" -delete

# LEMBRETE: backup que nunca foi restaurado não é backup, é esperança.
# Teste a restauração pelo menos uma vez, e de novo quando o schema mudar de forma:
#   gunzip -c backups/draconya-XXX.sql.gz | docker compose exec -T postgres psql -U draconya -d draconya_teste
