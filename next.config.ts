import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Uploads are posted as multipart FormData to the route handlers in
   * app/api/*. `serverActions.bodySizeLimit` does NOT apply to route handlers —
   * only to Server Actions, which this app does not use — so it is not set here.
   * The request-body ceiling is enforced in code by `readLimitedFormData`
   * (lib/validate.ts), which caps the total body before it is buffered.
   */
};

export default nextConfig;
