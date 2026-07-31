/**
 * Token usage accounting for the footer's bottom-left readout.
 *
 * The SDK exposes per-session cumulative totals (`session.getUsage()`), so
 * longer windows (day/week/month/forever) are aggregated locally: on every
 * refresh we diff the session's cumulative totals against the last snapshot
 * and add the delta to a daily bucket. Buckets persist as JSON next to the
 * other client data so windows survive restarts. All I/O is best-effort —
 * a corrupt or missing file just resets the aggregates.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDataDir } from '#/utils/paths';

export type TokenUsageWindow = 'session' | 'day' | 'week' | 'month' | 'forever' | 'off';

export const TOKEN_USAGE_WINDOWS: readonly TokenUsageWindow[] = [
  'session',
  'day',
  'week',
  'month',
  'forever',
  'off',
];

export interface TokenTotals {
  readonly input: number;
  readonly output: number;
}

interface DailyBucket {
  input: number;
  output: number;
}

export interface TokenUsageStore {
  /** YYYY-MM-DD → tokens attributed to that day. */
  days: Record<string, DailyBucket>;
  /** sessionId → last seen cumulative totals (for delta computation). */
  sessions: Record<string, DailyBucket>;
}

function emptyStore(): TokenUsageStore {
  return { days: {}, sessions: {} };
}

export function tokenUsageStorePath(): string {
  return join(getDataDir(), 'token-usage.json');
}

export async function loadTokenUsageStore(
  path: string = tokenUsageStorePath(),
): Promise<TokenUsageStore> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8')) as Partial<TokenUsageStore>;
    return {
      days: raw.days ?? {},
      sessions: raw.sessions ?? {},
    };
  } catch {
    return emptyStore();
  }
}

export async function saveTokenUsageStore(
  store: TokenUsageStore,
  path: string = tokenUsageStorePath(),
): Promise<void> {
  try {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify(store), 'utf-8');
  } catch {
    // best effort — losing a day of aggregates is not an error
  }
}

export function localDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Fold the session's latest cumulative totals into today's bucket. Handles
 * the two ways the cumulative counter can shrink — compaction and session
 * forks — by treating a shrunken counter as a fresh baseline.
 */
export function recordSessionUsage(
  store: TokenUsageStore,
  sessionId: string,
  totals: TokenTotals,
  now: Date = new Date(),
): void {
  const previous = store.sessions[sessionId] ?? { input: 0, output: 0 };
  const deltaIn = totals.input >= previous.input ? totals.input - previous.input : totals.input;
  const deltaOut =
    totals.output >= previous.output ? totals.output - previous.output : totals.output;
  store.sessions[sessionId] = { input: totals.input, output: totals.output };
  if (deltaIn === 0 && deltaOut === 0) return;
  const key = localDayKey(now);
  const bucket = store.days[key] ?? { input: 0, output: 0 };
  bucket.input += deltaIn;
  bucket.output += deltaOut;
  store.days[key] = bucket;
}

function sumBuckets(store: TokenUsageStore, sinceDayKey: string | null): TokenTotals {
  let input = 0;
  let output = 0;
  for (const [day, bucket] of Object.entries(store.days)) {
    if (sinceDayKey !== null && day < sinceDayKey) continue;
    input += bucket.input;
    output += bucket.output;
  }
  return { input, output };
}

function dayKeyOffset(now: Date, offsetDays: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - offsetDays);
  return localDayKey(d);
}

/** Resolve the configured window to the totals it should display. */
export function summarizeTokenUsage(
  store: TokenUsageStore,
  window: Exclude<TokenUsageWindow, 'off'>,
  sessionTotals: TokenTotals,
  now: Date = new Date(),
): TokenTotals {
  switch (window) {
    case 'session':
      return sessionTotals;
    case 'day':
      return store.days[localDayKey(now)] ?? { input: 0, output: 0 };
    case 'week':
      return sumBuckets(store, dayKeyOffset(now, 6));
    case 'month':
      return sumBuckets(store, dayKeyOffset(now, 29));
    case 'forever':
      return sumBuckets(store, null);
  }
}

/** Short suffix disambiguating non-session windows in the readout. */
export function tokenUsageWindowLabel(window: TokenUsageWindow): string {
  switch (window) {
    case 'day':
      return 'today';
    case 'week':
      return '7d';
    case 'month':
      return '30d';
    case 'forever':
      return 'all';
    default:
      return '';
  }
}
