import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-plugin-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/server/routers/**"],
    },
  },
});
