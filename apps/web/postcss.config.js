// Tailwind v3 (prototype) and v4 (packages/ui, new route groups) run side by side.
// See postcss/tailwind-router.cjs for how they are kept apart and docs/REWRITE-PLAN.md (M1).
module.exports = {
  plugins: {
    "./postcss/tailwind-router.cjs": {},
    autoprefixer: {},
  },
};
