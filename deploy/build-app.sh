#!/usr/bin/env bash
# Phase H: build the standalone web app and assemble the runtime tree in /out (image build stage
# only; called by deploy/Dockerfile from the repo root).
#   production  the deployable build: E2E wallet and localnet compiled out, the client-secret scan
#               with every marker forbidden (part of the package's build script).
#   e2e         LOCAL fork-E2E build only (the test wallet bridge compiled in, the scan allowing the
#               E2E marker). Produced only by the `runtime-e2e` target, which CI never builds; the
#               image also sets NEXT_PUBLIC_AROMA_E2E_WALLET=true at runtime, so the boot refuses it
#               under production rules.
set -Eeuo pipefail
mode="${1:?usage: build-app.sh production|e2e}"
export AROMA_SKIP_ENV_CHECK=1 AROMA_BUILD_STANDALONE=1 NEXT_PUBLIC_AROMA_LOCALNET=false

case "$mode" in
  production)
    export NEXT_PUBLIC_AROMA_E2E_WALLET=false
    pnpm --filter @aroma/web build
    ;;
  e2e)
    export NEXT_PUBLIC_AROMA_E2E_WALLET=true
    (cd apps/web && npx next build)
    node scripts/check-client-secrets.mjs --next apps/web/.next --allow-e2e
    ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac

sa=apps/web/.next/standalone
test -f "$sa/apps/web/server.js" || { echo "standalone server.js missing" >&2; exit 1; }
test -f "$sa/apps/web/.next/server/middleware.js" || { echo "Node middleware missing from the trace" >&2; exit 1; }
node -e "const p=require('node:path'),fs=require('node:fs');const n=fs.realpathSync(p.resolve('$sa/apps/web/node_modules/next'));require(require.resolve('sharp',{paths:[n]}))" \
  || { echo "sharp is not loadable from the traced output" >&2; exit 1; }

mkdir -p /out/apps/web/.next /out/deploy
cp -a "$sa/." /out/
cp -a apps/web/.next/static /out/apps/web/.next/static
cp -a apps/web/public /out/apps/web/public
cp deploy/server.mjs deploy/graceful.mjs deploy/healthcheck.mjs deploy/public-env.mjs /out/deploy/
# The NEXT_PUBLIC_* values this bundle was built with; the entry point applies them at runtime.
node --input-type=module -e "import { publicEnvOf } from './deploy/public-env.mjs'; process.stdout.write(JSON.stringify(publicEnvOf(process.env), null, 2))" > /out/deploy/public-env.json
node deploy/build-migrate.mjs /out/deploy
mkdir -p /out/apps/web/.next/cache
# The E2E variant carries a marker the entry point checks before anything else (deploy/server.mjs).
if [ "$mode" = e2e ]; then echo "fork-E2E build: never deploy" > /out/deploy/E2E_BUILD; fi
# No env file ever reaches the image (the .dockerignore already keeps them out of the context).
find /out -name '.env*' -print -delete
echo "assembled /out ($mode)"
