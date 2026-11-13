"use client";

import dynamic from "next/dynamic";

/** Lazy island wrapper: the motion code (and GSAP) load in their own chunk, after hydration. */
export const LandingMotionLazy = dynamic(() => import("./LandingMotion"), {
  ssr: false,
});
