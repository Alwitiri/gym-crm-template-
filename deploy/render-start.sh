#!/usr/bin/env bash
# Start command for a single Render web service: API on an internal port, website on $PORT.
#   Build command: npm install && npm run build
#   Start command: npm start
# Env: DATABASE_URL (required), SESSION_SECRET (32+ chars), optional GYM_DB_NAME, SEED_DEMO=1.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

export DATABASE_URL="$(node deploy/render-db.mjs)"
export MIGRATE_DATABASE_URL="$DATABASE_URL"
export PUBLIC_APP_URL="${PUBLIC_APP_URL:-${RENDER_EXTERNAL_URL:-http://localhost:3000}}"
export WEB_ORIGIN="${WEB_ORIGIN:-$PUBLIC_APP_URL}"

cd "$ROOT/apps/api"
echo "Applying database migrations..."
npx prisma migrate deploy

if [ "${SEED_DEMO:-0}" = "1" ]; then
  echo "Loading demo data (skipped if already there)..."
  case "$DATABASE_URL" in *\?*) SEP='&' ;; *) SEP='?' ;; esac
  # Demo seeding writes across all branches, so it opens the row-level security gate for its own connection only.
  DATABASE_URL="${DATABASE_URL}${SEP}options=-c%20app.branch_ids%3D*" npx tsx prisma/seed.ts
fi

WEB_PORT="${PORT:-3000}"
echo "Starting API on internal port 4000..."
PORT=4000 node dist/main.js &
API_PID=$!

for i in $(seq 1 60); do
  if node -e "fetch('http://127.0.0.1:4000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then break; fi
  if ! kill -0 "$API_PID" 2>/dev/null; then echo "API failed to start"; exit 1; fi
  sleep 1
done

echo "Starting website on port $WEB_PORT..."
cd "$ROOT/apps/web"
npx next start -p "$WEB_PORT" &
WEB_PID=$!

# If either process stops, stop the service so Render restarts it.
wait -n "$API_PID" "$WEB_PID"
exit 1
