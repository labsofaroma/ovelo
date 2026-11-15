# Rename: Aroma → Ovelo (owner steps)

_2026-11-16, branch `deploy-hostinger`. The product, packages (`@ovelo/*`), environment variables (`OVELO_*`), the Solana program crate (`ovelo_guard`), its IDL and generated client, Docker paths (`/etc/ovelo`, `/opt/ovelo`), the origin header (`x-ovelo-origin`), the image (`ghcr.io/labsofaroma/ovelo-web`) and the repository (`github.com/labsofaroma/ovelo`) are renamed. Two names are kept on purpose: the GitHub account `labsofaroma` (commit email, image owner) and "Aroma Labs" (the commit identity and the entity in `LICENSE`)._

**Unchanged on chain:** the program ID `FYrrfhrysaGUwCNyTggqyKmTWqpg3vph8gzmSWt7QtTU`. No PDA seed contained the old name, and Anchor discriminators come from account, event and instruction names, none of which was prefixed. Devnet accounts stay readable.

## Git-ignored files only you have (the session did not open or move any key)

Run in each checkout you use, then confirm nothing is left:

```bash
# Program keypair (the build refuses without it, by design, so no new program ID is created).
mv packages/contracts/target/deploy/aroma_guard-keypair.json packages/contracts/target/deploy/ovelo_guard-keypair.json
# Deployer wallet path used by Anchor.toml and the devnet scripts.
mv ~/.config/solana/aroma-deployer.json ~/.config/solana/ovelo-deployer.json
# Executor keypair, if you have one.
[ -f .aroma-executor-keypair.json ] && mv .aroma-executor-keypair.json .ovelo-executor-keypair.json
# Environment files: rename the variable NAMES only (values untouched).
for f in apps/web/.env.local apps/keeper/.env* .devnet/*.env; do
  [ -f "$f" ] && sed -i '' -e 's/^AROMA_/OVELO_/' -e 's/^NEXT_PUBLIC_AROMA_/NEXT_PUBLIC_OVELO_/' "$f"
done
```

Then: `pnpm build:contracts && pnpm --filter @ovelo/contracts idl:check` (expect no IDL drift) and `pnpm test:contracts`.

## Accounts and dashboards

- **Vercel / Hostinger env:** every `AROMA_*` variable becomes `OVELO_*` (same values). On the VPS: `/etc/aroma` → `/etc/ovelo`, `/opt/aroma` → `/opt/ovelo`, `aroma.env` → `ovelo.env`, and the Cloudflare Transform Rule header `x-aroma-origin` → `x-ovelo-origin`.
- **Neon:** the role names in the runbook are now `ovelo_app` and `ovelo_migrate`. A database already set up with the old names keeps working if `DATABASE_URL` names them; rename the roles only on a fresh setup.
- **Repository variables** (`NEXT_PUBLIC_*`) are unchanged names; set them on `labsofaroma/ovelo`.
