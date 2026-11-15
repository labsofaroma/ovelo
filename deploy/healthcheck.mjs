// Phase H: the Docker HEALTHCHECK. Asks the liveness route on loopback (a process check: no
// external calls). In cloudflare proxy mode it sends the origin secret, read from the container's
// own environment (never on a command line, never printed). Exit 0 healthy, 1 not.
const port = process.env.PORT || "3000";
const headers = {};
if (
  process.env.AROMA_PROXY_MODE === "cloudflare" &&
  process.env.AROMA_ORIGIN_SECRET
)
  headers["x-aroma-origin"] = process.env.AROMA_ORIGIN_SECRET;

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health/live`, {
    headers,
    signal: AbortSignal.timeout(3_000),
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
}
