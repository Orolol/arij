import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // The React Compiler stops on a function it cannot compile, and the
      // plugin's preset keeps the three categories that describe a stop
      // switched off — so a component nobody read and a clean one both
      // reported zero errors. These three are the diagnostic. Read a `todo`
      // by where the compiler raised it: a stop while lowering (a `finally`
      // clause, a `throw` inside `try/catch`, a `try` without `catch`) or a
      // rule suppression comes BEFORE the validations, so every
      // compiler-backed rule above is silent on that whole function; a value
      // block (`??`, `?.`, a ternary) inside `try/catch` is raised after them,
      // in `buildReactiveFunction`, so the rules still report and only the
      // optimisation is lost — measured: `set-state-in-effect` fires beside
      // that todo. Warnings, not errors: the gate is
      // `__tests__/react-compiler-coverage.test.ts`, which fails on any
      // silent function not recorded there with a reason.
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
