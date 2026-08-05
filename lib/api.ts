import { NextResponse } from 'next/server';
import { ProviderNotImplementedError, ProviderRequestError } from './providers/types';
import { HttpError } from './validate';

/**
 * One error funnel for every route handler, so failures look the same
 * everywhere and provider errors never leak a stack trace to the browser.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // Scaffolded-but-unwired provider method: 501, message kept — it names the
  // phase that implements the missing piece, which is useful in the UI.
  if (error instanceof ProviderNotImplementedError) {
    return NextResponse.json({ error: error.message }, { status: 501 });
  }

  /*
   * The upstream provider refused or failed the request. The message is written
   * for the operator, so it is passed through even in production — "the provider
   * rejected the API key" or "content policy blocked this prompt" is actionable
   * in a way a generic failure is not. The detail, which can carry request
   * internals, stays in the server log.
   */
  if (error instanceof ProviderRequestError) {
    if (error.detail) console.error('[api] provider request failed:', error.detail);
    return NextResponse.json({ error: error.message }, { status: error.status });
  }

  // Anything else is unexpected. Log the detail server-side, return something
  // generic — an upstream provider error can contain request internals.
  console.error('[api] unhandled error', error);
  const message =
    error instanceof Error && process.env.NODE_ENV !== 'production'
      ? error.message
      : 'Something went wrong. Please try again.';
  return NextResponse.json({ error: message }, { status: 500 });
}
