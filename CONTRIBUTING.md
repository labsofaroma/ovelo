# Contributing

1. Read [AGENTS.md](AGENTS.md) (conventions) and [PRODUCT.md](PRODUCT.md) (product rules).
2. Branch from `main`: `feat/…`, `fix/…`, `chore/…`.
3. Keep PRs small and focused. Include tests for any `apps/web/server`, `features/*/server`, `lib/sdk` or program change.
4. Run the checks listed in AGENTS.md before pushing.
5. Use Conventional Commits (`feat(lib): …`, `fix(web): …`, `feat(guard): …`).
6. Contract changes need a second reviewer and an updated [docs/aroma-guard-v1.md](docs/aroma-guard-v1.md) (and the spec, [docs/CONTRACT-V1-SPEC.md](docs/CONTRACT-V1-SPEC.md), when behaviour changes).
7. Never commit secrets, keypairs or `.env.local`.
