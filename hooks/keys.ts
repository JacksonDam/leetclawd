/** One edit of the prompt box, as much of it as a shortcut is read from. */
export type Edit = { text: string; cursor: number; start: number; end: number; inputText: string }

export const DEFAULT_LEADER = ';'

/**
 * The shortcut key an option names: one character that is no letter, digit or space, and none of the
 * characters that already lead something in the prompt box. Anything else is the default.
 */
export const leaderOf = (option: unknown): string =>
  typeof option === 'string' && /^[^\sA-Za-z0-9/!@#?&]$/u.test(option) ? option : DEFAULT_LEADER

/**
 * The key typed after the shortcut key, or undefined for any other edit. The shortcut key leads only
 * in an empty prompt box: it is typed there like any character, and the key after it is the shortcut.
 * Two keys that arrive together, the shortcut key first, into an empty box are read the same way.
 */
export const followsLeader = (edit: Edit, leader: string): string | undefined => {
  const typed = [...edit.inputText]
  const isAfterLeader = edit.text === leader && edit.cursor === leader.length && edit.start === edit.end && edit.start === leader.length

  if (isAfterLeader && typed.length === 1) {
    return typed[0]
  }

  return edit.text === '' && typed.length === 2 && typed[0] === leader ? typed[1] : undefined
}
