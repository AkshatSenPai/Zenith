import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        zenith: {
          // Themed via CSS vars (space-separated RGB channels) keyed by data-skin, so every
          // text-zenith-*/bg-zenith-*/border-zenith-* utility auto-themes and /opacity works.
          // See app/globals.css for the per-skin var blocks. Arc keeps today's exact values.
          bg: "rgb(var(--zenith-bg) / <alpha-value>)",
          cyan: "rgb(var(--zenith-cyan) / <alpha-value>)",
          blue: "rgb(var(--zenith-blue) / <alpha-value>)",
          text: "rgb(var(--zenith-text) / <alpha-value>)",
          alert: "rgb(var(--zenith-alert) / <alpha-value>)",
          red: "rgb(var(--zenith-red) / <alpha-value>)",
          scan: "#2EE6A6", // unchanged (not themed)
          // v7 text hierarchy + structural tokens (per-skin CSS vars in globals.css)
          hi: "rgb(var(--c-hi) / <alpha-value>)",
          mid: "rgb(var(--c-mid) / <alpha-value>)",
          lo: "rgb(var(--c-lo) / <alpha-value>)",
          dim: "rgb(var(--c-dim) / <alpha-value>)",
          faint: "rgb(var(--c-faint) / <alpha-value>)",
          line: "var(--line)",
          line2: "var(--line2)",
          panel: "var(--panel)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
