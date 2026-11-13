/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.tsx",
  viteConfig: ".ladle/vite.config.ts",
  addons: {
    // Light/dark switcher drives `data-theme` on <html>, matching tokens.css.
    theme: { enabled: true, defaultState: "light" },
    a11y: { enabled: false },
    width: { enabled: true },
    mode: { enabled: true },
    rtl: { enabled: false },
    source: { enabled: true },
    control: { enabled: true },
    ladle: { enabled: true },
  },
};
