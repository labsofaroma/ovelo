import type { ResearchOptions } from "./types";

const resources = new Map<string, { value: unknown; expiresAt: number }>();
const resourcePending = new Map<string, Promise<unknown>>();

/** Slow-changing facts have their own bounded caches; failures are never cached. */
export async function cachedResource<T>(
  key: string,
  options: ResearchOptions,
  ttl: (value: T) => number,
  load: () => Promise<T>,
): Promise<T> {
  if (options.fetcher || options.now) return load();
  const cached = resources.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  const active = resourcePending.get(key);
  if (active) return active as Promise<T>;
  const operation = load();
  resourcePending.set(key, operation);
  try {
    const value = await operation;
    if (resources.size >= 256 && !resources.has(key))
      resources.delete(resources.keys().next().value as string);
    resources.set(key, { value, expiresAt: Date.now() + ttl(value) });
    return value;
  } finally {
    resourcePending.delete(key);
  }
}
