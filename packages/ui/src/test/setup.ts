import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";
import * as axeMatchers from "vitest-axe/matchers";

expect.extend(axeMatchers);
afterEach(cleanup);

// jsdom has no layout engine or PointerEvent: stub what Base UI's positioning, observers and
// keyboard activation read. Node-environment test files skip this.
function installDomStubs(): void {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventStub extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
  }
  if (typeof globalThis.ResizeObserver === "undefined") {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver =
      ResizeObserverStub as unknown as typeof ResizeObserver;
  }
  Element.prototype.scrollIntoView ??= () => {};
  installCanvasStub();
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/**
 * jsdom has no canvas (it logs "Not implemented: HTMLCanvasElement.prototype.getContext" and
 * returns null). axe's icon-ligature check draws text on a 2D canvas to decide whether a glyph is
 * an icon font ligature; with no context it threw inside axe and printed an error per test.
 * This stub draws every glyph as the same solid pixels at a width proportional to its length, so
 * axe always concludes "ordinary text, not a ligature". That is the conservative answer: the text
 * stays subject to every text rule instead of being skipped as an icon.
 */
function installCanvasStub(): void {
  type Context2D = Pick<
    CanvasRenderingContext2D,
    | "canvas"
    | "font"
    | "textAlign"
    | "textBaseline"
    | "measureText"
    | "fillText"
    | "clearRect"
    | "getImageData"
  >;
  const contexts = new WeakMap<HTMLCanvasElement, Context2D>();
  function getContext(this: HTMLCanvasElement, kind: string): Context2D | null {
    if (kind !== "2d") return null;
    const existing = contexts.get(this);
    if (existing) return existing;
    const context: Context2D = {
      canvas: this,
      font: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
      measureText: (text: string) =>
        ({ width: text.length * 10 }) as TextMetrics,
      fillText: () => {},
      clearRect: () => {},
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const size = Math.max(1, Math.ceil(width) * Math.ceil(height));
        return {
          data: new Uint8ClampedArray(size * 4).fill(255),
          width,
          height,
          colorSpace: "srgb",
        } as ImageData;
      },
    };
    contexts.set(this, context);
    return context;
  }
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: getContext,
  });
}

if (typeof window !== "undefined") installDomStubs();
