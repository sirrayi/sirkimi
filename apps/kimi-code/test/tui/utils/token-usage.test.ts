import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  loadTokenUsageStore,
  localDayKey,
  recordSessionUsage,
  saveTokenUsageStore,
  sessionUsageTotals,
  summarizeTokenUsage,
  tokenUsageWindowLabel,
  type TokenUsageStore,
} from '#/tui/utils/token-usage';

const NOW = new Date('2026-07-31T12:00:00');

function dayOffset(n: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

function newStore(): TokenUsageStore {
  return { days: {}, sessions: {} };
}

describe('recordSessionUsage', () => {
  it('adds only the delta since the last snapshot to today', () => {
    const store = newStore();
    recordSessionUsage(store, 's1', { input: 100, output: 10 }, NOW);
    recordSessionUsage(store, 's1', { input: 250, output: 40 }, NOW);

    expect(store.days[localDayKey(NOW)]).toEqual({ input: 250, output: 40 });
  });

  it('treats a shrunken counter (compaction/fork) as a fresh baseline', () => {
    const store = newStore();
    recordSessionUsage(store, 's1', { input: 500, output: 50 }, NOW);
    recordSessionUsage(store, 's1', { input: 30, output: 5 }, NOW);

    expect(store.days[localDayKey(NOW)]).toEqual({ input: 530, output: 55 });
  });

  it('tracks sessions independently', () => {
    const store = newStore();
    recordSessionUsage(store, 's1', { input: 100, output: 10 }, NOW);
    recordSessionUsage(store, 's2', { input: 40, output: 4 }, NOW);

    expect(store.days[localDayKey(NOW)]).toEqual({ input: 140, output: 14 });
  });
});

describe('summarizeTokenUsage', () => {
  const store = {
    days: {
      [dayOffset(0)]: { input: 10, output: 1 },
      [dayOffset(3)]: { input: 20, output: 2 },
      [dayOffset(10)]: { input: 40, output: 4 },
      [dayOffset(40)]: { input: 80, output: 8 },
    },
    sessions: {},
  };

  it('session returns the live session totals untouched', () => {
    expect(summarizeTokenUsage(store, 'session', { input: 7, output: 2 }, NOW)).toEqual({
      input: 7,
      output: 2,
    });
  });

  it('day returns only today', () => {
    expect(summarizeTokenUsage(store, 'day', { input: 0, output: 0 }, NOW)).toEqual({
      input: 10,
      output: 1,
    });
  });

  it('week covers the last 7 days', () => {
    expect(summarizeTokenUsage(store, 'week', { input: 0, output: 0 }, NOW)).toEqual({
      input: 30,
      output: 3,
    });
  });

  it('month covers the last 30 days', () => {
    expect(summarizeTokenUsage(store, 'month', { input: 0, output: 0 }, NOW)).toEqual({
      input: 70,
      output: 7,
    });
  });

  it('forever sums every bucket', () => {
    expect(summarizeTokenUsage(store, 'forever', { input: 0, output: 0 }, NOW)).toEqual({
      input: 150,
      output: 15,
    });
  });
});

describe('store persistence', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('round-trips through disk and survives a missing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'skimi-token-usage-'));
    const path = join(dir, 'token-usage.json');

    expect(await loadTokenUsageStore(path)).toEqual({ days: {}, sessions: {} });

    const store = { days: { '2026-07-31': { input: 5, output: 1 } }, sessions: {} };
    await saveTokenUsageStore(store, path);
    expect(await loadTokenUsageStore(path)).toEqual(store);
  });
});

describe('sessionUsageTotals', () => {
  it('prefers total when present', () => {
    expect(
      sessionUsageTotals({
        total: { inputOther: 10, inputCacheRead: 2, inputCacheCreation: 3, output: 5 },
      }),
    ).toEqual({ input: 15, output: 5 });
  });

  it('falls back to summing byModel', () => {
    expect(
      sessionUsageTotals({
        byModel: {
          a: { inputOther: 10, inputCacheRead: 0, inputCacheCreation: 0, output: 1 },
          b: { inputOther: 0, inputCacheRead: 4, inputCacheCreation: 6, output: 2 },
        },
      }),
    ).toEqual({ input: 20, output: 3 });
  });

  it('falls back to currentTurn, then null', () => {
    expect(
      sessionUsageTotals({
        currentTurn: { inputOther: 1, inputCacheRead: 0, inputCacheCreation: 0, output: 2 },
      }),
    ).toEqual({ input: 1, output: 2 });
    expect(sessionUsageTotals({})).toBeNull();
  });
});

describe('tokenUsageWindowLabel', () => {
  it('labels non-session windows only', () => {
    expect(tokenUsageWindowLabel('session')).toBe('');
    expect(tokenUsageWindowLabel('day')).toBe('today');
    expect(tokenUsageWindowLabel('week')).toBe('7d');
    expect(tokenUsageWindowLabel('month')).toBe('30d');
    expect(tokenUsageWindowLabel('forever')).toBe('all');
  });
});
