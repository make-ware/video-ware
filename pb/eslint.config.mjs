// ESLint flat config for the PocketBase workspace.
//
// The rule here enforces the "self-contained handler" discipline that
// pb_hooks/*.pb.js must follow: PocketBase runs each hook/cron handler in an
// isolated goja runtime drawn from a pool, and the file's TOP-LEVEL scope only
// exists during startup registration. Anything declared at the top level —
// `const`/`let`/`var`, `function`, or `class` — is NOT visible to a handler
// body at execution time, and top-level names collide across files sharing that
// registration scope (the "duplicate-const collision" that forced per-handler
// PAGE/threshold constants in cron-tasks-watchdog and hook-media-delete). So
// every constant, helper, and class a handler uses must be declared INSIDE its
// callback.
//
// The only legitimate top-level declaration is a self-contained function passed
// *directly* as a handler reference (PocketBase serializes that function's own
// source into the pool), e.g. hook-uploads-create's `onUploadSaved`, registered
// for both create and update. That single case opts out with an inline
// `// eslint-disable-next-line no-restricted-syntax -- <reason>`. The
// hook-registration calls themselves (cronAdd(...), onRecord*(...),
// routerAdd(...), ...) are expression statements and are not matched below.

const HOOK_SCOPE_MESSAGE =
  'PocketBase runs each hook/cron handler in an isolated goja runtime; the ' +
  "file's top-level scope only exists during startup registration. Declare " +
  'this INSIDE the handler callback instead — top-level declarations are not ' +
  'visible to handlers at execution time and collide across the runtime pool. ' +
  '(A self-contained function passed directly as a handler may opt out with an ' +
  'inline eslint-disable-next-line no-restricted-syntax comment.)';

export default [
  {
    ignores: [
      '**/node_modules/**',
      'pb_data/**',
      'pb_migrations/**',
      'pocketbase',
      'scripts/**',
    ],
  },
  {
    files: ['pb_hooks/**/*.pb.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      // goja executes these as plain scripts, not ES modules.
      sourceType: 'script',
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > VariableDeclaration',
          message: HOOK_SCOPE_MESSAGE,
        },
        {
          selector: 'Program > FunctionDeclaration',
          message: HOOK_SCOPE_MESSAGE,
        },
        {
          selector: 'Program > ClassDeclaration',
          message: HOOK_SCOPE_MESSAGE,
        },
      ],
    },
  },
];
