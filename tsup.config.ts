import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    supabase: "src/supabase.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: true,
  target: "es2020",
});
