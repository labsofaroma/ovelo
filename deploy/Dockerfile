# syntax=docker/dockerfile:1.7
#
# Phase H: the Aroma web image for self-host (Hostinger VPS behind Cloudflare).
# Build from the repo root:  docker build -f deploy/Dockerfile .          (target: runtime)
#
# - Base: the official node:24.12.0-slim (Debian bookworm, glibc), pinned by index digest so
#   amd64 and arm64 resolve to the same release. Slim over alpine: sharp's and Next's prebuilt
#   binaries target glibc first, and musl differences are a class of prod-only bugs we avoid.
#   Both FROM lines below use the same literal reference so Dependabot can bump them together.
# - Build inputs: ONLY NEXT_PUBLIC_* build args (public by definition, inlined into the browser
#   bundle) and AROMA_SKIP_ENV_CHECK=1 for the build stage. No secret is a build arg, an ENV or a
#   layer; the runtime refuses to boot without a valid env (server/platform.ts, env.schema.ts).
# - Runtime: Next's traced standalone server (no dev dependencies, no package manager), non-root
#   UID 10001, read-only root filesystem friendly (writes only to /tmp and .next/cache).
# - The LAST stage (`runtime`) is the default target and the only one CI builds. `runtime-e2e`
#   (the local fork-E2E variant with the test wallet bridge) is built only by an explicit
#   --target and is refused at boot under production rules.

# ---------- dependencies ----------
FROM node:24.12.0-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS deps
ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /repo
# Manifests first (cached unless one of them or the lockfile changes).
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
ENV NEXT_PUBLIC_SOLANA_RPC_URL=${NEXT_PUBLIC_SOLANA_RPC_URL} \
    NEXT_PUBLIC_SOLANA_WS_URL=${NEXT_PUBLIC_SOLANA_WS_URL} \
    NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL=${NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_PLAUSIBLE_DOMAIN=${NEXT_PUBLIC_PLAUSIBLE_DOMAIN} \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

# ---------- builds (deploy/build-app.sh: build, trace checks, assemble /out) ----------
FROM deps AS build
RUN deploy/build-app.sh production

FROM deps AS build-e2e
RUN deploy/build-app.sh e2e

# ---------- runtime base ----------
FROM node:24.12.0-slim@sha256:7326fb2dbdce998edd72140946851be64ef4a643e8715e138ca467e8e9d92c99 AS runtime-base
# No package manager or shell tooling beyond what the base needs: drop npm, npx, corepack and
# yarn; add the unprivileged user (no shell, no home).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
 && groupadd --system --gid 10001 aroma \
 && useradd --system --uid 10001 --gid aroma --no-create-home --home-dir /nonexistent \
            --shell /usr/sbin/nologin aroma
ARG AROMA_REVISION=unknown
ARG AROMA_VERSION=0.0.0-local
LABEL org.opencontainers.image.title="aroma-web" \
      org.opencontainers.image.source="https://github.com/aromalabs/aroma" \
      org.opencontainers.image.revision="${AROMA_REVISION}" \
      org.opencontainers.image.version="${AROMA_VERSION}" \
      org.opencontainers.image.licenses="NOASSERTION"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_MANUAL_SIG_HANDLE=true \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    AROMA_REVISION=${AROMA_REVISION} \
    AROMA_VERSION=${AROMA_VERSION}
WORKDIR /app
USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "/app/deploy/healthcheck.mjs"]
CMD ["node", "/app/deploy/server.mjs"]

# ---------- LOCAL fork-E2E variant (explicit --target only; never built by CI) ----------
FROM runtime-base AS runtime-e2e
LABEL org.aroma.e2e="true"
# Makes the boot refuse this image whenever the production rules apply (env.schema.ts).
ENV NEXT_PUBLIC_AROMA_E2E_WALLET=true
COPY --from=build-e2e --chown=root:root /out/ /app/
USER 0
RUN chown 10001:10001 /app/apps/web/.next/cache
USER 10001:10001

# ---------- runtime (the default target, the deployable image) ----------
FROM runtime-base AS runtime
COPY --from=build --chown=root:root /out/ /app/
# The only writable path in the image (a size-limited volume in compose): image and data cache.
USER 0
RUN chown 10001:10001 /app/apps/web/.next/cache
USER 10001:10001
