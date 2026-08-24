import { NextResponse, type NextRequest } from 'next/server';

/**
 * Access gate for a hosted deployment.
 *
 * The provider keys live in server env vars and never reach the browser; this
 * gate is the second half of that posture — it keeps anonymous visitors from
 * spending them. It is HTTP Basic Auth on purpose: no login page, no session
 * store, no cookie signing to get wrong — the browser prompts once and caches
 * the credentials for the session, and everything (pages and /api routes alike)
 * is covered.
 *
 * The gate is active only when APP_ACCESS_PASSWORD is set. Local dev and Mock
 * mode stay open; a hosted instance MUST set it (see README → Deploying).
 * Credentials are compared in constant time so the password can't be recovered
 * by timing the response.
 *
 * Served only over HTTPS in practice (Netlify/Vercel terminate TLS), so the
 * base64 Basic header is protected in transit.
 */
export function middleware(request: NextRequest): NextResponse {
  const expectedPassword = process.env.APP_ACCESS_PASSWORD;
  if (!expectedPassword) return NextResponse.next();

  // Username is optional — a shared password alone is the common office case.
  const expectedUser = process.env.APP_ACCESS_USER ?? '';

  const header = request.headers.get('authorization') ?? '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = atob(encoded);
    } catch {
      decoded = '';
    }
    const separator = decoded.indexOf(':');
    if (separator >= 0) {
      const user = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      const userOk = expectedUser === '' || timingSafeEqual(user, expectedUser);
      const passwordOk = timingSafeEqual(password, expectedPassword);
      if (userOk && passwordOk) return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="RIFT Render Studio", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}

/** Length-independent constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  // Seed the accumulator with the length difference so unequal lengths always
  // fail, without an early return that would leak length via timing.
  let mismatch = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i++) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return mismatch === 0;
}

/**
 * Gate everything except Next's static assets and the favicon — pages and API
 * routes both. Static files carry nothing sensitive and skipping them keeps the
 * gate off the hot path for chunks.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
