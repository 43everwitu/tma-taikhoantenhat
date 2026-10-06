#!/bin/bash
# Backup data/shop.db to Google Drive daily.
# Local keeps at most 5 backups, Drive keeps at most 7 (count-based rotation, oldest deleted first).
set -euo pipefail

PROJECT_DIR="/home/peanut/tma-taikhoantenhat"
DB_FILE="${PROJECT_DIR}/data/shop.db"
BACKUP_DIR="${PROJECT_DIR}/data"
GDRIVE_REMOTE="gdrive:tma_taikhoantenhat_backups"
LOG_FILE="${PROJECT_DIR}/logs/backup_gdrive.log"
LOCAL_KEEP=5
DRIVE_KEEP=7

mkdir -p "$(dirname "$LOG_FILE")"
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG_FILE"; }

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILENAME="shop.db.bak-${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_FILENAME}"

log "=== Start backup ==="

log "Creating SQLite safe snapshot -> ${BACKUP_FILENAME}"
sqlite3 "$DB_FILE" ".backup '${BACKUP_PATH}'"

log "Uploading to ${GDRIVE_REMOTE}"
if rclone copy "$BACKUP_PATH" "$GDRIVE_REMOTE" --log-file="$LOG_FILE" --log-level INFO; then
  log "Upload successful"
else
  log "ERROR: upload to Google Drive failed"
  exit 1
fi

log "Pruning local backups, keeping ${LOCAL_KEEP} newest"
cd "$BACKUP_DIR"
ls -t shop.db.bak-* 2>/dev/null | tail -n +$((LOCAL_KEEP + 1)) | while read -r old_file; do
  log "Deleting old local backup: ${old_file}"
  rm -f -- "$old_file"
done

log "Pruning Drive backups, keeping ${DRIVE_KEEP} newest"
rclone lsf "$GDRIVE_REMOTE" --files-only | sort -r | tail -n +$((DRIVE_KEEP + 1)) | while read -r old_file; do
  log "Deleting old Drive backup: ${old_file}"
  rclone delete "${GDRIVE_REMOTE}/${old_file}"
done

log "=== Backup done: ${BACKUP_FILENAME} ==="
