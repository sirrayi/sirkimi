import { describe, expect, it } from 'vitest';

import { estimateCostUsd } from '#/tui/utils/token-cost';

const prices = {
  'kimi-k3': { input: 3, output: 15, cacheRead: 0.3 },
};

describe('estimateCostUsd', () => {
  it('estimates from input, cache read, and output components', () => {
    const cost = estimateCostUsd(
      {
        'kimi-code/k3': {
          inputOther: 1_000_000,
          inputCacheRead: 10_000_000,
          inputCacheCreation: 500_000,
          output: 100_000,
        },
      },
      () => 'kimi-k3',
      prices,
    );

    // (1M + 0.5M) × $3 + 10M × $0.3 + 0.1M × $15 = 4.5 + 3 + 1.5
    expect(cost).toBeCloseTo(9, 5);
  });

  it('skips unpriced models and returns null when nothing is priced', () => {
    expect(
      estimateCostUsd(
        { 'other/model': { inputOther: 1, inputCacheRead: 0, inputCacheCreation: 0, output: 1 } },
        () => 'unknown-model',
        prices,
      ),
    ).toBeNull();
    expect(estimateCostUsd({}, () => 'kimi-k3', null)).toBeNull();
  });
});
