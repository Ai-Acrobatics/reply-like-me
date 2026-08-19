import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Source uses Node16 ESM specifiers ("./types.js") that point at .ts files.
    // Strip the extension so Vite resolves them during tests.
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: "$1" }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
