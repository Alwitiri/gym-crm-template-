#!/usr/bin/env bash
# Restore a backup over the live database. Stops the API while it runs.
#   ./deploy/restore.sh deploy/backups/gymcrm-2026-11-07.dump
set -euo pipefail
f="${1:?Give the backup file, e.g. deploy/backups/gymcrm-2026-11-07.dump}"
[ -f "$f" ] || { echo "No such file: $f"; exit 1; }
C="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"
read -r -p "This REPLACES all current data with $f. Type RESTORE to continue: " ok
[ "$ok" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
$C exec -T backup bash /backup.sh now   # safety copy of the current data first
$C stop api
$C exec -T db psql -U gym_owner -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='gymcrm' AND pid <> pg_backend_pid();" > /dev/null
$C exec -T db dropdb -U gym_owner gymcrm
$C exec -T db createdb -U gym_owner gymcrm
$C exec -T db pg_restore -U gym_owner -d gymcrm --no-owner --role=gym_owner < "$f"
$C --profile setup run --rm setup sh -c "npx tsx prisma/setup-production.ts"   # re-grants the app login
$C start api
echo "Restored from $f"
