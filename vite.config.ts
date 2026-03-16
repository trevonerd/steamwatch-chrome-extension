import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  // CRITICAL for Chrome extensions: empty base = relative asset paths.
  // Absolute paths (default "/" base) break under chrome-extension:// protocol
  // because "/" resolves to the filesystem root, not the extension root.
  base: "",
  plugins: [
    webExtension({
      manifest: "manifest.json",
      watchFilePaths: ["manifest.json"],
      disableAutoLaunch: true,
    }),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    sourcemap: false, // No sourcemaps in distributed build
  },
});
