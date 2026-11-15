# @ovelo/ui sources and attributions

Carried over from `apps/web/components/ui/UI-SOURCES.md` for the components that moved here. Licenses stay next to the code: `SHADCN-LICENSE.md` (MIT).

- **Select**: port of the prototype's `GlideSelect` (a local implementation of the user's GlideSelect API example) on the Base UI Select and Combobox, for listbox semantics, focus return, typeahead and searchable asset selection. Kept: grouped options, tags, rich option content, loading and empty states, menu header/status/footer, the remembered sliding highlight. Dropped: per-instance color and duration props, which tokens replace. No external GlideSelect code was imported.
- [shadcn/ui Table](https://ui.shadcn.com/docs/components/table): the Table primitive, styled with tokens. MIT, see `SHADCN-LICENSE.md`.
- [shadcn/ui Dropdown Menu](https://ui.shadcn.com/docs/components/dropdown-menu): grouped, portaled menu composition on Base UI Menu. MIT.
- [shadcn/ui Dialog](https://ui.shadcn.com/docs/components/base/dialog) (Dialog, Sheet): title, description, portal, backdrop and close composition on Base UI Dialog. MIT.
- shadcn-style composition for Button, Input, Field, Checkbox, Switch, Radio Group, Tabs, Popover, Tooltip, Progress, Toast, Badge, Card, Separator, Skeleton and Spinner: written for Ovelo on Base UI parts and tokens; no shadcn source was copied beyond the composition pattern. Base UI is MIT.
- Brand glyph, wordmark and `AssetAvatar` logic: ported from the prototype's `Brand.tsx` and `AssetAvatar.tsx` (removed in M9). Issuer artwork provenance: `apps/web/public/company-logos/manifest.json`.
- `Change`: new; the prototype's `Change` (in `MarketUI.tsx`) took a float and relied on color alone.

Not carried over: the Consensys, Kokonut UI and GrowwUI references in the prototype's file describe the Shell and trading screens, which move in M3 and M4.
