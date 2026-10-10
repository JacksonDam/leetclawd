import { clean } from './text'

/** A text buffer and its cursor; `want` is the column vertical moves aim for. */
export type Buffer = { lines: string[]; row: number; col: number; want: number }

/** One key as a `Client`'s `onKey` hands it. */
export type Key = { key: string; ctrl?: true; shift?: true; meta?: true }

export type Outcome = { buffer: Buffer; isEdit: boolean; command?: 'run' | 'submit' }

export const TAB = 4

const COLON_BLOCKS = new Set(['python', 'python3', 'pythondata'])
const LEAVES = /^\s*(return|pass|break|continue|raise)\b/

export const fromText = (text: string): Buffer => ({
  lines: clean(text).split('\n'),
  row: 0,
  col: 0,
  want: 0,
})

export const toText = (buffer: Buffer): string => buffer.lines.join('\n')

const lineAt = (buffer: Buffer, row = buffer.row): string => buffer.lines[row] ?? ''

const at = (buffer: Buffer, row: number, col: number): Buffer => {
  const safeRow = Math.max(0, Math.min(buffer.lines.length - 1, row))
  const safeCol = Math.max(0, Math.min(lineAt(buffer, safeRow).length, col))

  return { lines: buffer.lines, row: safeRow, col: safeCol, want: safeCol }
}

const withLines = (buffer: Buffer, row: number, count: number, lines: string[]): string[] => [
  ...buffer.lines.slice(0, row),
  ...lines,
  ...buffer.lines.slice(row + count),
]

/** Puts the cursor at a row and column, clamped to the text: a click. */
export const place = (buffer: Buffer, row: number, col: number): Buffer => at(buffer, row, col)

export const insert = (buffer: Buffer, text: string): Buffer => {
  const line = lineAt(buffer)
  const next = line.slice(0, buffer.col) + text + line.slice(buffer.col)
  const col = buffer.col + text.length

  return { lines: withLines(buffer, buffer.row, 1, [next]), row: buffer.row, col, want: col }
}

export const newline = (buffer: Buffer, lang: string): Buffer => {
  const line = lineAt(buffer)
  const head = line.slice(0, buffer.col)
  const tail = line.slice(buffer.col)
  const base = (/^ */.exec(head) as RegExpExecArray)[0].length
  const trimmed = head.trimEnd()
  const isOpening = /[{([]$/.test(trimmed) || (COLON_BLOCKS.has(lang) && trimmed.endsWith(':'))
  const isLeaving = COLON_BLOCKS.has(lang) && LEAVES.test(head) && tail.trim() === ''
  const depth = Math.max(0, base + (isOpening ? TAB : 0) - (isLeaving ? TAB : 0))
  const isSplittingPair = isOpening && /^[})\]]/.test(tail)
  const below = isSplittingPair
    ? [' '.repeat(depth), ' '.repeat(base) + tail]
    : [' '.repeat(depth) + tail.trimStart()]

  return {
    lines: withLines(buffer, buffer.row, 1, [head, ...below]),
    row: buffer.row + 1,
    col: depth,
    want: depth,
  }
}

export const backspace = (buffer: Buffer): Buffer => {
  const line = lineAt(buffer)

  if (buffer.col === 0) {
    if (buffer.row === 0) {
      return buffer
    }

    const above = lineAt(buffer, buffer.row - 1)

    return {
      lines: withLines(buffer, buffer.row - 1, 2, [above + line]),
      row: buffer.row - 1,
      col: above.length,
      want: above.length,
    }
  }

  const head = line.slice(0, buffer.col)
  const count = head.trim() === '' ? ((buffer.col - 1) % TAB) + 1 : 1
  const col = buffer.col - count

  return {
    lines: withLines(buffer, buffer.row, 1, [line.slice(0, col) + line.slice(buffer.col)]),
    row: buffer.row,
    col,
    want: col,
  }
}

export const deleteForward = (buffer: Buffer): Buffer => {
  const line = lineAt(buffer)

  if (buffer.col < line.length) {
    const next = line.slice(0, buffer.col) + line.slice(buffer.col + 1)

    return { ...buffer, lines: withLines(buffer, buffer.row, 1, [next]) }
  }

  if (buffer.row >= buffer.lines.length - 1) {
    return buffer
  }

  return { ...buffer, lines: withLines(buffer, buffer.row, 2, [line + lineAt(buffer, buffer.row + 1)]) }
}

const wordLeft = (buffer: Buffer): Buffer => {
  if (buffer.col === 0) {
    return buffer.row === 0 ? buffer : at(buffer, buffer.row - 1, lineAt(buffer, buffer.row - 1).length)
  }

  const head = lineAt(buffer).slice(0, buffer.col)
  const cut = (/(\w+|[^\w\s]+)?\s*$/.exec(head) as RegExpExecArray)[0].length

  return at(buffer, buffer.row, buffer.col - Math.max(1, cut))
}

const wordRight = (buffer: Buffer): Buffer => {
  const line = lineAt(buffer)

  if (buffer.col >= line.length) {
    return buffer.row >= buffer.lines.length - 1 ? buffer : at(buffer, buffer.row + 1, 0)
  }

  const cut = (/^\s*(\w+|[^\w\s]+)?/.exec(line.slice(buffer.col)) as RegExpExecArray)[0].length

  return at(buffer, buffer.row, buffer.col + Math.max(1, cut))
}

const vertical = (buffer: Buffer, by: number): Buffer => {
  const row = Math.max(0, Math.min(buffer.lines.length - 1, buffer.row + by))

  return { lines: buffer.lines, row, col: Math.min(lineAt(buffer, row).length, buffer.want), want: buffer.want }
}

const home = (buffer: Buffer): Buffer => {
  const first = (/^ */.exec(lineAt(buffer)) as RegExpExecArray)[0].length

  return at(buffer, buffer.row, buffer.col === first ? 0 : first)
}

const indent = (buffer: Buffer): Buffer => insert(buffer, ' '.repeat(TAB - (buffer.col % TAB)))

const dedent = (buffer: Buffer): Buffer => {
  const line = lineAt(buffer)
  const count = Math.min(TAB, (/^ */.exec(line) as RegExpExecArray)[0].length)
  const col = Math.max(0, buffer.col - count)

  return { lines: withLines(buffer, buffer.row, 1, [line.slice(count)]), row: buffer.row, col, want: col }
}

const killToEnd = (buffer: Buffer): Buffer => {
  const line = lineAt(buffer)

  if (buffer.col >= line.length) {
    return deleteForward(buffer)
  }

  return { ...buffer, lines: withLines(buffer, buffer.row, 1, [line.slice(0, buffer.col)]) }
}

const killToStart = (buffer: Buffer): Buffer => ({
  lines: withLines(buffer, buffer.row, 1, [lineAt(buffer).slice(buffer.col)]),
  row: buffer.row,
  col: 0,
  want: 0,
})

const deleteWordBack = (buffer: Buffer): Buffer => {
  if (buffer.col === 0) {
    return backspace(buffer)
  }

  const start = wordLeft(buffer).col
  const line = lineAt(buffer)

  return {
    lines: withLines(buffer, buffer.row, 1, [line.slice(0, start) + line.slice(buffer.col)]),
    row: buffer.row,
    col: start,
    want: start,
  }
}

const NAMED = new Set([
  'return',
  'enter',
  'tab',
  'backspace',
  'delete',
  'up',
  'down',
  'left',
  'right',
  'pageup',
  'pagedown',
  'home',
  'end',
  'escape',
  'insert',
])

const isDrawable = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0

  return code >= 32 && !(code >= 127 && code < 160)
}

/**
 * The text a key types, or undefined for a key that types none. Characters typed faster than the
 * surface reads them arrive together as one key, so a key may type several.
 */
const typed = (key: Key): string | undefined => {
  if (key.ctrl === true || key.meta === true || NAMED.has(key.key)) {
    return undefined
  }

  if (key.key === 'space') {
    return ' '
  }

  return key.key !== '' && [...key.key].every(isDrawable) ? key.key : undefined
}

const edited = (buffer: Buffer): Outcome => ({ buffer, isEdit: true })
const moved = (buffer: Buffer): Outcome => ({ buffer, isEdit: false })

/** What one key does to the buffer: an edit, a move, or a command for the judge. */
export const applyKey = (buffer: Buffer, key: Key, options: { lang: string; page: number }): Outcome => {
  const text = typed(key)

  if (text !== undefined) {
    return edited(insert(buffer, text))
  }

  const isWordwise = key.ctrl === true || key.meta === true

  if (key.ctrl === true) {
    switch (key.key) {
      case 'r':
        return { buffer, isEdit: false, command: 'run' }
      case 's':
        return { buffer, isEdit: false, command: 'submit' }
      case 'a':
        return moved(at(buffer, buffer.row, 0))
      case 'e':
        return moved(at(buffer, buffer.row, lineAt(buffer).length))
      case 'k':
        return edited(killToEnd(buffer))
      case 'u':
        return edited(killToStart(buffer))
      case 'w':
        return edited(deleteWordBack(buffer))
      case 'p':
        return moved(vertical(buffer, -1))
      case 'n':
        return moved(vertical(buffer, 1))
      case 'f':
        return moved(at(buffer, buffer.row, buffer.col + 1))
      case 'b':
        return moved(at(buffer, buffer.row, buffer.col - 1))
    }
  }

  switch (key.key) {
    case 'return':
    case 'enter':
    case '\n':
    case '\r':
      return edited(newline(buffer, options.lang))
    case 'tab':
      return edited(key.shift === true ? dedent(buffer) : indent(buffer))
    case 'backspace':
      return edited(isWordwise ? deleteWordBack(buffer) : backspace(buffer))
    case 'delete':
      return edited(deleteForward(buffer))
    case 'left':
      if (isWordwise) {
        return moved(wordLeft(buffer))
      }

      return moved(
        buffer.col === 0 && buffer.row > 0
          ? at(buffer, buffer.row - 1, lineAt(buffer, buffer.row - 1).length)
          : at(buffer, buffer.row, buffer.col - 1),
      )
    case 'right':
      if (isWordwise) {
        return moved(wordRight(buffer))
      }

      return moved(
        buffer.col >= lineAt(buffer).length && buffer.row < buffer.lines.length - 1
          ? at(buffer, buffer.row + 1, 0)
          : at(buffer, buffer.row, buffer.col + 1),
      )
    case 'up':
      return moved(vertical(buffer, -1))
    case 'down':
      return moved(vertical(buffer, 1))
    case 'pageup':
      return moved(vertical(buffer, -Math.max(1, options.page)))
    case 'pagedown':
      return moved(vertical(buffer, Math.max(1, options.page)))
    case 'home':
      return moved(key.ctrl === true ? at(buffer, 0, 0) : home(buffer))
    case 'end':
      return moved(
        key.ctrl === true
          ? at(buffer, buffer.lines.length - 1, lineAt(buffer, buffer.lines.length - 1).length)
          : at(buffer, buffer.row, lineAt(buffer).length),
      )
  }

  return moved(buffer)
}
