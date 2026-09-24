#!/usr/bin/env bash
# reproduce.sh — full MALEFLYMAIL chain: reports → fit → build → screenshots
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

source ~/.nvm/nvm.sh
nvm use 24

echo "== typecheck + build =="
npx tsc --noEmit
npm run build

echo "== start preview =="
lsof -ti:5176 | xargs kill -9 2>/dev/null || true
npm run preview -- --host 127.0.0.1 --port 5176 > /tmp/maleflymail-preview.log 2>&1 &
echo $! > /tmp/maleflymail-preview.pid
sleep 2

echo "== collect WebGPU reports (120 emails, ~4 min, headed Chrome) =="
MALEFLYMAIL_URL=http://127.0.0.1:5176 MALEFLYMAIL_HEADED=1 node tools/run_reports.mjs

echo "== fit logistic readout =="
../train-your-fly/.venv/bin/python tools/fit_readout.py

echo "== rebuild with trained readout =="
npm run build
# restart preview with new dist
kill "$(cat /tmp/maleflymail-preview.pid)" 2>/dev/null || true
lsof -ti:5176 | xargs kill -9 2>/dev/null || true
npm run preview -- --host 127.0.0.1 --port 5176 > /tmp/maleflymail-preview.log 2>&1 &
echo $! > /tmp/maleflymail-preview.pid
sleep 2
cp NOTICE.md public/NOTICE.md 2>/dev/null || true
cp results.md public/results.md 2>/dev/null || true

echo "== screenshots =="
MALEFLYMAIL_URL=http://127.0.0.1:5176 node scripts/shoot.mjs

echo "== done =="
echo "readout holdout accuracy: $(node -e "console.log((require('./public/readout.json').accuracy*100).toFixed(1)+'%')")"
echo "media/:"; ls -lh media/
