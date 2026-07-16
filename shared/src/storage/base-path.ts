import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a (possibly relative) local-storage basePath to an absolute path.
 *
 * This is the SINGLE source of truth for local storage path resolution —
 * used by LocalStorageBackend and by the worker's StorageService. In a
 * monorepo the webapp and worker run with different CWDs (webapp/ and
 * worker/), so a relative basePath like "data" MUST map to the same absolute
 * directory for every process — otherwise the webapp writes an upload to one
 * place and the worker looks for it in another. We anchor relative paths to
 * the monorepo root: the nearest ancestor with a yarn.lock or a
 * workspaces-declaring package.json.
 *
 * A previous "use the first ancestor that already contains a data/ dir"
 * heuristic diverged per-process once stray webapp/data and worker/data dirs
 * existed. Absolute basePaths (e.g. WORKER_DATA_DIR=/data/storage in Docker)
 * are used as-is; only the relative dev fallback is anchored.
 *
 * @param basePath - configured base path (absolute or relative)
 * @param cwd - directory to start the upward walk from (defaults to
 *   process.cwd(); injectable for tests)
 */
export function resolveLocalStorageBasePath(
  basePath: string,
  cwd: string = process.cwd()
): string {
  if (path.isAbsolute(basePath)) return basePath;

  // Walk up from cwd to the monorepo root and resolve there. The ignore
  // comments keep bundler file-tracing (e.g. Turbopack's NFT) from treating
  // these fs calls as dynamic requires and pulling in the whole project.
  let current = cwd;
  for (let i = 0; i < 12; i++) {
    if (isWorkspaceRoot(current)) {
      return path.resolve(/* turbopackIgnore: true */ current, basePath);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // Fallback: resolve relative to the starting directory.
  return path.resolve(/* turbopackIgnore: true */ cwd, basePath);
}

/** True if `dir` looks like the monorepo root (yarn.lock or workspaces). */
function isWorkspaceRoot(dir: string): boolean {
  try {
    if (fs.existsSync(/* turbopackIgnore: true */ path.join(dir, 'yarn.lock')))
      return true;
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(/* turbopackIgnore: true */ pkgPath)) {
      const pkg = JSON.parse(
        fs.readFileSync(/* turbopackIgnore: true */ pkgPath, 'utf8')
      ) as { workspaces?: unknown };
      if (pkg.workspaces) return true;
    }
  } catch {
    // Malformed/inaccessible markers: treat as "not root" and keep walking.
  }
  return false;
}
