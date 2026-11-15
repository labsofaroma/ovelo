# Security Policy

## Reporting a vulnerability
Please **do not open a public issue**. Email the maintainers at the contact in `OVELO_SUPPORT_EMAIL` for the deployment (or the repository owner) with steps to reproduce and the impact. We aim to acknowledge within 72 hours.

_Maintainers: replace this paragraph with a dedicated security address and add the same contact to the program's `security.txt`._

## Scope
- `apps/web` API routes and middleware
- transaction builders in `apps/web/lib/sdk`
- `ovelo_guard` on-chain program (devnet today; mainnet after audit)

## Design principles
- The server never holds user keys. Users sign every fund movement.
- Quote → execute is bound by HMAC + message hash + wallet signature.
- The keeper signs only as fee payer.
- Devnet and mainnet are separated by genesis-hash checks.

## Known issues
Tracked in [docs/AUDIT.md](docs/AUDIT.md). The current prototype `ovelo_guard` program is **not safe for mainnet** (see C-1, C-2). It is being replaced by Ovelo Guard v1 ([docs/CONTRACT-V1-SPEC.md](docs/CONTRACT-V1-SPEC.md)).

## Secrets
Generate every HMAC or bearer secret with at least 32 random bytes (`openssl rand -base64 48`), and use a different value for each purpose. Rotate a secret at once if it is exposed. Keeper and faucet keypairs are devnet-only.
