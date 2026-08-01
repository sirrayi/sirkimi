/**
 * Token cost estimation from models.dev pricing.
 *
 * The usage RPC exposes token counts only — no cost. models.dev publishes
 * per-1M-token prices for the official `moonshotai` provider, so we estimate:
 *
 *   cost = (inputOther + inputCacheCreation) × input/1M
 *        + inputCacheRead × cache_read/1M
 *        + output × output/1M
 *
 * Prices are cached on disk and refreshed at most once a day. Everything is
 * best-effort: no prices → no cost shown. Note these are public-API rate
 * estimates, not what a managed-plan account is actually billed.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getDataDir } from '#/utils/paths';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const PRICE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

interface PriceCache {
  readonly fetchedAt: number;
  readonly prices: Record<string, ModelPrice>;
}

export interface CostTokenBreakdown {
  readonly inputOther: number;
  readonly inputCacheRead: number;
  readonly inputCacheCreation: number;
  readonly output: number;
}

export function modelPricesPath(): string {
  return join(getDataDir(), 'model-prices.json');
}

function priceCachePath(): string {
  return modelPricesPath();
}

export async function getModelPrices(): Promise<Record<string, ModelPrice> | null> {
  const cached = await readPriceCache();
  if (cached !== null && Date.now() - cached.fetchedAt < PRICE_REFRESH_INTERVAL_MS) {
    return cached.prices;
  }
  const fresh = await fetchPrices().catch(() => null);
  if (fresh !== null) {
    await writePriceCache(fresh);
    return fresh;
  }
  // Stale cache is better than none.
  return cached?.prices ?? null;
}

async function readPriceCache(): Promise<PriceCache | null> {
  try {
    return JSON.parse(await readFile(priceCachePath(), 'utf-8')) as PriceCache;
  } catch {
    return null;
  }
}

async function writePriceCache(prices: Record<string, ModelPrice>): Promise<void> {
  try {
    await mkdir(join(priceCachePath(), '..'), { recursive: true });
    await writeFile(
      priceCachePath(),
      JSON.stringify({ fetchedAt: Date.now(), prices } satisfies PriceCache),
      'utf-8',
    );
  } catch {
    // best effort
  }
}

async function fetchPrices(): Promise<Record<string, ModelPrice> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 5000);
  try {
    const res = await fetch(MODELS_DEV_API_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<
      string,
      { models?: Record<string, { cost?: { input?: number; output?: number; cache_read?: number } }> }
    >;
    const models = data['moonshotai']?.models;
    if (models === undefined) return null;
    const prices: Record<string, ModelPrice> = {};
    for (const [id, m] of Object.entries(models)) {
      const c = m.cost;
      if (c?.input === undefined || c.output === undefined) continue;
      prices[id] = { input: c.input, output: c.output, cacheRead: c.cache_read ?? c.input };
    }
    return Object.keys(prices).length > 0 ? prices : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Estimate the USD cost of a by-model token breakdown. Models are keyed by
 * alias (e.g. `kimi-code/k3`); `aliasToModel` resolves the API id priced on
 * models.dev (e.g. `kimi-k3`). Returns null when no price is known for any
 * model — unknown models are skipped rather than guessed.
 */
export function estimateCostUsd(
  byModel: Record<string, CostTokenBreakdown>,
  aliasToModel: (alias: string) => string | undefined,
  prices: Record<string, ModelPrice> | null,
): number | null {
  if (prices === null) return null;
  let total = 0;
  let any = false;
  for (const [alias, t] of Object.entries(byModel)) {
    const modelId = aliasToModel(alias);
    // Managed aliases often use short ids (`k3`) while models.dev keys on the
    // full name (`kimi-k3`) — try both.
    const price =
      modelId !== undefined ? (prices[modelId] ?? prices[`kimi-${modelId}`]) : undefined;
    if (price === undefined) continue;
    any = true;
    total +=
      ((t.inputOther + t.inputCacheCreation) * price.input) / 1e6 +
      (t.inputCacheRead * price.cacheRead) / 1e6 +
      (t.output * price.output) / 1e6;
  }
  return any ? total : null;
}
