import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "public/assets/**",
      "assets-source/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node scripts and services run with the Node globals available.
    files: ["**/*.mjs", "**/*.cjs", "services/**/*.ts", "tools/**/*.ts", "packages/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["apps/game/**/*.ts", "apps/site/**/*.ts", "apps/site/**/*.tsx"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
    },
  },
  {
    // Guardrail for CLAUDE.md: the server-safe simulation may not reach for
    // renderer, DOM or Electron APIs.
    files: ["packages/multiplayer-sim/**/*.ts", "packages/game-core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@babylonjs/*", "electron", "electron/*"],
              message: "multiplayer-sim and game-core must stay renderer-free (CLAUDE.md).",
            },
          ],
        },
      ],
    },
  },
];
