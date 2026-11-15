#!/usr/bin/env bash
# Deploys the devnet-mock build of Ovelo Guard v1 to DEVNET with the owner's deployer wallet.
# The OWNER runs this (docs/M6-DEVNET-DEPLOY.md); agents never do. Refuses any cluster but devnet.
#   OVELO_DEPLOYER=~/.config/solana/ovelo-deployer.json bash scripts/deploy-devnet.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEVNET_GENESIS="EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
EXPECTED_PROGRAM_ID="FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU"
DEPLOYER="${OVELO_DEPLOYER:-$HOME/.config/solana/ovelo-deployer.json}"
PROGRAM_KEYPAIR="target/deploy/ovelo_guard-keypair.json"
URL="${OVELO_DEVNET_RPC:-https://api.devnet.solana.com}"
die() { echo "deploy-devnet: $*" >&2; exit 1; }

[ -f "$DEPLOYER" ] || die "deployer keypair not found at $DEPLOYER (CONTRACT-V1-SPEC §10, step 1)."
[ -f "$PROGRAM_KEYPAIR" ] || die "$PROGRAM_KEYPAIR is missing; \`anchor build\` would create a NEW program keypair (a different program ID). Restore it from your backup (docs/M6-DEVNET-DEPLOY.md §1). Refusing to deploy."
[ "$(solana genesis-hash --url "$URL")" = "$DEVNET_GENESIS" ] || die "$URL is not Solana devnet. Refusing."
# The keypair, declare_id!, Anchor.toml and the built IDLs must all be EXPECTED_PROGRAM_ID.
node scripts/check-program-id.mjs --expect "$EXPECTED_PROGRAM_ID" || die "program ID check failed. Refusing to deploy."
DEPLOYER_PUBKEY="$(solana-keygen pubkey "$DEPLOYER")"
echo "Deployer: $DEPLOYER_PUBKEY  balance: $(solana balance "$DEPLOYER_PUBKEY" --url "$URL")"

bash scripts/build.sh
node scripts/check-program-id.mjs --require-idl --expect "$EXPECTED_PROGRAM_ID" || die "program ID check failed after the build. Refusing to deploy."

solana program deploy \
  --url "$URL" \
  --keypair "$DEPLOYER" \
  --upgrade-authority "$DEPLOYER" \
  --program-id "$PROGRAM_KEYPAIR" \
  target/build/devnet-mock/ovelo_guard.so

SHOW="$(solana program show "$EXPECTED_PROGRAM_ID" --url "$URL" --output json)"
echo "$SHOW"
AUTHORITY="$(printf '%s' "$SHOW" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).authority))')"
[ "$AUTHORITY" = "$DEPLOYER_PUBKEY" ] || die "upgrade authority is $AUTHORITY, expected $DEPLOYER_PUBKEY."
echo "OK: $EXPECTED_PROGRAM_ID deployed to devnet; upgrade authority = $DEPLOYER_PUBKEY."
