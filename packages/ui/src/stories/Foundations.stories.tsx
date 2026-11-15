import { useEffect, useState } from "react";
import { Themes } from "./helpers";
import {
  COLOR_ROLES,
  DURATIONS,
  RADII,
  SHADOWS,
  SPACES,
  TEXT_SIZES,
  Z_LAYERS,
} from "./token-lists";

export default { title: "Foundations" };

const heading = "text-small font-semibold text-muted";

/** Reads a duration token and prints it in ms ("320ms"), whatever unit the CSS minifier chose. */
function readDuration(name: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
  return `${Number(ms.toFixed(3))}ms`;
}

function ColorGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {COLOR_ROLES.map((role) => (
        <div key={role} className="flex flex-col gap-1.5">
          <div
            className="h-14 rounded-control border border-line"
            style={{ background: `var(--ovelo-${role})` }}
          />
          <code className="text-caption text-ink">--ovelo-{role}</code>
        </div>
      ))}
    </div>
  );
}

export const Colors = () => (
  <Themes>
    <ColorGrid />
  </Themes>
);

export const Typography = () => (
  <div className="flex flex-col gap-4" data-testid="type-scale">
    <p className={heading}>
      Manrope (self-hosted), with tabular numerals for financial figures.
    </p>
    {TEXT_SIZES.map(([name, px]) => (
      <div
        key={name}
        className="flex items-baseline gap-4 border-b border-line pb-3"
      >
        <code className="w-36 shrink-0 text-caption text-muted">
          text-{name} · {px}
        </code>
        <span style={{ fontSize: `var(--ovelo-text-${name})` }}>
          Own real stocks from your wallet
        </span>
      </div>
    ))}
    <div className="flex items-baseline gap-4">
      <code className="w-36 shrink-0 text-caption text-muted">
        tabular-nums
      </code>
      <span className="tabular-nums text-title">
        0123456789 · 1,111.11 · 8,888.88 (demo digits)
      </span>
    </div>
    <div className="flex items-baseline gap-4">
      <code className="w-36 shrink-0 text-caption text-muted">font-serif</code>
      <span className="font-serif text-title italic">
        Editorial accent, local to marketing
      </span>
    </div>
  </div>
);

export const Spacing = () => (
  <div className="flex flex-col gap-3">
    <p className={heading}>
      4px base. --ovelo-space-N equals Tailwind's N step (p-4 = 16px).
    </p>
    {SPACES.map((step) => (
      <div key={step} className="flex items-center gap-4">
        <code className="w-32 shrink-0 text-caption text-muted">
          space-{step} · {step * 4}px
        </code>
        <div
          className="h-4 rounded-badge bg-accent"
          style={{ width: `var(--ovelo-space-${step})` }}
        />
      </div>
    ))}
  </div>
);

export const Radius = () => (
  <Themes>
    <div className="flex flex-wrap gap-4">
      {RADII.map((name) => (
        <div key={name} className="flex flex-col items-center gap-2">
          <div
            className="size-20 border border-border-strong bg-raised"
            style={{ borderRadius: `var(--ovelo-radius-${name})` }}
          />
          <code className="text-caption">radius-{name}</code>
        </div>
      ))}
    </div>
  </Themes>
);

export const Shadow = () => (
  <Themes>
    <div className="flex flex-wrap gap-6">
      {SHADOWS.map((name) => (
        <div key={name} className="flex flex-col items-center gap-3">
          <div
            className="size-24 rounded-panel border border-line bg-surface"
            style={{ boxShadow: `var(--ovelo-shadow-${name})` }}
          />
          <code className="text-caption">shadow-{name}</code>
        </div>
      ))}
    </div>
  </Themes>
);

export const ZIndex = () => (
  <ol className="flex flex-col gap-2" aria-label="Z-index layers, lowest first">
    {Z_LAYERS.map((layer) => (
      <li key={layer} className="flex gap-3 text-small">
        <code className="w-40 text-muted">z-{layer}</code>
        <code data-z={layer}>{layer}</code>
      </li>
    ))}
  </ol>
);

/**
 * Live motion tokens: values are read from the document, so with `prefers-reduced-motion:
 * reduce` every duration visibly reads 0.01ms and the bar below jumps instead of gliding.
 */
export const Motion = () => {
  const [moved, setMoved] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setValues(
      Object.fromEntries(
        DURATIONS.map((name) => [
          name,
          readDuration(`--ovelo-duration-${name}`),
        ]),
      ),
    );
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <p className={heading} data-testid="motion-mode">
        prefers-reduced-motion:{" "}
        {reduced ? "reduce (durations collapsed)" : "no-preference"}
      </p>
      <table className="w-full max-w-md text-small">
        <caption className="sr-only">Motion duration tokens</caption>
        <thead>
          <tr>
            <th scope="col" className="py-1 text-left text-caption text-muted">
              Token
            </th>
            <th scope="col" className="py-1 text-left text-caption text-muted">
              Value now
            </th>
          </tr>
        </thead>
        <tbody>
          {DURATIONS.map((name) => (
            <tr key={name} className="border-t border-line">
              <td className="py-1.5">
                <code>--ovelo-duration-{name}</code>
              </td>
              <td
                className="py-1.5 tabular-nums"
                data-testid={`duration-${name}`}
              >
                {values[name] ?? "…"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => setMoved((v) => !v)}
        className="focus-ring w-fit rounded-control border border-border-strong px-4 py-2 text-small font-semibold"
      >
        Move the bar (uses motion-slow)
      </button>
      <div className="h-3 w-full max-w-md rounded-full bg-raised">
        <div
          data-testid="motion-bar"
          className="h-3 w-1/4 rounded-full bg-accent transition-transform motion-slow"
          style={{ transform: moved ? "translateX(300%)" : "none" }}
        />
      </div>
    </div>
  );
};
