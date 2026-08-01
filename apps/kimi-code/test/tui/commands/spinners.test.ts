import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleSpinnersCommand } from '#/tui/commands/config';
import type { SlashCommandHost } from '#/tui/commands/dispatch';
import { spinnerWordPool, setCustomSpinnerWords } from '#/tui/constant/spinner-words';
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

function makeHost(spinnerWords?: string[]) {
  const host = {
    state: {
      appState: {
        theme: 'dark' as const,
        editorCommand: null,
        notifications: { enabled: true, condition: 'unfocused' as const },
        upgrade: { autoInstall: true },
        spinnerWords,
      },
      theme: { palette: darkColors },
    },
    setAppState: vi.fn(),
    showStatus: vi.fn(),
    showError: vi.fn(),
  };
  return host as unknown as SlashCommandHost & {
    setAppState: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
  };
}

describe('handleSpinnersCommand', () => {
  beforeEach(() => {
    mocks.saveTuiConfig.mockClear();
    setCustomSpinnerWords([]);
  });

  it('lists built-ins and customs', async () => {
    const host = makeHost(['vibing']);
    await handleSpinnersCommand(host, 'list');

    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('vibing'));
    expect(host.showStatus).toHaveBeenCalledWith(expect.stringContaining('built-in'));
  });

  it('adds a word, persists it, and joins the pool immediately', async () => {
    const host = makeHost();
    await handleSpinnersCommand(host, 'add cooking');

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ spinnerWords: ['cooking'] }),
    );
    expect(host.setAppState).toHaveBeenCalledWith({ spinnerWords: ['cooking'] });
    expect(spinnerWordPool()).toContain('cooking');
  });

  it('rejects duplicates and invalid words', async () => {
    const host = makeHost(['vibing']);
    await handleSpinnersCommand(host, 'add vibing');
    expect(mocks.saveTuiConfig).not.toHaveBeenCalled();

    await handleSpinnersCommand(host, 'add not-a-word!');
    expect(host.showError).toHaveBeenCalled();
    expect(mocks.saveTuiConfig).not.toHaveBeenCalled();
  });

  it('removes a custom word and clears the store when empty', async () => {
    const host = makeHost(['vibing']);
    setCustomSpinnerWords(['vibing']);
    await handleSpinnersCommand(host, 'remove vibing');

    expect(mocks.saveTuiConfig).toHaveBeenCalledWith(
      expect.objectContaining({ spinnerWords: undefined }),
    );
    expect(spinnerWordPool()).not.toContain('vibing');
  });
});
