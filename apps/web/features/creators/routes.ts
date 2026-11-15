import { routes } from "../shared/routes";

/** Creator routes (folded into features/shared/routes.ts in M5b; kept as named aliases). */
export const creatorRoutes = {
  directory: routes.creators,
  builder: routes.builder,
  basket: routes.basket,
  /** M11: the signed-in creator's own dashboard. */
  dashboard: "/creators/dashboard",
  /** The builder pre-filled with a published basket, to publish its next version. */
  edit: (id: string) => `${routes.builder}?from=${encodeURIComponent(id)}`,
} as const;
