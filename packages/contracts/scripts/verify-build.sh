#!/usr/bin/env bash
# Verifiable build of the DEFAULT (mainnet) Ovelo Guard v1 binary (M8 B7). Never deploys, never
# reads a wallet.
#
#   bash scripts/verify-build.sh            local: scripts/build.sh with the pinned toolchain
#                                           (Agave 3.1.10, anchor-cli 1.2.1, SBPF v0), then the
#                                           hashes; must equal verifiable-build.json "local"
#   bash scripts/verify-build.sh --docker   solana-verify build in the pinned Docker image (the
#                                           hash an auditor reproduces anywhere); compared with
#                                           verifiable-build.json "docker" when one is recorded
#
# The local hash is reproducible on a machine with the same toolchain and checkout path (release
# binaries can embed paths); the Docker hash is the one to publish (CONTRACT-V1-SPEC §7).
set -euo pipefail
cd "$(dirname "$0")/.."
RECORD=verifiable-build.json
IMAGE="${OVELO_VERIFY_IMAGE:-solanafoundation/solana-verifiable-build:3.1.10}"
field() { node -e "const r=require('./$RECORD');const v=$1;process.stdout.write(v==null?'':String(v))"; }

if [ "${1:-}" = "--docker" ]; then
  command -v docker >/dev/null || { echo "docker is required for --docker" >&2; exit 1; }
  docker image inspect "$IMAGE" >/dev/null 2>&1 || {
    echo "Image $IMAGE is not present. Pull it (owner step), record its digest in $RECORD, re-run." >&2
    exit 1
  }
  solana-verify build --library-name ovelo_guard --arch v0 --base-image "$IMAGE" .
  mkdir -p target/build/verifiable
  cp target/deploy/ovelo_guard.so target/build/verifiable/ovelo_guard.so
  HASH=$(solana-verify get-executable-hash target/build/verifiable/ovelo_guard.so | tail -1)
  echo "docker executable hash: $HASH (image $IMAGE)"
  EXPECTED=$(field "r.docker && r.docker.executableHash")
  if [ -n "$EXPECTED" ] && [ "$EXPECTED" != "$HASH" ]; then
    echo "Docker hash differs from $RECORD ($EXPECTED)." >&2
    exit 1
  fi
  exit 0
fi

bash scripts/build.sh >/dev/null
HASH=$(solana-verify get-executable-hash target/build/mainnet/ovelo_guard.so | tail -1)
SHA=$(shasum -a 256 target/build/mainnet/ovelo_guard.so | cut -d' ' -f1)
echo "default build: executable hash $HASH, file sha256 $SHA"
EXPECTED=$(field "r.local.executableHash")
if [ "$EXPECTED" != "$HASH" ]; then
  echo "Local hash differs from $RECORD ($EXPECTED): different source, toolchain or checkout path." >&2
  exit 1
fi
echo "OK: matches $RECORD"
