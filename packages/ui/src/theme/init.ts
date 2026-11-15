/** localStorage key the prototype's theme toggle used. Kept so old choices can be cleared. */
export const THEME_STORAGE_KEY = "ovelo-theme";

/** Ovelo is dark only (tokens.css has a single color block). */
export type Theme = "dark";

/**
 * Inline script that pins `data-theme="dark"` and `color-scheme: dark` before first paint, and
 * removes any light/dark choice the old toggle saved. Render it in <head> as a blocking script:
 *
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 *
 * Storage failures are swallowed so blocked storage never breaks the page. Plain ES5, no
 * dependencies, so it is safe to inline under a CSP that allows inline scripts or a nonce.
 */
export const themeInitScript = `(function(){try{var r=document.documentElement;r.setAttribute("data-theme","dark");r.style.colorScheme="dark";try{localStorage.removeItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}}catch(e){}})();`;
