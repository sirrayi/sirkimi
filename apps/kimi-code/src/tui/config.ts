/**
 * Client-owned preferences.
 *
 * Agent/runtime settings live in core's `config.toml`; this file owns
 * kimi-code client preferences such as terminal UI and update behavior.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';

import { getDataDir } from '#/utils/paths';

export const INVALID_TUI_CONFIG_MESSAGE =
  'Invalid TUI config in ~/.kimi-code/tui.toml; using defaults.';

export const TuiThemeSchema = z.string();

export const NotificationConditionSchema = z.enum(['unfocused', 'always']);

export const NotificationsConfigSchema = z.object({
  enabled: z.boolean(),
  condition: NotificationConditionSchema,
});

export const UpgradePreferencesSchema = z.object({
  autoInstall: z.boolean(),
});

export const STATUS_LINE_ITEMS = ['mode', 'goal', 'model', 'tasks', 'cwd', 'git', 'tips'] as const;
export type StatusLineItem = (typeof STATUS_LINE_ITEMS)[number];

export const StatusLineFileConfigSchema = z.object({
  items: z.array(z.string()).optional(),
  command: z.string().optional(),
  /** false hides the rotating hint tips in the footer. */
  tips: z.boolean().optional(),
});

export const StatusLineConfigSchema = z.object({
  /** Ordered built-in slots for footer line 1; null means the default layout. */
  items: z.array(z.enum(STATUS_LINE_ITEMS)).nullable(),
  /** User command whose first stdout line replaces footer line 1; null disables. */
  command: z.string().nullable(),
  /** Whether the rotating hint tips render; absent means enabled. */
  tips: z.boolean().optional(),
});
export type StatusLineConfig = z.infer<typeof StatusLineConfigSchema>;

export const DEFAULT_STATUS_LINE_CONFIG: StatusLineConfig = {
  items: null,
  command: null,
  tips: true,
};

export const TuiConfigFileSchema = z.object({
  theme: TuiThemeSchema.optional(),
  disable_paste_burst: z.boolean().optional(),
  /** true starts the rainbow dance animation at launch and keeps it flowing. */
  dance: z.boolean().optional(),
  /** Token usage readout window in the footer; default "session". */
  token_usage: z.enum(['session', 'day', 'week', 'month', 'forever', 'off']).optional(),
  /** Extra whimsical verbs for the spinner, merged with the built-in list. */
  spinner_words: z.array(z.string()).optional(),
  /** true shows a USD cost next to the footer token readout. */
  cost: z.boolean().optional(),
  /** Weeks shown in the /usage activity grid (1-52); default 10. */
  activity_weeks: z.number().int().min(1).max(52).optional(),
  editor: z
    .object({
      command: z.string().optional(),
    })
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      notification_condition: NotificationConditionSchema.optional(),
    })
    .optional(),
  upgrade: z
    .object({
      auto_install: z.boolean().optional(),
    })
    .optional(),
  status_line: StatusLineFileConfigSchema.optional(),
});

export const TuiConfigSchema = z.object({
  theme: TuiThemeSchema,
  disablePasteBurst: z.boolean(),
  /** Rainbow dance animation on at launch; absent means off. */
  dance: z.boolean().optional(),
  /** Token usage readout window; absent means "session". */
  tokenUsage: z.enum(['session', 'day', 'week', 'month', 'forever', 'off']).optional(),
  /** User-added spinner verbs; absent means built-ins only. */
  spinnerWords: z.array(z.string()).optional(),
  /** Show USD cost in the footer token readout; absent means off. */
  cost: z.boolean().optional(),
  /** Weeks in the /usage activity grid; absent means 10. */
  activityWeeks: z.number().int().min(1).max(52).optional(),
  editorCommand: z.string().nullable(),
  notifications: NotificationsConfigSchema,
  upgrade: UpgradePreferencesSchema,
  /** Present in every normalized config; optional only so hand-built test
   * fixtures from before this field existed still typecheck. */
  statusLine: StatusLineConfigSchema.optional(),
});

export type TuiConfigFileShape = z.infer<typeof TuiConfigFileSchema>;
export type TuiConfig = z.infer<typeof TuiConfigSchema>;
export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;
export type UpgradePreferences = z.infer<typeof UpgradePreferencesSchema>;

export const DEFAULT_NOTIFICATIONS_CONFIG: NotificationsConfig = {
  enabled: true,
  condition: 'unfocused',
};

export const DEFAULT_UPGRADE_PREFERENCES: UpgradePreferences = {
  autoInstall: true,
};

export const DEFAULT_TUI_CONFIG: TuiConfig = TuiConfigSchema.parse({
  theme: 'auto',
  disablePasteBurst: false,
  dance: false,
  editorCommand: null,
  notifications: DEFAULT_NOTIFICATIONS_CONFIG,
  upgrade: DEFAULT_UPGRADE_PREFERENCES,
  statusLine: DEFAULT_STATUS_LINE_CONFIG,
});

/**
 * Thrown by `loadTuiConfig` when the on-disk TOML cannot be parsed.
 * Carries `fallback` so the caller can recover without re-running the
 * I/O, and use `message` (== `INVALID_TUI_CONFIG_MESSAGE`) as a
 * user-facing notice.
 */
export class TuiConfigParseError extends Error {
  override readonly name = 'TuiConfigParseError';
  readonly fallback: TuiConfig;
  constructor(fallback: TuiConfig) {
    super(INVALID_TUI_CONFIG_MESSAGE);
    this.fallback = fallback;
  }
}

export function getTuiConfigPath(): string {
  return join(getDataDir(), 'tui.toml');
}

export async function loadTuiConfig(
  filePath: string = getTuiConfigPath(),
  warn?: (message: string) => void,
): Promise<TuiConfig> {
  if (!existsSync(filePath)) {
    await saveTuiConfig(DEFAULT_TUI_CONFIG, filePath);
    return DEFAULT_TUI_CONFIG;
  }

  try {
    const text = await readFile(filePath, 'utf-8');
    return parseTuiConfig(text, warn);
  } catch {
    throw new TuiConfigParseError(DEFAULT_TUI_CONFIG);
  }
}

export function parseTuiConfig(
  tomlText: string,
  warn?: (message: string) => void,
): TuiConfig {
  if (tomlText.trim().length === 0) {
    return DEFAULT_TUI_CONFIG;
  }
  const raw = parseToml(tomlText) as Record<string, unknown>;
  const parsed = TuiConfigFileSchema.parse(raw);
  return normalizeTuiConfig(parsed, warn);
}

export async function saveTuiConfig(
  config: TuiConfig,
  filePath: string = getTuiConfigPath(),
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, renderTuiConfig(config), 'utf-8');
}

/** Lowercase, trim, dedupe, and drop anything that isn't a single lowercase word. */
export function normalizeSpinnerWords(raw: string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of raw) {
    const w = word.trim().toLowerCase();
    if (!/^[a-z]{2,20}$/.test(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out.length > 0 ? out : undefined;
}

export function normalizeTuiConfig(  config: TuiConfigFileShape,
  warn: (message: string) => void = (message) => {
    // oxlint-disable-next-line no-console
    console.warn(message);
  },
): TuiConfig {
  const command = config.editor?.command?.trim();
  const statusLineCommand = config.status_line?.command?.trim();
  const knownItems = new Set<string>(STATUS_LINE_ITEMS);
  const statusLineItems =
    config.status_line?.items
      ?.filter((item) => {
        const known = knownItems.has(item);
        if (!known) {
          warn(`[tui.toml] ignoring unknown status_line item: ${item}`);
        }
        return known;
      })
      .map((item) => item as StatusLineItem) ?? null;
  return TuiConfigSchema.parse({
    theme: config.theme ?? DEFAULT_TUI_CONFIG.theme,
    disablePasteBurst: config.disable_paste_burst ?? DEFAULT_TUI_CONFIG.disablePasteBurst,
    // Only materialize the opt-in; undefined means off and keeps older
    // fixtures/snapshots without the key comparing equal.
    dance: config.dance === true ? true : undefined,
    // Only materialize non-default windows; undefined means "session".
    tokenUsage:
      config.token_usage === undefined || config.token_usage === 'session'
        ? undefined
        : config.token_usage,
    spinnerWords: normalizeSpinnerWords(config.spinner_words),
    // Only materialize the opt-in; undefined means off.
    cost: config.cost === true ? true : undefined,
    // Only materialize non-default ranges; undefined means 10 weeks.
    activityWeeks:
      config.activity_weeks === undefined || config.activity_weeks === 10
        ? undefined
        : config.activity_weeks,
    editorCommand: command === undefined || command.length === 0 ? null : command,
    notifications: {
      enabled: config.notifications?.enabled ?? DEFAULT_NOTIFICATIONS_CONFIG.enabled,
      condition:
        config.notifications?.notification_condition ?? DEFAULT_NOTIFICATIONS_CONFIG.condition,
    },
    upgrade: {
      autoInstall: config.upgrade?.auto_install ?? DEFAULT_UPGRADE_PREFERENCES.autoInstall,
    },
    statusLine: {
      items: statusLineItems,
      command:
        statusLineCommand === undefined || statusLineCommand.length === 0
          ? null
          : statusLineCommand,
      // Only materialize the opt-out; undefined means enabled and keeps
      // older fixtures/snapshots without the key comparing equal.
      tips: config.status_line?.tips === false ? false : undefined,
    },
  });
}

export function renderTuiConfig(config: TuiConfig): string {
  const spinnerWordsLine =
    config.spinnerWords !== undefined && config.spinnerWords.length > 0
      ? `spinner_words = ${JSON.stringify(config.spinnerWords)}`
      : `# spinner_words = ["vibing", "cooking"] # extra spinner verbs, merged with built-ins`;
  // An active status_line must round-trip: any preference save rewrites the
  // whole file, so the section is emitted live when set and left as a
  // commented-out guide when unset.
  const statusItems = config.statusLine?.items;
  const statusCommand = config.statusLine?.command;
  const statusLines: string[] = [];
  if (statusItems !== null && statusItems !== undefined) {
    statusLines.push(`items = ${JSON.stringify(statusItems)}`);
  }
  if (statusCommand) {
    statusLines.push(`command = "${escapeTomlBasicString(statusCommand)}"`);
  }
  if (config.statusLine?.tips === false) {
    statusLines.push('tips = false');
  }
  const statusSection =
    statusLines.length > 0
      ? `[status_line]\n${statusLines.join('\n')}\n`
      : `# [status_line]
# Pick and order the built-in footer slots: ${STATUS_LINE_ITEMS.join(', ')}
# items = ${JSON.stringify([...STATUS_LINE_ITEMS])}
# Or render your own: a command whose first stdout line replaces footer line 1.
# It receives a JSON snapshot (model, cwd, git, usage, mode) on stdin.
# command = "~/.kimi-code/statusline.sh"
# Hide the rotating hint tips:
# tips = false
`;
  return `# ~/.kimi-code/tui.toml
# Client preferences for kimi-code.
# Agent/runtime settings stay in ~/.kimi-code/config.toml.

theme = "${escapeTomlBasicString(config.theme)}" # "auto" | "dark" | "light" | custom theme name
disable_paste_burst = ${String(config.disablePasteBurst)} # true disables non-bracketed paste-burst fallback
dance = ${String(config.dance === true)} # true starts the rainbow dance animation at launch
token_usage = "${config.tokenUsage ?? 'session'}" # "session" | "day" | "week" | "month" | "forever" | "off"
cost = ${String(config.cost === true)} # true shows USD cost next to the token readout
activity_weeks = ${String(config.activityWeeks ?? 10)} # 1-52, weeks in the /usage activity grid
${spinnerWordsLine}

[editor]
command = "${escapeTomlBasicString(config.editorCommand ?? '')}" # Empty uses $VISUAL / $EDITOR

[notifications]
enabled = ${String(config.notifications.enabled)} # true | false
notification_condition = "${config.notifications.condition}" # "unfocused" | "always"

[upgrade]
auto_install = ${String(config.upgrade.autoInstall)} # true | false

${statusSection}`;
}

function escapeTomlBasicString(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\b', '\\b')
    .replaceAll('\t', '\\t')
    .replaceAll('\n', '\\n')
    .replaceAll('\f', '\\f')
    .replaceAll('\r', '\\r');
}
