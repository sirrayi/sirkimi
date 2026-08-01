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
  /** USD cost when the source provides it (session window only today). */
  readonly cost?: number;
}

interface DailyBucket {
  input: number;
  output: number;
  cost?: number;
  byModel?: Record<string, { input: number; output: number }>;
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
  models?: Record<string, { input: number; output: number }>,
): void {
  const previous = store.sessions[sessionId] ?? { input: 0, output: 0 };
  const deltaIn = totals.input >= previous.input ? totals.input - previous.input : totals.input;
  const deltaOut =
    totals.output >= previous.output ? totals.output - previous.output : totals.output;
  const prevCost = previous.cost ?? 0;
  const totalsCost = totals.cost ?? prevCost;
  const deltaCost = totalsCost >= prevCost ? totalsCost - prevCost : totalsCost;
  const prevModels = previous.byModel ?? {};
  const modelDeltas: Record<string, { input: number; output: number }> = {};
  if (models !== undefined) {
    for (const [model, m] of Object.entries(models)) {
      const prev = prevModels[model] ?? { input: 0, output: 0 };
      const dIn = m.input >= prev.input ? m.input - prev.input : m.input;
      const dOut = m.output >= prev.output ? m.output - prev.output : m.output;
      if (dIn > 0 || dOut > 0) modelDeltas[model] = { input: dIn, output: dOut };
    }
  }
  store.sessions[sessionId] = {
    input: totals.input,
    output: totals.output,
    ...(totals.cost !== undefined ? { cost: totals.cost } : {}),
    ...(models !== undefined ? { byModel: models } : {}),
  };
  if (deltaIn === 0 && deltaOut === 0 && deltaCost === 0 && Object.keys(modelDeltas).length === 0) {
    return;
  }
  const key = localDayKey(now);
  const bucket = store.days[key] ?? { input: 0, output: 0 };
  bucket.input += deltaIn;
  bucket.output += deltaOut;
  if (deltaCost > 0 || bucket.cost !== undefined) {
    bucket.cost = (bucket.cost ?? 0) + deltaCost;
  }
  if (Object.keys(modelDeltas).length > 0) {
    bucket.byModel = bucket.byModel ?? {};
    for (const [model, delta] of Object.entries(modelDeltas)) {
      const mb = bucket.byModel[model] ?? { input: 0, output: 0 };
      mb.input += delta.input;
      mb.output += delta.output;
      bucket.byModel[model] = mb;
    }
  }
  store.days[key] = bucket;
}

function sumBuckets(store: TokenUsageStore, sinceDayKey: string | null): TokenTotals {
  let input = 0;
  let output = 0;
  let cost = 0;
  let hasCost = false;
  for (const [day, bucket] of Object.entries(store.days)) {
    if (sinceDayKey !== null && day < sinceDayKey) continue;
    input += bucket.input;
    output += bucket.output;
    if (bucket.cost !== undefined) {
      cost += bucket.cost;
      hasCost = true;
    }
  }
  return hasCost ? { input, output, cost } : { input, output };
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
      return store.days[localDayKey(now)] ?? { input: 0, output: 0 };    case 'week':
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

/**
 * Session cost in USD, read tolerantly: the wire protocol carries
 * `total_cost_usd` but the SDK type omits it. Null when absent.
 */
export function sessionUsageCost(usage: unknown): number | null {  if (typeof usage !== 'object' || usage === null) return null;
  const raw = (usage as Record<string, unknown>)['total_cost_usd'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

interface SessionUsageLike {
  readonly byModel?: Record<
    string,
    { readonly inputOther: number; readonly output: number; readonly inputCacheRead: number; readonly inputCacheCreation: number }
  >;
  readonly currentTurn?:
    | { readonly inputOther: number; readonly output: number; readonly inputCacheRead: number; readonly inputCacheCreation: number }
    | undefined;
  readonly total?:
    | { readonly inputOther: number; readonly output: number; readonly inputCacheRead: number; readonly inputCacheCreation: number }
    | undefined;
}

/**
 * Extract session-cumulative totals from the SDK's SessionUsage. `total` is
 * the fast path but is not always populated; fall back to summing `byModel`
 * (what the /usage panel does), then `currentTurn` as a last resort.
 */
export function sessionUsageTotals(usage: SessionUsageLike): TokenTotals | null {
  const pick = (
    t: { inputOther: number; output: number; inputCacheRead: number; inputCacheCreation: number },
  ): TokenTotals => ({
    input: t.inputOther + t.inputCacheRead + t.inputCacheCreation,
    output: t.output,
  });
  if (usage.total !== undefined) return pick(usage.total);
  const models = Object.values(usage.byModel ?? {});
  if (models.length > 0) {
    let input = 0;
    let output = 0;
    for (const m of models) {
      input += m.inputOther + m.inputCacheRead + m.inputCacheCreation;
      output += m.output;
    }
    return { input, output };
  }
  if (usage.currentTurn !== undefined) return pick(usage.currentTurn);
  return null;
}

/** Per-model cumulative totals extracted from a SessionUsage's byModel map. */
export function sessionUsageByModel(usage: SessionUsageLike): Record<string, TokenTotals> | null {
  const models = usage.byModel;
  if (models === undefined) return null;
  const out: Record<string, TokenTotals> = {};
  for (const [model, m] of Object.entries(models)) {
    out[model] = {
      input: m.inputOther + m.inputCacheRead + m.inputCacheCreation,
      output: m.output,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Per-model token totals across the last `daysBack` days (including today),
 * from the daily buckets. Models with no recorded usage in range are omitted.
 */
export function modelTotalsForRange(
  store: TokenUsageStore,
  daysBack: number,
  now: Date = new Date(),
): Record<string, TokenTotals> {
  const since = dayKeyOffset(now, daysBack);
  const out: Record<string, { input: number; output: number }> = {};
  for (const [day, bucket] of Object.entries(store.days)) {
    if (day < since || bucket.byModel === undefined) continue;
    for (const [model, m] of Object.entries(bucket.byModel)) {
      const acc = out[model] ?? { input: 0, output: 0 };
      acc.input += m.input;
      acc.output += m.output;
      out[model] = acc;
    }
  }
  return out;
}
