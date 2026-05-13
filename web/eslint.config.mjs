import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**",
      "public/**",
      "tsconfig.tsbuildinfo",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@next/next/no-img-element": "off",
      "no-restricted-imports": ["error", {
        paths: [{
          name: "./layers",
          importNames: ["addRiskLayer"],
          message: "Risklagret är dormant by design. Se docs/decisions.md 2026-05-11 och 2026-05-13 innan återaktivering.",
        }],
      }],
    },
  },
];

export default eslintConfig;
