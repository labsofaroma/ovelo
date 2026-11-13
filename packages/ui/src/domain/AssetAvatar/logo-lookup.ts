import { COMPANY_LOGO_BASE_PATH, companyLogos } from "../../../logos";

export interface LogoLookupAsset {
  symbol: string;
  mint?: string | null;
  issuer?: string | null;
  underlyingSymbol?: string | null;
}

const byMint = new Map<string, string>();
const byIssuerSymbol = new Map<string, string>();
const byUnderlyingSymbol = new Map<string, string>();

for (const { issuer, symbol, underlyingSymbol, file, mints } of companyLogos) {
  const path = `${COMPANY_LOGO_BASE_PATH}/${file}`;
  for (const mint of mints) byMint.set(mint, path);
  byIssuerSymbol.set(`${issuer}:${symbol.toUpperCase()}`, path);
  byIssuerSymbol.set(`${issuer}:${underlyingSymbol.toUpperCase()}`, path);
  if (!byUnderlyingSymbol.has(underlyingSymbol.toUpperCase())) {
    byUnderlyingSymbol.set(underlyingSymbol.toUpperCase(), path);
  }
}

/** Mint identity wins, so an unrelated token can never borrow a company's branding. */
export function getCompanyLogo(asset: LogoLookupAsset): string | null {
  if (asset.mint) {
    const exact = byMint.get(asset.mint);
    if (exact) return exact;
  }
  if (asset.issuer) {
    const match = byIssuerSymbol.get(
      `${asset.issuer}:${(asset.underlyingSymbol || asset.symbol).toUpperCase()}`,
    );
    if (match) return match;
  }
  const clean = (
    asset.underlyingSymbol ||
    (asset.symbol.endsWith(".US")
      ? asset.symbol.slice(0, -3)
      : asset.symbol.endsWith("x")
        ? asset.symbol.slice(0, -1)
        : asset.symbol)
  ).toUpperCase();
  return byUnderlyingSymbol.get(clean) ?? null;
}

/** http(s) and same-origin paths only: never `javascript:`, `data:` or protocol-relative URLs. */
export function isSafeLogoUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Deterministic 32-bit FNV-1a, so the same symbol always gets the same fallback tone. */
export function hashSymbol(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Tailwind classes for the fallback tile: tinted surface + ink text (high contrast in both themes). */
export const FALLBACK_TONES = [
  "bg-raised",
  "bg-accent-soft",
  "bg-up-soft",
  "bg-warning-soft",
  "bg-down-soft",
] as const;

export function fallbackTone(symbol: string): (typeof FALLBACK_TONES)[number] {
  return (
    FALLBACK_TONES[hashSymbol(symbol.toUpperCase()) % FALLBACK_TONES.length] ??
    FALLBACK_TONES[0]
  );
}

export function tickerOf(asset: LogoLookupAsset): string {
  return (
    asset.underlyingSymbol?.slice(0, 3).toUpperCase() ??
    asset.symbol.replace(/\.US$/i, "").slice(0, 3).toUpperCase()
  );
}
