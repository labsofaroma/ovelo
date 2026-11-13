import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [tailwindcss()],
  // Self-hosted fonts and issuer logos live in the web app's public folder.
  publicDir: resolve(import.meta.dirname, "../../../apps/web/public"),
});
