/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export", // static HTML/JS/CSS in ./out — Tauri bundles this (pure client SPA, no SSR/API routes)
};

export default nextConfig;
