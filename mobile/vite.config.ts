import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: resolve(root, "../work/mobile-pwa"),
    emptyOutDir: true,
    target: "es2020",
    minify: "esbuild",
    assetsInlineLimit: 100_000_000,
  },
  worker: {
    format: "iife",
  },
});
