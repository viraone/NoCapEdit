/**
 * Delays before automatic autosave retries, in milliseconds. The first retry
 * comes soon enough to feel automatic, then each one waits longer so a storage
 * failure does not spin, settling at one try every 30 s for as long as the tab
 * stays open.
 */
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

/** The delay after the last listed step, used for every retry from then on. */
const RETRY_DELAY_MAX_MS = 30_000;

/** Delay before retry `attempt` (0 = the first retry): 2 s, 5 s, 15 s, then every 30 s. */
export function nextRetryDelay(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return RETRY_DELAYS_MS[0];
  return RETRY_DELAYS_MS[Math.floor(attempt)] ?? RETRY_DELAY_MAX_MS;
}
