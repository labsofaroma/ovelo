/** localStorage key shared with the prototype's ThemeProvider, so preferences carry over. */
export const THEME_STORAGE_KEY = "aroma-theme";

export type Theme = "light" | "dark";

/**
 * Inline script that sets `data-theme` (and color-scheme) before first paint.
 * Render it in <head> as a blocking script:
 *
 *   <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
 *
 * Order of precedence: stored choice, then prefers-color-scheme, then light. Storage and
 * matchMedia failures are swallowed so a blocked storage never breaks the page. Plain ES5,
 * no dependencies, so it is safe to inline under a CSP that allows inline scripts or a nonce.
 */
export const themeInitScript = `(function(){try{var t;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var r=document.documentElement;r.setAttribute("data-theme",t);r.style.colorScheme=t}catch(e){}})();`;
