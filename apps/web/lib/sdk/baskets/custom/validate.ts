import {
  MAX_CUSTOM_BASKET_LEGS,
  MIN_CUSTOM_BASKET_LEGS,
  type BasketAllocation,
  type ProgrammableBasket,
  type RebalanceRules,
} from "./types";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Sanitizes and formats a social or profile URL (e.g. "@username", "x.com/username", or full URL). */
export function formatSocialUrl(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  // Handle @handle e.g. @satoshinakamoto -> https://x.com/satoshinakamoto
  if (trimmed.startsWith("@")) {
    const handle = trimmed.slice(1).trim();
    return handle ? `https://x.com/${handle}` : undefined;
  }

  // If already full protocol URL
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // Prepend https://
  return `https://${trimmed}`;
}

/** Validate allocation definitions. Route availability and transaction bounds are checked at quote time:
 * strictly positive integer basis points, exact 10,000 bps sum, unique mints. */
export function validateProgrammableBasket(input: unknown): ProgrammableBasket {
  if (!isRecord(input)) throw new Error("Invalid custom basket object.");
  const id = String(input.id || "").trim();
  const name = String(input.name || "").trim();
  const ticker = String(input.ticker || "")
    .trim()
    .toUpperCase();
  const description = String(input.description || "").trim();
  const category = (
    typeof input.category === "string" ? input.category : "custom"
  ) as ProgrammableBasket["category"];
  const createdAt =
    typeof input.createdAt === "string"
      ? input.createdAt
      : new Date().toISOString();
  const updatedAt =
    typeof input.updatedAt === "string" ? input.updatedAt : createdAt;

  const rawCreatorName =
    typeof input.creatorName === "string"
      ? input.creatorName.trim()
      : undefined;
  const creatorName =
    rawCreatorName && rawCreatorName.length > 0
      ? rawCreatorName.slice(0, 50)
      : undefined;

  const rawCreatorSocial =
    typeof input.creatorSocial === "string"
      ? input.creatorSocial.trim()
      : undefined;
  const creatorSocial = rawCreatorSocial
    ? formatSocialUrl(rawCreatorSocial)?.slice(0, 200)
    : undefined;

  if (!id || id.length > 100)
    throw new Error("Basket identifier is missing or too long.");
  if (!name || name.length > 50)
    throw new Error("Basket name must be between 1 and 50 characters.");
  if (!ticker || ticker.length < 2 || ticker.length > 15)
    throw new Error("Basket ticker must be between 2 and 15 characters.");
  if (description.length > 500)
    throw new Error("Basket description must not exceed 500 characters.");

  if (!Array.isArray(input.allocations))
    throw new Error("Basket allocations must be an array.");
  if (
    input.allocations.length < MIN_CUSTOM_BASKET_LEGS ||
    input.allocations.length > MAX_CUSTOM_BASKET_LEGS
  ) {
    throw new Error(
      `Custom baskets must contain between ${MIN_CUSTOM_BASKET_LEGS} and ${MAX_CUSTOM_BASKET_LEGS} assets. Execution depends on current routes and transaction limits.`,
    );
  }

  const seenMints = new Set<string>();
  let totalBps = 0;
  const allocations: BasketAllocation[] = [];

  for (const item of input.allocations) {
    if (!isRecord(item)) throw new Error("Invalid allocation item.");
    const mint = String(item.mint || "").trim();
    const symbol = String(item.symbol || "")
      .trim()
      .toUpperCase();
    const nameStr =
      typeof item.name === "string" ? item.name.trim() : undefined;
    const weightBps = Number(item.weightBps);

    if (!mint || mint.length < 32 || mint.length > 44)
      throw new Error(`Invalid mint address: ${mint}`);
    if (seenMints.has(mint))
      throw new Error(`Duplicate asset in basket: ${symbol || mint}`);
    seenMints.add(mint);

    if (!Number.isInteger(weightBps) || weightBps <= 0 || weightBps > 10_000) {
      throw new Error(
        `Allocation for ${symbol || mint} must be a positive integer basis point amount.`,
      );
    }

    totalBps += weightBps;
    allocations.push({ mint, symbol, name: nameStr, weightBps });
  }

  if (totalBps !== 10_000) {
    throw new Error(
      `Total basket allocations must sum to exactly 10,000 basis points (100.00%). Current sum: ${totalBps}.`,
    );
  }

  const rebalanceRulesInput = isRecord(input.rebalanceRules)
    ? input.rebalanceRules
    : {};
  const driftThresholdBps = Number(rebalanceRulesInput.driftThresholdBps);
  const validDrift =
    Number.isInteger(driftThresholdBps) &&
    driftThresholdBps >= 100 &&
    driftThresholdBps <= 5000
      ? driftThresholdBps
      : 500; // default 5%
  const schedule = ["none", "weekly", "monthly"].includes(
    String(rebalanceRulesInput.schedule),
  )
    ? (String(rebalanceRulesInput.schedule) as RebalanceRules["schedule"])
    : "none";

  return {
    id,
    name,
    ticker,
    description,
    category,
    allocations,
    rebalanceRules: { driftThresholdBps: validDrift, schedule },
    createdAt,
    updatedAt,
    isCustom: true,
    creatorName,
    creatorSocial,
  };
}
