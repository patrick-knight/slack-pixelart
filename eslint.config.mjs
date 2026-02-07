import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/", "package*.json", "eslint.config.mjs"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        chrome: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
      "no-undef": "error",
    },
  },
  {
    files: ["content.js"],
    languageOptions: {
      globals: {
        boot_data: "readonly",
      },
    },
  },
  {
    files: ["pixelart.js"],
    languageOptions: {
      globals: {
        module: "readonly",
      },
    },
  },
];
