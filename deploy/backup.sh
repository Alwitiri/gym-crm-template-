#!/usr/bin/env bash
# Nightly database backup (runs inside the "backup" container).
# Writes deploy/backups/gymcrm-YYYY-MM-DD.dump at BACKUP_HOUR (IST) and keeps BACKUP_KEEP_DAYS days.
# Copy that folder off the server too (see DEPLOY.md, "Off-site copy").
set -uo pipefail
mkdir -p /backups
backup() {
  local f="/backups/gymcrm-$(date +%F).dump"
  if pg_dump --format=custom --compress=6 --file="$f.part" && pg_restore --list "$f.part" > /dev/null; then
    mv "$f.part" "$f"
    echo "$(date '+%F %T') backup ok: $f ($(du -h "$f" | cut -f1))"
    find /backups -name 'gymcrm-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-30}" -delete
  else
    rm -f "$f.part"
    echo "$(date '+%F %T') BACKUP FAILED" >&2
  fi
}
[ "${1:-}" = "now" ] && { backup; exit; }
echo "Backups at ${BACKUP_HOUR:-02}:00 every day, keeping ${BACKUP_KEEP_DAYS:-30} days"
last=""
while true; do
  today=$(date +%F)
  if [ "$(date +%H)" = "${BACKUP_HOUR:-02}" ] && [ "$last" != "$today" ]; then backup; last=$today; fi
  sleep 300
done
