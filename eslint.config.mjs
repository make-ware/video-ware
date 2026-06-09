import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/out/**",
      "**/coverage/**",
      "**/.yarn/**",
      "**/.pnp.*",
      "**/next-env.d.ts",
      "pb/**",
      "scripts/**"
    ]
  },

  // Base JavaScript configuration
  js.configs.recommended,

  // TypeScript configuration
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        // Node.js globals
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        // TypeScript globals
        React: "readonly",
        JSX: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": typescript
    },
    rules: {
      ...typescript.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "error",
      "no-var": "error",
      "no-undef": "off" // Turn off no-undef for TypeScript files as TypeScript handles this
    }
  },

  // React/Next.js files
  {
    files: ["webapp/**/*.{jsx,tsx}", "app/**/*.{jsx,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      react: react
    },
    settings: {
      react: {
        version: "detect"
      }
    },
    languageOptions: {
      globals: {
        React: "readonly",
        JSX: "readonly"
      }
    },
    rules: {
      // Compiler-aware Rules of React (eslint-plugin-react-hooks v7
      // recommended-latest): adds mutation-during-render and related checks
      // the older two-rule config skipped.
      ...reactHooks.configs["recommended-latest"].rules,
      "react/react-in-jsx-scope": "off", // Not needed in Next.js 13+
      "react/no-unescaped-entities": "off",
      // Missing-dependency bugs should fail CI, not ship as warnings.
      "react-hooks/exhaustive-deps": "error",
      // Inline-constructed context provider values re-render every consumer on
      // every provider render — flag them so they get memoized.
      "react/jsx-no-constructed-context-values": "error"
    }
  },

  // Browser environment for app
  {
    files: ["app/**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        HTMLElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLDivElement: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        Event: "readonly"
      }
    }
  },

  // Node.js environment for shared workspace
  {
    files: ["shared/**/*.{js,ts}"],
    languageOptions: {
      globals: {
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly"
      }
    },
    rules: {
      "no-console": "off"
    }
  }
];