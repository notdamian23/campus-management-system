const js = require("@eslint/js");
const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = [
  ...compat.config({
    env: {
      es6: true,
      node: true,
    },
    extends: [
      "eslint:recommended",
      "plugin:import/errors",
      "plugin:import/warnings",
      "plugin:import/typescript",
      "google",
      "plugin:@typescript-eslint/recommended",
    ],
    parser: "@typescript-eslint/parser",
    parserOptions: {
      project: ["tsconfig.json", "tsconfig.dev.json"],
      sourceType: "module",
    },
    ignorePatterns: [
      "/lib/**/*",
      "/generated/**/*",
    ],
    plugins: ["@typescript-eslint", "import"],
    rules: {
      quotes: ["error", "double"],
      "import/no-unresolved": 0,
      indent: ["error", 2],
      "linebreak-style": "off",
    },
  }),
];
