import { z } from "zod";
import { fixedSchema } from "../shared/fixed";

/** GET /api/v1/prices response: observed prices with one source and one observation time. */
export const pricesResponseSchema = z.object({
  source: z.literal("Jupiter Price V3"),
  observedAt: z.string(),
  prices: z.array(z.object({ mint: z.string(), price: fixedSchema })),
});
export type PricesResponse = z.infer<typeof pricesResponseSchema>;
