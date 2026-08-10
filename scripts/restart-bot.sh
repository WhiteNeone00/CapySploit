#!/usr/bin/env bash
# Simple bot restart helper for CAPI.
# This kills any existing bot process and starts a fresh one in the background.

cd "$(dirname "$0")/.." || exit 1

# Find existing bot process by script path.
pids=$(pgrep -af "node src/discord-bot.js" | awk '{print $1}')
if [ -n "$pids" ]; then
  echo "Stopping existing CAPI bot process(es): $pids"
  kill $pids || true
  sleep 1
fi

# Start bot in background and redirect logs.
nohup npm run bot > /tmp/capi-discord-bot.log 2>&1 &
printf "Started CAPI bot with PID %s\n" "$!"
printf "Logs: /tmp/capi-discord-bot.log\n"
