#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npx wrangler deploy
npx wrangler d1 execute capi_db --remote --command "INSERT OR REPLACE INTO system_settings (key, value, type, description, updated_at) VALUES ('uptime_started_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'string', 'Service uptime start timestamp', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));"
./scripts/restart-bot.sh