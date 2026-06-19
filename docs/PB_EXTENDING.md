# Extending PocketBase

PocketBase can be extended with custom server-side logic in **Go** or **JavaScript** while staying a portable single binary.

- **Go** — better docs, more control, access to Go libraries, but more verbose. Best if you know Go or have heavy/custom logic.
- **JavaScript** — a thin wrapper over the Go APIs (similar performance) embedded via the [goja](https://github.com/dop251/goja) ES5 engine. Best for quick extensions; you can migrate to Go later.

## Capabilities

Both runtimes support custom routes, event hooks, and console commands.

```javascript
// Custom route
routerAdd("GET", "/hello/{name}", (e) => {
  return e.json(200, { message: "Hello " + e.request.pathValue("name") });
});

// Event hook — defaults status to "pending" for non-superusers
onRecordCreateRequest((e) => {
  if (!e.hasSuperuserAuth()) e.record.set("status", "pending");
  e.next();
}, "posts");

// Console command
$app.rootCmd.addCommand(new Command({
  use: "hello",
  run: (cmd, args) => console.log("Hello world!"),
}));
```

## Record hooks

`onRecordCreate` / `onRecordUpdate` fire for every save (e.g. `$app.save()`). Pass collection names to scope them:

```javascript
onRecordCreate((e) => {
  // e.app, e.record
  e.next();
}, "users", "articles"); // omit args to fire for all collections
```

- Code **before** `e.next()` runs before validation and the DB write.
- Code **after** `e.next()` runs after validation and the write.
- Successful execution does **not** guarantee persistence — the wrapping transaction may not be committed yet. For confirmed persistence bind to `onRecordAfterCreateSuccess` / `onRecordAfterCreateError` (and the Update equivalents).

## JavaScript engine notes

Put `*.pb.js` files in the `pb_hooks/` directory next to the executable; they load in filename sort order and auto-reload on change (UNIX only).

**API differences from Go:** exported names become camelCase (`app.FindRecordById` → `$app.findRecordById`), and errors are thrown as JS exceptions rather than returned.

**Common globals:** `$app` (app instance), `$apis.*` (routing helpers/middleware), `$os.*` (OS primitives), `$security.*` (JWT, random, AES), `__hooks` (absolute path to `pb_hooks`). Full list in the JSVM reference docs.

**Types / editor support:** declarations live in `pb_data/types.d.ts`. Reference them at the top of a file (rename to `.pb.ts` if linting still doesn't kick in):

```javascript
/// <reference path="../pb_data/types.d.ts" />
```

**Handler isolation:** each handler is serialized and run in its own context, so it can't see variables/functions declared outside it (this also makes stack-trace line numbers unreliable). Share code via local CJS modules loaded *inside* the handler:

```javascript
onBootstrap((e) => {
  e.next();
  const utils = require(`${__hooks}/utils.js`);
  utils.hello("world");
});
```

- Relative paths resolve against the CWD, not `pb_hooks` — use `__hooks` for absolute paths.
- Only CommonJS (`require`) is supported; precompile ESM deps with a bundler. Loaded modules share one registry — avoid mutating them (concurrency).

**Performance & limits:** This is not Node or a browser — `window`, `fs`, `fetch`, `buffer`, etc. are unavailable. A pool of 15 prewarmed runtimes keeps handler latency near Go (`--hooksPool=50` to grow it). Prefer Go bindings (e.g. `$security.randomString(10)`) for heavy compute. goja is mostly ES6 but not fully spec-compliant: no `setTimeout`/`setInterval`, and DB JSON fields require `get()`/`set()` helpers.
