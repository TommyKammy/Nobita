#!/usr/bin/env bash
set -euo pipefail

pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
pnpm size --strict

if [[ "${BENCH:-0}" == "1" ]]; then
  pnpm bench --strict
fi
