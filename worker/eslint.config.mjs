import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
  // Global ignores
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.yarn/**",
      "**/.pnp.*",
      "**/src/task-recommendations/**",
    ]
  },

  // Base JavaScript configuration
  js.configs.recommended,

  // JavaScript files (Node.js environment)
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        // Node.js globals
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
  },

  // TypeScript configuration
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        // Node.js globals
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        require: "readonly",
        module: "readonly",
        exports: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": typescript,
    },
    rules: {
      ...typescript.configs.recommended.rules,
      // NestJS-friendly rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // Allow unused constructor parameters (common in NestJS DI)
          args: "after-used",
          ignoreRestSiblings: true
        }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow empty constructors (NestJS uses DI)
      "@typescript-eslint/no-useless-constructor": "off",
      // Allow parameter properties (NestJS uses this pattern)
      "@typescript-eslint/no-parameter-properties": "off",
      // Allow non-null assertions (sometimes needed in NestJS)
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Allow empty interfaces (NestJS uses these for typing)
      "@typescript-eslint/no-empty-interface": "off",
      // Allow require statements (NestJS modules sometimes use this)
      "@typescript-eslint/no-require-imports": "off",
      // Standard JavaScript rules
      "prefer-const": "error",
      "no-var": "error",
      "no-undef": "off", // Turn off no-undef for TypeScript files as TypeScript handles this
      "no-console": "off",
      // Allow unused expressions for decorators
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": ["error", {
        allowShortCircuit: true,
        allowTernary: true
      }]
    }
  },

  // Test files configuration (more lenient)
  {
    files: ["**/*.spec.ts", "**/*.test.ts", "**/test/**/*.ts", "**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off", // Tests often use 'any' for mocks
      "@typescript-eslint/no-non-null-assertion": "off" // Tests often use non-null assertions
    }
  }
];

