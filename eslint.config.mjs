import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/**",
  ]),
  // The desktop shell's preload must be CommonJS (a sandboxed Electron preload cannot be an ES module).
  { files: ["desktop/**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
]);

export default eslintConfig;
