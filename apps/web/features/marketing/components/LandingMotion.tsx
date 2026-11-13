"use client";

import { useEffect } from "react";

/**
 * Below-the-fold reading text fades upward once on approach (.21st/DESIGN.md). GSAP is imported
 * only here, only after mount, and only when motion is allowed, so it is never in first-load JS
 * and never delays the hero. Elements already on screen are left alone (no flash, no LCP cost).
 */
export default function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const targets = [
      ...document.querySelectorAll<HTMLElement>("[data-reveal]"),
    ].filter(
      (element) => element.getBoundingClientRect().top > window.innerHeight,
    );
    if (!targets.length) return;

    let observer: IntersectionObserver | undefined;
    let cancelled = false;
    void import("gsap").then(({ gsap }) => {
      if (cancelled) return;
      gsap.set(targets, { autoAlpha: 0, y: 24 });
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            gsap.to(entry.target, {
              autoAlpha: 1,
              y: 0,
              duration: 0.6,
              ease: "power2.out",
              clearProps: "transform,visibility,opacity",
            });
          }
        },
        { rootMargin: "0px 0px -10% 0px" },
      );
      targets.forEach((target) => observer?.observe(target));
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      // Never leave content hidden if the page unmounts mid-animation.
      targets.forEach((target) => {
        target.style.removeProperty("opacity");
        target.style.removeProperty("visibility");
        target.style.removeProperty("transform");
      });
    };
  }, []);
  return null;
}
