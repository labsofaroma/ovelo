"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@ovelo/ui";
import type { PriceChartProps } from "./PriceChart";

/**
 * Lazy client island: the chart code is a separate chunk loaded after the page shell, so it is
 * not part of first-load JS. `ssr: false` because it has no meaningful static form; the server
 * renders the sourced summary line next to it instead.
 */
const PriceChart = dynamic(() => import("./PriceChart"), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

export function PriceChartLazy(props: PriceChartProps) {
  return <PriceChart {...props} />;
}
