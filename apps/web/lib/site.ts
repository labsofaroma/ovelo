export function siteUrl(): URL {
  const configured =
    process.env.AROMA_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  const url = new URL(configured);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new Error("AROMA_SITE_URL must be a public site origin.");
  return new URL(url.origin);
}
export const supportEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
  process.env.AROMA_SUPPORT_EMAIL ?? "",
)
  ? process.env.AROMA_SUPPORT_EMAIL
  : null;
export const projectIssuesUrl = /^https:\/\/[^\s]+$/.test(
  process.env.AROMA_ISSUES_URL ?? "",
)
  ? process.env.AROMA_ISSUES_URL
  : null;
export const operatorName =
  process.env.AROMA_OPERATOR_NAME || "the Aroma project contributors";
