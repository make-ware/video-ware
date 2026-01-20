import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
