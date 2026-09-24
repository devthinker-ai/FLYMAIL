import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      react: "preact/compat",
      "react-dom": "preact/compat",
    },
  },
  server: {
    port: 5176,
    strictPort: true,
    proxy: {
      // Dev CORS dodge: browser → /ollama/* → localhost:11434/*
      "/ollama": {
        target: "http://127.0.0.1:11434",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ollama/, ""),
      },
      // Live inbox: browser → /mail/* → localhost mail companion
      "/mail": {
        target: "http://127.0.0.1:5177",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mail/, ""),
      },
    },
  },
  preview: {
    port: 5176,
    strictPort: true,
    proxy: {
      "/mail": {
        target: "http://127.0.0.1:5177",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/mail/, ""),
      },
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  // Large binary assets served from public/; no special handling needed.
  // Ensure brain.bin symlink is followed when copying to dist.
  plugins: [
    {
      name: "copy-brain-bin-symlink",
      async closeBundle() {
        const fs = await import("node:fs/promises");
        const src = resolve("public/brain.bin");
        const dest = resolve("dist/brain.bin");
        try {
          await fs.access(dest);
        } catch {
          // If vite didn't follow the symlink into dist, hard-copy/link it.
          try {
            await fs.copyFile(src, dest);
          } catch {
            // ignore — may already exist as symlink target
          }
        }
      },
    },
  ],
});
