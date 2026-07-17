import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@lumastage/model-compat", "@lumastage/protocol"] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@lumastage/protocol"] })],
    build: {
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" }
      }
    }
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react()]
  }
});
