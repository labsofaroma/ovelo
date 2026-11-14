#!/usr/bin/env bash
# Builds both variants of Aroma Guard v1 with the pinned toolchain (Anchor.toml):
#   target/build/mainnet/      default features: no minting code, execute fails closed (M8)
#   target/build/devnet-mock/  --features devnet-mock: mints at the oracle price (devnet, localnet)
# SBPF v0: anchor-cli 1.2.1 defaults to --arch v3, but SBPFv3 deployment is inactive on devnet
# and mainnet (feature BUwGLeF3…, checked 2026-11-14), so a v3 binary cannot be deployed there.
# Never deploys and never reads a wallet.
set -euo pipefail
cd "$(dirname "$0")/.."
for variant in mainnet devnet-mock; do
  if [ "$variant" = "mainnet" ]; then anchor build --arch v0; else anchor build --arch v0 -- --features devnet-mock; fi
  mkdir -p "target/build/$variant"
  cp target/deploy/aroma_guard.so target/idl/aroma_guard.json "target/build/$variant/"
done
cmp -s target/build/mainnet/aroma_guard.json target/build/devnet-mock/aroma_guard.json \
  || { echo "The two builds produced different IDLs; the generated client must serve both." >&2; exit 1; }
# Leave the devnet-mock binary in target/deploy (what localnet and devnet run).
cp target/build/devnet-mock/aroma_guard.so target/deploy/aroma_guard.so
node scripts/check-build.mjs
