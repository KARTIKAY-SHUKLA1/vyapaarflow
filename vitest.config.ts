import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      SESSION_SECRET: "test-secret-test-secret-test-secret-0123456789",
      DATABASE_URL: ":memory:",
      // Tests never call a real model, whatever is exported in the developer shell.
      AI_PROVIDER: "none",
      ANTHROPIC_API_KEY: "",
      AI_BASE_URL: "",
      AI_MODEL: "",
    },
  },
});
