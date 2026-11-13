export type ClassValue = string | false | null | undefined;

/** Joins class names, skipping falsy values. Consumer classes go last so they can extend. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
