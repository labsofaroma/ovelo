import { z } from "zod";

/**
 * Sentry DSN schema (REWRITE-PLAN §7.3 W4). A Sentry DSN carries its public key as URL userinfo
 * (`https://<public key>@o<org>.ingest[.<region>].sentry.io/<project>`), so the generic
 * `httpsUrl` rule (no credentials in URLs) cannot validate it. This schema accepts that shape
 * and nothing else:
 *
 * - `https:` only, no port, no query, no fragment;
 * - exactly one userinfo part: the 32-hex public key, with no password (`key:secret@` and the
 *   legacy secret-key DSNs are refused);
 * - the host is `o<digits>.ingest.sentry.io` or `o<digits>.ingest.<region>.sentry.io`;
 * - the path is the numeric project id.
 *
 * The public key is public by design (it ships in the browser bundle). Values are never echoed.
 */

const HOST = /^o\d{1,20}\.ingest(\.[a-z]{2,10})?\.sentry\.io$/;
const PUBLIC_KEY = /^[0-9a-f]{32}$/;
const PROJECT_PATH = /^\/\d{1,20}$/;
const MESSAGE =
  "must be a Sentry DSN: https://<public key>@o<org>.ingest[.<region>].sentry.io/<project>";

/** True when `value` is exactly a Sentry ingest DSN (see the module comment). Pure. */
export function isSentryDsn(value: string): boolean {
  if (value !== value.trim() || /\s/.test(value)) return false;
  // One "@" exactly, before the host: rejects `a@b@host` before URL parsing re-encodes it.
  const scheme = "https://";
  if (!value.startsWith(scheme)) return false;
  const authority = value.slice(scheme.length).split("/")[0] ?? "";
  if (authority.split("@").length !== 2) return false;
  if (authority.split("@")[0]!.includes(":")) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    PUBLIC_KEY.test(url.username) &&
    url.password === "" &&
    HOST.test(url.hostname) &&
    url.port === "" &&
    PROJECT_PATH.test(url.pathname) &&
    url.search === "" &&
    url.hash === "" &&
    !value.includes("?") &&
    !value.includes("#")
  );
}

export const sentryDsn = z.string().refine(isSentryDsn, { message: MESSAGE });
