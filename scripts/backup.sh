#!/usr/bin/env bash
# Backup do OCP Suporte em PRODUÇÃO: banco (mysqldump), anexos, secrets e .env,
# criptografado com gpg (AES-256). Nunca grava nada em texto puro no disco.
# Senha: a mesma do backup do Hermes (~/hermes/secrets/backup_passphrase), que já está guardada pelo usuário.
# Uso: bash scripts/backup.sh     (cron diário às 03:45)
set -euo pipefail
cd "$(dirname "$0")/.."
SENHA="${BACKUP_SENHA_ARQUIVO:-$HOME/hermes/secrets/backup_passphrase}"
DESTINO_DIR="${BACKUP_DIR:-$PWD/backups}"
MANTER=30
[ -s "$SENHA" ] || { echo "Faltando $SENHA: sem ela não dá para criptografar o backup." >&2; exit 1; }
set -a; source .env; set +a
umask 077
mkdir -p "$DESTINO_DIR" data/anexos
TS="$(date +%Y%m%d-%H%M%S)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
destino="$DESTINO_DIR/ocpsuporte-$TS.tar.gpg"

# O dump vai direto para o gpg; o tar junta dump criptografado + arquivos, e o conjunto é criptografado de novo.
docker exec -e MYSQL_PWD="$DB_PASSWORD" ocpsuporte-mysql \
  mysqldump --single-transaction --no-tablespaces --routines -u"$DB_USER" "$DB_NAME" \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$SENHA" --symmetric --cipher-algo AES256 -o "$TMP/banco.sql.gpg"
tar -c -C "$PWD" data/anexos secrets .env -C "$TMP" banco.sql.gpg \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-file "$SENHA" --symmetric --cipher-algo AES256 -o "$destino"

ls -1t "$DESTINO_DIR"/ocpsuporte-*.tar.gpg 2>/dev/null | tail -n +$((MANTER + 1)) | xargs -r rm --
echo "$(date '+%F %T') Backup criado: $destino ($(du -h "$destino" | cut -f1))"
