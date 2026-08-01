import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleTokensCommand } from '#/tui/commands/config';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { darkColors } from '#/tui/theme/colors';

const mocks = vi.hoisted(() => ({
  saveTuiConfig: vi.fn(),
}));

vi.mock('../../../src/tui/config', async () => {
  const actual = await vi.importActual<typeof import('../../../src/tui/config.js')>(
    '../../../src/tui/config.js',
  );
  return {
    ...actual,
    saveTuiConfig: mocks.saveTuiConfig,
  };
});

function makeHost(tokenUsage?: string) {
  const host = {
    state: {
      appState: {
        theme: 'dark' as const,
        editorCommand: null,
        notifications: { enabled: true, condition: 'unfocused' as const },
        upgrade: { autoInstall: true },
        tokenUsage,
      },
      theme: { palette: darkColors },
    },
    setAppState: vi.fn(),
    showStatus: vi.fn(),
    showError: vi.fn(),
    refreshQuota: vi.fn(),
  };
  return host as unknown as SlashCommandHost & {
    setAppState: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    refreshQuota: ReturnType<typeof vi.fn>;
  };
}

describe('handleTokensCommand', () => {
  beforeEach(() => {
    mocks.saveTuiConfig.mockClear();
  });

  it('shows the current window when called without arguments', async () => {
    const host = makeHost('day');
    await handleTokensCommand(host, '');

    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('day'));
    expect(mocks.saveTuiConfig).not.toHaveBeenCalled();
  });

  it('persists a new window, updates state, and refreshes the readout', async () => {
    const host = makeHost();
    await handleTokensCommand(host, 'week');

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tokenUsage: 'week' }),
    );
    expect(host.setAppState).toHaveBeenCalledWith({ tokenUsage: 'week' });
    expect(host.refreshQuota).toHaveBeenCalledTimes(1);
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('week'));
  });

  it('stores the default window as absent', async () => {
    const host = makeHost('day');
    await handleTokensCommand(host, 'session');

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tokenUsage: undefined }),
    );
    expect(host.setAppState).toHaveBeenCalledWith({ tokenUsage: undefined });
  });

  it('rejects an unknown window without saving', async () => {
    const host = makeHost();
    await handleTokensCommand(host, 'hourly');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('hourly'));
    expect(mocks.saveTuiConfig).not.toHaveBeenCalled();
  });
});

describe('handleTokensCommand cost toggle', () => {
  beforeEach(() => {
    mocks.saveTuiConfig.mockClear();
  });

  it('/tokens cost on enables and persists the cost display', async () => {
    const host = makeHost();
    await handleTokensCommand(host, 'cost on');

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith(expect.objectContaining({ cost: true }));
    expect(host.setAppState).toHaveBeenCalledWith({ cost: true });
    expect(host.refreshQuota).toHaveBeenCalledTimes(1);
  });

  it('/tokens cost off stores the default as absent', async () => {
    const host = makeHost();
    await handleTokensCommand(host, 'cost off');

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith(expect.objectContaining({ cost: undefined }));
    expect(host.setAppState).toHaveBeenCalledWith({ cost: undefined });
  });

  it('rejects a missing toggle', async () => {
    const host = makeHost();
    await handleTokensCommand(host, 'cost');

    expect(host.showError).toHaveBeenCalled();
    expect(mocks.saveTuiConfig).not.toHaveBeenCalled();
  });
});
