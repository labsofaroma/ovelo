## What and why
<!-- One or two sentences. Link the milestone (M0–M8) or AUDIT item. -->

## Changes
-

## Checklist (AGENTS.md)
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] `pnpm test:contracts` passes (if the program changed), and the IDL and generated client leave no diff (`pnpm --filter @ovelo/contracts idl:check`)
- [ ] No private keys handled by the server; the server prepares transactions and wallets sign
- [ ] State-changing API routes need a signature, HMAC token or bearer secret, and read bodies with `readLimitedJson`
- [ ] Devnet code paths verify the devnet genesis hash; no devnet secret can reach mainnet
- [ ] No invented data in the UI (see PRODUCT.md)
- [ ] Token amounts use `bigint` or raw integer units, never floats
- [ ] New files stay under 400 lines; no new `any` in public types
- [ ] No `.env*` file other than `.env.example`, and no secrets or keypairs in the diff

## Screenshots / output
<!-- UI changes: before/after. Money paths: the test output. -->

## Risk and rollback
<!-- What could go wrong in production, and how to turn it off (feature flag, revert). -->
