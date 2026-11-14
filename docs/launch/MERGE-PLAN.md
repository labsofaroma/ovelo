# Merge, CI and `main` protection (P6)

_Prepared on `launch-prep`; **owner executes, one step at a time**. Nothing has been pushed, no tag or branch is on GitHub except `main` (the prototype) and nothing in GitHub settings was changed. **CI not verified**: no workflow has ever run on GitHub._

## 1. The branch stack (linear)

```
main (= prototype-final, e85d128)
 └ m0-foundation → m1-design-system → m2-shared-helpers → m3-read-only-app → m4-wallet-trading
   → m5-creators → m6-contract-core → m7-recurring-devnet → m8-mainnet-path → launch-prep
```

Every branch must contain the previous one; `main` becomes the final tip by **fast-forward** (no merge commit, no squash, history kept). State when this was written (2026-11-14): `main → … → m7-recurring-devnet` is linear; `m8-mainnet-path` (session 2, still in progress) and `launch-prep` both branch from `m7-recurring-devnet` and are **not yet stacked**. After M8 finishes, `launch-prep` is rebased onto it (the session stops and asks on conflicts in M8's files; the terms migration `0004` may need renumbering).

### Verify linearity (read-only)

```bash
prev=main
for b in m0-foundation m1-design-system m2-shared-helpers m3-read-only-app m4-wallet-trading \
         m5-creators m6-contract-core m7-recurring-devnet m8-mainnet-path launch-prep; do
  git merge-base --is-ancestor "$prev" "$b" && echo "OK $prev -> $b" || echo "NOT LINEAR $prev -> $b"
  prev=$b
done
git log --merges --oneline main..launch-prep   # must print nothing
git log --format='%an <%ae>' main..launch-prep | sort -u   # must be the Aroma Labs identity only
```

All ten lines must say `OK` before anything is pushed.

## 2. The prototype stays deployable

`prototype-final` is a lightweight tag on `e85d128` (today's `main` and `origin/main`). The prototype deploys from that tag after `main` moves (Vercel: a deployment of the tag's commit, or a `prototype` branch created at the tag). M9 keeps it on an archived URL for 30 days (REWRITE-PLAN §9).

## 3. Push order (prepared, NOT run)

Each command is run by the session only after the owner says "push", one at a time, confirming each:

```bash
git push origin refs/tags/prototype-final                 # 1. the tag first (prototype rollback point)
git push origin m0-foundation                             # 2. the stack, bottom up
git push origin m1-design-system
git push origin m2-shared-helpers
git push origin m3-read-only-app
git push origin m4-wallet-trading
git push origin m5-creators
git push origin m6-contract-core
git push origin m7-recurring-devnet
git push origin m8-mainnet-path
git push origin launch-prep
# 3. open a PR launch-prep → main; wait for the required checks (section 4) to pass on GitHub
# 4. fast-forward main (after the owner's review and green checks):
git push origin launch-prep:main                          # rejected unless it is a fast-forward
```

`git push --force` is never used. If `main` moved on GitHub in the meantime, stop and ask.

## 4. Required checks (job names from the workflows)

GitHub matches a required check by the job's `name:`.

| Workflow | Job (`name:`) | Triggers on every PR? | Recommended |
|---|---|---|---|
| `ci.yml` | **Lint, typecheck, test, build** | yes | **required** |
| `ci.yml` | **UI accessibility (axe, keyboard, reduced motion)** | yes | **required** |
| `contracts.yml` | packages/contracts - cargo test, clippy, both builds, LiteSVM, IDL and Codama drift | only on contract/guard paths | required only if the path filter is removed (see below) |
| `contracts.yml` | packages/anchor - cargo test and IDL drift | only on contract paths | not required (`packages/anchor` is removed in M9) |
| `e2e.yml` | v1 pages, axe light/dark (M3 suite) | only on listed paths; nightly | not required (network-dependent) |
| `e2e.yml` | Buy flow on a local mainnet fork (M4) | only on listed paths; nightly | not required (public providers rate-limit) |
| `e2e.yml` | Recurring plan on a local validator with the keeper (M7) | only on listed paths; nightly | not required |

**Path filters and required checks do not mix**: a required check whose workflow is skipped by a path filter stays "Expected" and blocks the PR forever. Either keep the path-filtered jobs optional (recommended above) or, for the contracts job, drop the `paths:` filter so it runs on every PR (about 15 minutes) and require it.

### `gh api` commands (prepared, NOT run)

```bash
# Branch protection on main: required checks, 1 approving review, code owners, linear history,
# no force-push, no deletion, conversations resolved, admins included.
gh api -X PUT repos/aromalabs/aroma/branches/main/protection \
  -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Lint, typecheck, test, build",
      "UI accessibility (axe, keyboard, reduced motion)"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON

# Check what is set:
gh api repos/aromalabs/aroma/branches/main/protection --jq '{checks: .required_status_checks.contexts, linear: .required_linear_history.enabled, force: .allow_force_pushes.enabled}'

# Protect the rollback tag from deletion or moving (repository ruleset):
gh api -X POST repos/aromalabs/aroma/rulesets -H "Accept: application/vnd.github+json" --input - <<'JSON'
{
  "name": "protect prototype-final",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/prototype-final"], "exclude": [] } },
  "rules": [{ "type": "deletion" }, { "type": "non_fast_forward" }, { "type": "update" }]
}
JSON
```

With one maintainer, a required review means a second person (or an org member) must approve; if there is none yet, set `required_approving_review_count` to 0 and keep the checks, linear history and no force-push. With `enforce_admins: true` the fast-forward in section 3 must go through the PR (merge method "Rebase and merge" keeps the commits; GitHub may rewrite committer data, so a plain fast-forward push before turning protection on is the cleaner option: push → checks green → `git push origin launch-prep:main` → then apply protection).

## 5. Workflow files: local verification

- `actionlint` 1.7.12 (already installed): **0 errors**; 2 shellcheck *info* notes (SC2086, unquoted variable) at `contracts.yml:93` and `e2e.yml:116`. Harmless; quote them when convenient.
- Every check name in section 4 exists in the files (`grep -n "name:" .github/workflows/*.yml`).

### Secrets, variables and services the jobs need on GitHub

| Job | Needs |
|---|---|
| CI: Lint, typecheck, test, build | optional `TURBO_TOKEN` (secret) and `TURBO_TEAM` (variable) for remote cache; nothing else (placeholder env from `.env.example`) |
| UI accessibility | Playwright Chromium (installed in the job); no secret |
| Contracts | Rust, Solana and Anchor toolchains (installed in the job); no secret |
| E2E smoke (M3) | outbound network to the xStocks catalog, Jupiter and price providers (public, read-only); no secret |
| E2E fork (M4/M5/M9) | `solana-test-validator`, Docker (Postgres + Neon WS proxy via `scripts/local-db.sh`), a public mainnet RPC for cloning (read-only), keyless Jupiter (rate-limited; a `JUPITER_API_KEY` secret would make it reliable) |
| E2E invest (M7) | `solana-test-validator`, Docker, the built program (`.so`); no secret |

Secrets to add on GitHub: **`TURBO_TOKEN`** (optional), **`JUPITER_API_KEY`** (optional, for the fork E2E; only if the workflow is changed to read it). No deploy key, RPC key or wallet secret belongs in GitHub Actions.

## 6. Pre-push baseline (local, this branch)

See section 7 of [PRODUCTION-ENV.md](./PRODUCTION-ENV.md#7-pre-push-local-gate-baseline) for the recorded counts.
