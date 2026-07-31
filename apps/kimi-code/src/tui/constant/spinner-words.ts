/**
 * Whimsical verbs for the live thinking spinner, Claude Code style: every
 * thinking block picks one at random, so the label changes from prompt to
 * prompt ("thinking...", "canoodling...", ...). `thinking` stays in the list
 * so the classic label still shows up.
 */
export const SPINNER_WORDS = [
  'thinking',
  'pondering',
  'canoodling',
  'noodling',
  'cogitating',
  'musing',
  'ruminating',
  'brewing',
  'percolating',
  'marinating',
  'scheming',
  'churning',
  'deliberating',
  'contemplating',
  'tinkering',
  'puzzling',
  'daydreaming',
  'stewing',
  'crunching',
  'whirring',
  'conjuring',
  'hatching',
  'simmering',
  'wandering',
  'wondering',
  'decoding',
  'dreaming',
  'mulling',
  'chewing',
  'spinning',
] as const;

export function pickSpinnerWord(random: () => number = Math.random): string {
  return SPINNER_WORDS[Math.floor(random() * SPINNER_WORDS.length)] ?? 'thinking';
}

/**
 * The verb for the current turn, shared by every loading surface (activity
 * pane moon loader, transcript thinking line) so they never show two
 * different words for the same turn. Set at the start of each turn.
 */
let turnWord = 'thinking';

export function setTurnSpinnerWord(word: string): void {
  turnWord = word;
}

export function currentTurnSpinnerWord(): string {
  return turnWord;
}
