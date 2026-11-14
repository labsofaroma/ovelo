# @aroma/ui

Aroma's design tokens, Base UI primitives and domain components. **Presentation only**: no app code, no server-only code, no wallet or Solana packages (ESLint enforces it, see [Boundary](#boundary)). Status: M1 of [docs/REWRITE-PLAN.md](../../docs/REWRITE-PLAN.md). The prototype keeps its own `apps/web/styles/*` and `components/*` until M7; this package is additive.

```bash
pnpm --filter @aroma/ui dev              # Ladle workbench at http://localhost:61000
pnpm --filter @aroma/ui build:stories    # static workbench into dist/stories
pnpm --filter @aroma/ui test             # unit + token + contrast + logos tests (Vitest)
pnpm --filter @aroma/ui test:a11y        # real-browser axe, keyboard, reduced motion (needs build:stories first)
pnpm --filter @aroma/ui gen:logos        # regenerate logos.ts from apps/web/public/company-logos
```

First run of `test:a11y` needs a browser: `pnpm --filter @aroma/ui exec playwright install chromium`.

## What is in the package

| Path               | What                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tokens.css`       | The design tokens: plain CSS custom properties, no framework needed. Light, dark, reduced motion.                                                                                                      |
| `theme.css`        | Tailwind v4 `@theme inline` mapping of the tokens to utilities (`bg-surface`, `text-muted`, `rounded-control`, `motion-base`, ...).                                                                    |
| `fonts.css`        | Optional `@font-face` for hosts that do not load Manrope themselves (Ladle). Next apps may use `next/font` and override `--aroma-font-sans`.                                                           |
| `src/primitives/*` | Button, IconButton, Input, Label, Field, Select, Checkbox, Switch, RadioGroup, Tabs, Dialog, Sheet, Popover, Tooltip, DropdownMenu, Table, Badge, Card, Skeleton, Spinner, Toast, Separator, Progress. |
| `src/domain/*`     | Brand (+ OrbitArt), AssetAvatar, Change, SocialLinks.                                                                                                                                                  |
| `src/format`       | `formatUnits` / `formatSignedUnits`: display formatting for `bigint` + decimals, no float math.                                                                                                        |
| `src/theme`        | `themeInitScript`: the inline no-flash theme script.                                                                                                                                                   |
| `logos.ts`         | **Generated** by `scripts/gen-logos.ts`. A test fails if it is stale.                                                                                                                                  |

Public API: `import { Button } from "@aroma/ui"`; `@aroma/ui/theme` (server-safe, no React), `@aroma/ui/format`, `@aroma/ui/logos`, and the CSS files `@aroma/ui/tokens.css`, `@aroma/ui/theme.css`, `@aroma/ui/fonts.css`.

Components that use hooks or Base UI start with `"use client"`, so they work from Server Components. Brand, Badge, Card, Table, Change, Label, Skeleton, Spinner and SocialLinks stay server-compatible.

## How tokens flow

```
tokens.css            --aroma-bg, --aroma-ink, --aroma-space-4, --aroma-duration-base ...   (runtime CSS variables)
   │  theme.css       @theme inline { --color-bg: var(--aroma-bg); --text-small: ...; }      (Tailwind reads the names)
   ▼
utilities             bg-bg  text-ink  p-4  rounded-control  motion-base  focus-ring  z-modal
   ▼
components            only utilities and tokens, never a raw hex value
```

- **Themes.** `data-theme="light|dark"` on `<html>` wins; with no attribute, `prefers-color-scheme` decides. The attribute works on any element, so a subtree can be scoped (the "Light and dark" stories show both at once). Render `themeInitScript` in `<head>` for no flash of the wrong theme:
  ```tsx
  import { themeInitScript } from "@aroma/ui/theme";
  <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />;
  ```
  It reads the same `aroma-theme` localStorage key as the prototype, so a saved choice carries over. Tested for stored choice, system fallback, junk values and blocked storage.
- **Reduced motion.** Every `--aroma-duration-*` collapses to `0.01ms` under `prefers-reduced-motion: reduce`, and `--default-transition-duration` is a token too, so even a bare `transition-colors` follows. Keyframes (`animate-shimmer`, `animate-spin-token`, `animate-indeterminate`) take their duration from tokens. Never hard-code a duration in a component.
- **Spacing** is 4px based and aligned with Tailwind: `--aroma-space-N` equals the `N` step (`p-4` is 16px).
- **Lines vs borders.** `--aroma-line` is for decorative dividers and is _below_ 3:1 by design. Anything that marks a control boundary uses `--aroma-border-strong` (3:1 or better).

### Old variable → new token

Every variable in `apps/web/styles/foundation.css` and `theme-surfaces.css`. A test (`src/tokens/mapping.test.ts`) fails if a legacy variable is missing from this table.

| Old (`foundation.css`, `theme-surfaces.css`)                                                     | New token                                | Tailwind utility                         | Note                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--bg`                                                                                           | `--aroma-bg`                             | `bg-bg`                                  |                                                                                                            |
| `--surface`                                                                                      | `--aroma-surface`                        | `bg-surface`                             |                                                                                                            |
| `--raised`                                                                                       | `--aroma-raised`                         | `bg-raised`                              |                                                                                                            |
| `--ink`                                                                                          | `--aroma-ink`                            | `text-ink`                               |                                                                                                            |
| `--muted`                                                                                        | `--aroma-muted`                          | `text-muted`                             |                                                                                                            |
| `--line`                                                                                         | `--aroma-line`                           | `border-line`                            | decorative only; see `--aroma-border-strong`                                                               |
| `--accent`                                                                                       | `--aroma-accent`                         | `bg-accent`, `text-accent`               |                                                                                                            |
| `--accent-ink`                                                                                   | `--aroma-accent-ink`                     | `text-accent-ink`                        |                                                                                                            |
| `--up`                                                                                           | `--aroma-up`                             | `text-up`                                |                                                                                                            |
| `--down`                                                                                         | `--aroma-down`                           | `text-down`                              |                                                                                                            |
| `--scrim`                                                                                        | `--aroma-scrim`                          | `bg-scrim`                               |                                                                                                            |
| `--shadow-float`                                                                                 | `--aroma-shadow-float`                   | `shadow-float`                           |                                                                                                            |
| `--font-sans`                                                                                    | `--aroma-font-sans`                      | `font-sans`                              | Manrope, Inter, then system. Self-contained: an app using `next/font` overrides `--aroma-font-sans` itself |
| `--font-nav`                                                                                     | none                                     | none                                     | **dropped**: it was an alias of `--font-sans`                                                              |
| `--space-1` `--space-2` `--space-3` `--space-4` `--space-5` `--space-6` `--space-8` `--space-12` | `--aroma-space-1` ... `--aroma-space-12` | `p-1` ... `p-12`                         | same px values, now in rem                                                                                 |
| `--text-micro`                                                                                   | `--aroma-text-micro`                     | `text-micro`                             | 11px as `0.6875rem`                                                                                        |
| `--text-caption`                                                                                 | `--aroma-text-caption`                   | `text-caption`                           | 12px                                                                                                       |
| `--text-small`                                                                                   | `--aroma-text-small`                     | `text-small`                             | 13px                                                                                                       |
| `--text-body`                                                                                    | `--aroma-text-body`                      | `text-body`                              | 14px                                                                                                       |
| `--text-title`                                                                                   | `--aroma-text-title`                     | `text-title`                             | 18px                                                                                                       |
| `--text-section`                                                                                 | `--aroma-text-section`                   | `text-section`                           | 22px                                                                                                       |
| `--text-page`                                                                                    | `--aroma-text-page`                      | `text-page`                              | 36px                                                                                                       |
| `--text-page-mobile`                                                                             | `--aroma-text-page-mobile`               | `text-page-mobile`                       | 28px                                                                                                       |
| `--radius-badge`                                                                                 | `--aroma-radius-badge`                   | `rounded-badge`                          | 6px                                                                                                        |
| `--radius-control`                                                                               | `--aroma-radius-control`                 | `rounded-control`                        | 10px                                                                                                       |
| `--radius-panel`                                                                                 | `--aroma-radius-panel`                   | `rounded-panel`                          | 16px                                                                                                       |
| `--control-height`                                                                               | `--aroma-control-height`                 | `min-h-(--aroma-control-height)`         | 44px, also the touch target                                                                                |
| `--control-height-compact`                                                                       | `--aroma-control-height-compact`         | `min-h-(--aroma-control-height-compact)` | 36px                                                                                                       |
| `--ease-ui`                                                                                      | `--aroma-ease-ui`                        | `ease-ui`                                |                                                                                                            |

Not in `foundation.css`, added here: `--aroma-border-strong`, `--aroma-accent-hover`, `--aroma-accent-soft`, `--aroma-up-soft`, `--aroma-down-soft`, `--aroma-warning`, `--aroma-warning-soft` (the prototype hard-codes `#f59e0b`, which fails AA on light), `--aroma-focus`, `--aroma-plate` (logo backing), `--aroma-radius-full`, `--aroma-shadow-raised`, z-index (`--aroma-z-*`), durations (`--aroma-duration-*`), breakpoints, layout (`--aroma-content-max`, `--aroma-gutter*`), leading and tracking.

Also dropped, from `apps/web/tailwind.config.js` (v3): the `sm/md/lg` radius overrides (4/8/12px) and the `out` easing; nothing in `foundation.css` used them. **Prototype bug noticed, not fixed:** that file maps `raised` to `var(--bg-raised)`, a variable that does not exist (it is `--raised`), so `bg-raised` is transparent in the prototype.

Deliberately _not_ tokens: the landing page's editorial display sizes, serif accents and diagram labels. They stay local to the landing module (see `.21st/DESIGN.md`).

## Tailwind v3 and v4 side by side

The prototype is on Tailwind v3 and must keep building until M7. v4 is added without touching it:

- **Tailwind v4 only (M9).** `apps/web/app/aroma-ui.css` is the app's single entry, imported by the root layouts: theme, preflight and utilities in declared cascade layers (`theme, base, components, utilities`), then `fonts.css`, `tokens.css` and `theme.css`. Ladle uses `.ladle/styles.css` (the same layers). The prototype's Tailwind v3 chain, its PostCSS router and `foundation.css` were removed in M9.

## Adding a primitive

1. `src/primitives/<Name>/` with `<Name>.tsx`, `index.ts`, `<Name>.test.tsx`, `<Name>.stories.tsx`. Add `export * from "./<Name>"` to `src/primitives/index.ts`.
2. Build on a Base UI part where one exists (it provides focus management, roles and keyboard). Use `PartProps<typeof Part>` for props (narrows `className` to a string), `forwardRef`, and `cn()` to merge classes. Add `"use client"` if it uses hooks or Base UI.
3. Style with token utilities only: `focus-ring` for the focus ring, `motion-*` or a bare `transition-*` for transitions (both follow reduced motion), `border-border-strong` for control boundaries. No hex, no hard-coded `ms`. Use a CSS Module only for complex animation (see `Select.module.css`).
4. Every interactive primitive needs: keyboard operation, correct ARIA, a disabled state, a loading state where it makes sense, an error state where it takes input.
5. Tests: render, roles/names, keyboard, disabled/loading, ref forwarding, and `await axe(container)` from `src/test/axe`. jsdom cannot prove Tab-cycle focus traps or Enter-to-select in Base UI popups; add those to `e2e/keyboard.spec.ts`.
6. Ported from the prototype or shadcn? Keep the attribution (see [UI-SOURCES.md](./UI-SOURCES.md), `SHADCN-LICENSE.md`) and a header comment.

## Adding a story

`src/**/*.stories.tsx`, one file per component, `export default { title: "Primitives/Name" }`, one named export per state: `Default`, `Focus` (wrap in `AutoFocus` from `src/stories/helpers`), `Disabled`, `Loading`, `Invalid`, and `LightAndDark` (wrap in `Themes`, which renders both themes side by side). Overlays take `defaultOpen` so the open state is reviewable and tested.

**Sample data only.** Anything that looks like a price, balance or weight must be obviously a demo ("Demo value", "Sample token A", `DEMO1`). Never paste real market data. PRODUCT.md rule 4 applies to stories.

Why Ladle and not Storybook: Vite-native, React 18/19, builds the whole workbench in about 2s with one small dependency, which also keeps a 100-story axe run fast.

## The accessibility gate

Four layers, all required:

1. **Token contrast** (`src/tokens/contrast.test.ts`). Parses `tokens.css` and checks every foreground/background pair components use, in light and dark: 4.5:1 for text, 3:1 for UI boundaries, focus ring and indicators. Adding a color pair to a component means adding it to the `PAIRS` list. It fails on regressions, and it has already caught one (light `down` on `down-soft`).
2. **Component tests** (`*.test.tsx`). axe in jsdom plus keyboard and ARIA assertions. Contrast and the page-level `region` rule are off here (jsdom cannot paint; a fixture is not a page), documented in `src/test/axe.ts`.
3. **axe over every story, light and dark** (`e2e/a11y.spec.ts`, Chromium). WCAG 2.0/2.1/2.2 A and AA plus best practice, with reduced motion emulated so contrast is measured after transitions. The only rules off are page-level (`region`, `landmark-one-main`, `page-has-heading-one`), with the reason in the file. A control test proves the gate detects a deliberate contrast failure.
4. **Keyboard and motion in a real browser** (`e2e/keyboard.spec.ts`, `e2e/reduced-motion.spec.ts`): Select/Dialog/Sheet/Menu/Tabs/Checkbox/Switch/Radio keyboard flows including focus trap and focus return; and, with `prefers-reduced-motion: reduce`, every story's longest computed transition/animation duration must be within the token floor. A control test proves the check is not vacuous.

Fix violations at the token or component, not by suppressing a rule. An unavoidable suppression needs an inline comment saying why.

## Boundary

`eslint.config.mjs` forbids, in every file of this package: `@aroma/web|keeper`, any path under `apps/`, `server-only` and server folders, `@solana/*`, `@solana-program/*`, `@coral-xyz/*`, `@farcaster/*`, `@wallet-standard/*`, `@reown/*`, `@walletconnect/*`, `viem`, `wagmi`, `ethers`, and `next`/`next/*`. Behaviour comes in through props: `Brand` takes a `LinkComponent`, `AssetAvatar` takes an `ImageComponent` (see `apps/web/app/(app)/ui-preview/NextAvatarImage.tsx`).

## Deferred

- **`LegalPage`** stays an app feature component (`features/marketing`), since it reads app configuration and links app routes; it composes `Brand` and these primitives.
