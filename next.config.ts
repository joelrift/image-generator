import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Uploads are posted as multipart FormData to the route handlers in app/api/*.
  // Keep this in sync with MAX_UPLOAD_BYTES in lib/validate.ts.
  experimental: {
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
};

export default nextConfig;
