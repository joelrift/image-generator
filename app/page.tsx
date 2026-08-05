import Studio from '@/components/Studio';
import { resolveProviderName } from '@/lib/providers';

/**
 * Rendered per request rather than prerendered at build time.
 *
 * Without this the provider banner is baked in during `next build`: setting
 * RENDER_PROVIDER=fal and restarting would still show "Mock mode" while the API
 * routes correctly used fal. Brief §6 promises that pasting a key into
 * .env.local and restarting is enough, so this page has to read the env per
 * request. The page is tiny and has no data fetching, so the cost is nil.
 */
export const dynamic = 'force-dynamic';

/**
 * Main studio route.
 *
 * A server component so the active provider can be read from the environment
 * without exposing it as a NEXT_PUBLIC_* variable. The interactive surface lives
 * in components/Studio.tsx, which holds the state the panels share.
 */
export default function Page() {
  return <Studio providerName={resolveProviderName()} />;
}
