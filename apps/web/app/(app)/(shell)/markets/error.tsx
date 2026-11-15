"use client";

import {
  RouteError,
  type RouteErrorProps,
} from "@/features/shared/components/RouteError";
import { routes } from "@/features/shared/routes";

export default function MarketsError(props: RouteErrorProps) {
  return (
    <RouteError
      {...props}
      title="Markets could not be loaded"
      escape={{ href: routes.home, label: "Go to the home page" }}
    />
  );
}
