import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: "work/portable-build",
    emptyOutDir: true,
    target: "es2020",
    minify: "esbuild",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    lib: {
      entry: "portable/entry.tsx",
      name: "FanoronaPortable",
      formats: ["iife"],
      fileName: () => "app.js",
    },
  },
  worker: {
    format: "iife",
  },
});
