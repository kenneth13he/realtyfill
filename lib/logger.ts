// lib/logger.ts
// Structured server-side error logging — no external account required to
// start. Vercel (and every host on the old shortlist: Render, Railway,
// Fly.io, a VM under systemd/pm2) captures stdout/stderr into a viewable log
// stream automatically, so this is genuinely enough to know something broke
// for a real realtor without setting up Sentry first. One JSON line per
// error keeps it greppable/filterable in whatever log viewer the host gives
// you. Swap in a real error-tracking service later by replacing this one
// function's body — every call site stays the same.
//
// Every logged error gets a short random reference. logError returns it, the
// API routes hand it to the browser, and the support form carries it back.
// Without that link a report like "generating didn't work this morning" is
// almost impossible to match to a log line; with it, `ref` is one grep.

import { randomUUID } from "crypto";

interface LogContext {
  route: string;
  userId?: string;
  dealId?: string;
  [key: string]: unknown;
}

/** Short enough for a person to read aloud or retype, long enough not to collide. */
function newRef(): string {
  return randomUUID().replace(/-/g, "").slice(0, 10);
}

/**
 * @returns the reference stamped on this log line — include it in whatever
 * the user sees, so a support request can be matched back to the logs.
 */
export function logError(context: LogContext, error: unknown): string {
  const ref = newRef();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(
    JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      ref,
      message,
      stack,
      ...context,
    })
  );
  return ref;
}

/**
 * The message to show a user when something broke on our side.
 *
 * Deliberately does not include `message`: an internal error string can name
 * tables, field ids or file paths, and this text is rendered in a browser.
 * The reference is what makes the vague wording actionable.
 */
export function userFacingError(ref: string, what = "Something went wrong on our end."): string {
  return `${what} Reference: ${ref} — include it if you contact support.`;
}

/**
 * What one model call actually cost, as a log line.
 *
 * Added because two cost estimates in a row were wrong: both were measured
 * against toy inputs ("Bob Smith is the buyer", ~230 tokens in, ~90 out) and
 * neither resembled a real PDF upload or a real deal's context. Rather than
 * estimate a third time, the app now reports its own numbers, and the log
 * shows whether the prompt cache is actually being hit in production.
 *
 * Rates are Claude Opus 5 at the time of writing; cache writes bill at 1.25x
 * input for the 5-minute TTL, reads at 0.1x. If the model or the rates
 * change, this figure drifts — it is a guide for spotting expensive paths,
 * not an invoice.
 */
export function logUsage(
  context: { route: string; model: string; userId?: string; [key: string]: unknown },
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }
): void {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;

  const usd = input / 1e6 * 5 + cacheWrite / 1e6 * 6.25 + cacheRead / 1e6 * 0.5 + output / 1e6 * 25;

  console.log(
    JSON.stringify({
      level: "usage",
      timestamp: new Date().toISOString(),
      input,
      output,
      cacheWrite,
      cacheRead,
      // Zero here on a repeat call means the cache is not being hit and the
      // prefix has a breaker in it.
      cacheHit: cacheRead > 0,
      estimatedUsd: Number(usd.toFixed(5)),
      ...context,
    })
  );
}

