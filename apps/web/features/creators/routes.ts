import { V1 } from "../shared/routes";

/**
 * Creator routes, kept here rather than in features/shared/routes.ts so M5a stays additive while
 * M4 is in flight. Fold into `routes` when the branches meet.
 */
export const creatorRoutes = {
  directory: `${V1}/creators`,
  builder: `${V1}/basket/new`,
} as const;
