import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // The React Compiler stops on a function it cannot compile — a
      // `finally` clause, a `throw` inside `try/catch`, an `eslint-disable` of
      // `exhaustive-deps`, state derived in an effect — and from then on every
      // compiler-backed rule above is silent on that whole component, with
      // nothing to say so. The plugin's preset keeps the three categories that
      // describe the stop switched off; these are the diagnostic. Warnings,
      // not errors: the gate is `__tests__/react-compiler-coverage.test.ts`,
      // which fails on any stop not recorded there with a reason.
      "react-hooks/todo": "warn",
      "react-hooks/rule-suppression": "warn",
      "react-hooks/no-deriving-state-in-effects": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    // Playwright fixtures hand their value to a callback named `use`, which
    // the React hooks rule reads as a hook called outside a component. No file
    // under e2e/ renders React at all, so the rule has nothing to check here.
    files: ["e2e/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Agent worktrees and runtime data contain independent or historical
    // source trees; lint this checkout, as the Vitest exclude list does.
    ".claude/**",
    "projects/**",
    "data/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
