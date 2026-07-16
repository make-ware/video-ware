import type { NextConfig } from 'next';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The app version lives in the monorepo root package.json (managed by
// release-please); webapp/package.json stays at 0.0.0.
const { version: appVersion } = JSON.parse(
  readFileSync(resolve(process.cwd(), '..', 'package.json'), 'utf8')
) as { version: string };

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // Suppress verbose logging in production
  // Only show errors and warnings
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  // Reduce build output verbosity in production
  productionBrowserSourceMaps: false,
  // Optimize for production
  poweredByHeader: false,
  compress: true,
  transpilePackages: ['@project/shared'],
};

export default nextConfig;
