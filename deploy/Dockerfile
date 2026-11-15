# syntax=docker/dockerfile:1.7
#
# Phase H Step 3: the Aroma web image for self-host (Hostinger VPS behind Cloudflare).
# Build from the repo root:  docker build -f deploy/Dockerfile .
#
# - Base: the official node:24.12.0-slim (Debian bookworm, glibc), pinned by index digest so
#   amd64 and arm64 resolve to the same release. Slim over alpine: sharp's and Next's prebuilt
#   binaries target glibc first, and musl differences are a class of prod-only bugs we avoid.
# - Build inputs: ONLY NEXT_PUBLIC_* build args (public by definition, inlined into the browser
#   bundle) and AROMA_SKIP_ENV_CHECK=1 for the build stage. No secret is a build arg, an ENV or a
#   layer; the runtime refuses to boot without a valid env (server/platform.ts, env.schema.ts).
# - Runtime: Next's traced standalone server (no dev dependencies, no package manager), non-root
#   UID 10001, read-only root filesystem friendly (writes only to /tmp and .next/cache).

ARG NODE_IMAGE=node:24.12.0-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99

# ---------- build ----------
FROM ${NODE_IMAGE} AS build
ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /repo

# Dependencies first (cached unless a manifest or the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .nvmrc turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/keeper/package.json apps/keeper/
COPY packages/ui/package.json packages/ui/
COPY packages/guard/package.json packages/guard/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@aroma/web..."

COPY . .

# Public, build-time values only (repository VARIABLES in CI, never secrets).
ARG NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
ARG NEXT_PUBLIC_SOLANA_WS_URL=
ARG NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL=
ARG NEXT_PUBLIC_SENTRY_DSN=
ARG NEXT_PUBLIC_PLAUSIBLE_DOMAIN=
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
# The E2E wallet bridge and the localnet cluster are compiled OUT of every image.
ENV NEXT_PUBLIC_AROMA_E2E_WALLET=false \
    NEXT_PUBLIC_AROMA_LOCALNET=false \
    NEXT_PUBLIC_SOLANA_RPC_URL=${NEXT_PUBLIC_SOLANA_RPC_URL} \
    NEXT_PUBLIC_SOLANA_WS_URL=${NEXT_PUBLIC_SOLANA_WS_URL} \
    NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL=${NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN=${NEXT_PUBLIC_PLAUSIBLE_DOMAIN} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

# The build stage alone skips the env check (no runtime secret exists here); standalone output.
# The client-secret scan still runs (part of the build script).
RUN AROMA_SKIP_ENV_CHECK=1 AROMA_BUILD_STANDALONE=1 pnpm --filter @aroma/web build \
 && test -f apps/web/.next/standalone/apps/web/server.js \
 && test -f apps/web/.next/standalone/apps/web/.next/server/middleware.js \
 && node -e "const p = require('node:path'), fs = require('node:fs'); const next = fs.realpathSync(p.resolve('apps/web/.next/standalone/apps/web/node_modules/next')); require(require.resolve('sharp', { paths: [next] }))" \
 || { echo 'standalone output incomplete (server.js, middleware.js or sharp missing)'; exit 1; }

# Assemble the runtime tree: standalone server + static assets + public files + entry points.
RUN mkdir -p /out/apps/web/.next /out/deploy \
 && cp -a apps/web/.next/standalone/. /out/ \
 && cp -a apps/web/.next/static /out/apps/web/.next/static \
 && cp -a apps/web/public /out/apps/web/public \
 && cp deploy/server.mjs deploy/graceful.mjs deploy/healthcheck.mjs /out/deploy/ \
 && node deploy/build-migrate.mjs /out/deploy \
 && mkdir -p /out/apps/web/.next/cache \
 && find /out -name '.env*' ! -name '.env.example' -print -delete \
 && rm -f /out/apps/web/.env.example

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runtime
ARG AROMA_REVISION=unknown
ARG AROMA_VERSION=0.0.0-local
LABEL org.opencontainers.image.title="aroma-web" \
      org.opencontainers.image.source="https://github.com/aromalabs/aroma" \
      org.opencontainers.image.revision="${AROMA_REVISION}" \
      org.opencontainers.image.version="${AROMA_VERSION}" \
      org.opencontainers.image.licenses="NOASSERTION"

# No package manager or shell tooling beyond what the base needs: drop npm, npx, corepack and
# yarn; add the unprivileged user that owns nothing but the cache directory.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && groupadd --system --gid 10001 aroma \
 && useradd --system --uid 10001 --gid aroma --no-create-home --home-dir /nonexistent \
            --shell /usr/sbin/nologin aroma

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_MANUAL_SIG_HANDLE=true \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    AROMA_REVISION=${AROMA_REVISION} \
    AROMA_VERSION=${AROMA_VERSION}

WORKDIR /app
COPY --from=build --chown=root:root /out/ /app/
# The only writable path in the image (a size-limited volume in compose): image and data cache.
RUN chown -R 10001:10001 /app/apps/web/.next/cache

USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "/app/deploy/healthcheck.mjs"]
CMD ["node", "/app/deploy/server.mjs"]
