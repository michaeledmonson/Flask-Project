import type { Config } from "tailwindcss";

// Tier color tokens (DESIGN.md §6). Listed in `safelist` because tier classes are
// looked up by key at runtime rather than written literally in JSX.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tier: {
          "very-high": "#b91c1c",
          high: "#c2410c",
          moderate: "#b45309",
          low: "#4d7c0f",
          "very-low": "#15803d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
