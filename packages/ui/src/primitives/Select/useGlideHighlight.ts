import { useEffect, useRef, useState } from "react";

export interface HighlightBox {
  top: number;
  height: number;
}

/**
 * Tracks the highlighted (keyboard/hover) or selected option inside `list` so a single
 * element can glide between rows. `remember` restores the last position on reopen.
 */
export function useGlideHighlight(remember: boolean) {
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState<HighlightBox | null>(null);
  const last = useRef<HighlightBox | null>(null);

  useEffect(() => {
    if (!list) return;
    const update = () => {
      const item =
        list.querySelector<HTMLElement>("[data-highlighted]") ??
        list.querySelector<HTMLElement>("[data-selected]");
      if (!item) {
        setBox(null);
        return;
      }
      // offsetTop is relative to the scrolling list, so it stays right while options scroll.
      const next = { top: item.offsetTop, height: item.offsetHeight };
      last.current = next;
      setBox((prev) =>
        prev?.top === next.top && prev.height === next.height ? prev : next,
      );
    };
    const mutations = new MutationObserver(update);
    mutations.observe(list, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["data-highlighted", "data-selected"],
    });
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    resize?.observe(list);
    update();
    return () => {
      mutations.disconnect();
      resize?.disconnect();
    };
  }, [list]);

  return {
    setList,
    box,
    onOpen: () => setBox(remember ? last.current : null),
  };
}
