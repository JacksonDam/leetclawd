import type { Line, Span } from '../types'

const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** Text safe to draw: newlines kept, tabs widened, every other control character dropped. */
export const clean = (text: string): string =>
  text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(CONTROLS, '')

/** Text safe to draw on one row. */
export const oneLine = (text: string): string => clean(text).replace(/\s*\n\s*/g, ' ')

export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

export const truncate = (text: string, width: number): string => {
  if (text.length <= width) {
    return text
  }

  return width <= 1 ? text.slice(0, Math.max(0, width)) : `${text.slice(0, width - 1)}…`
}

export const widthOf = (line: Line): number =>
  line.reduce((total, span) => total + span.text.length, 0)

const isSameStyle = (a: Span, b: Span): boolean =>
  a.color === b.color && a.bold === b.bold && a.dim === b.dim && a.italic === b.italic && a.inverse === b.inverse

/** `line` with each run of spans of one style joined into one span. */
export const mergeLine = (line: Line): Line => {
  const out: Line = []

  for (const span of line) {
    const last = out.at(-1)

    if (last !== undefined && isSameStyle(last, span)) {
      out[out.length - 1] = { ...last, text: last.text + span.text }
    } else {
      out.push(span)
    }
  }

  return out
}

/** The part of `line` between two columns, styles kept. */
export const sliceLine = (line: Line, start: number, end: number): Line => {
  const out: Line = []
  let column = 0

  for (const span of line) {
    const from = Math.max(start, column)
    const to = Math.min(end, column + span.text.length)

    if (to > from) {
      out.push({ ...span, text: span.text.slice(from - column, to - column) })
    }

    column += span.text.length
  }

  return out
}

/** `line` cut into rows of `width` columns, spaces kept: what preformatted text needs. */
export const chunkLine = (line: Line, width: number): Line[] => {
  const total = widthOf(line)
  const step = Math.max(1, width)
  const rows: Line[] = []

  for (let start = 0; start < total; start += step) {
    rows.push(sliceLine(line, start, start + step))
  }

  return rows.length === 0 ? [[]] : rows
}

/** `line` wrapped at word boundaries to `width` columns; a longer word is broken. */
export const wrapLine = (line: Line, width: number): Line[] => {
  const limit = Math.max(1, width)
  const words: Line[] = []
  let word: Line = []

  for (const span of line) {
    for (const piece of span.text.split(/(\s+)/)) {
      if (piece === '') {
        continue
      }

      if (piece.trim() !== '') {
        word.push({ ...span, text: piece })
      } else if (word.length > 0) {
        words.push(word)
        word = []
      }
    }
  }

  if (word.length > 0) {
    words.push(word)
  }

  const rows: Line[] = []
  let row: Line = []
  let used = 0

  for (const next of words) {
    let rest = next
    let size = widthOf(rest)

    if (used > 0 && used + 1 + size > limit) {
      rows.push(row)
      row = []
      used = 0
    }

    while (size > limit) {
      rows.push(sliceLine(rest, 0, limit))
      rest = sliceLine(rest, limit, size)
      size -= limit
    }

    if (used > 0) {
      const before = row.at(-1)
      const after = rest[0]

      // a space between two words of one style is of that style, so the run stays one span
      row.push(before !== undefined && after !== undefined && isSameStyle(before, after) ? { ...after, text: ' ' } : { text: ' ' })
      used += 1
    }

    row.push(...rest)
    used += size
  }

  if (row.length > 0 || rows.length === 0) {
    rows.push(row)
  }

  return rows.map(mergeLine)
}

/** Prose as rows of one style, wrapped at words: every newline starts a row. */
export const wrapText = (text: string, width: number, style: Omit<Span, 'text'> = {}): Line[] =>
  clean(text)
    .split('\n')
    .flatMap(row => (row.trim() === '' ? [[]] : wrapLine([{ ...style, text: row }], width)))

/** Preformatted text as rows of one style, its spaces kept: a longer row is cut into several. */
export const chunkText = (text: string, width: number, style: Omit<Span, 'text'> = {}): Line[] =>
  clean(text)
    .split('\n')
    .flatMap(row => (row === '' ? [[]] : chunkLine([{ ...style, text: row }], width)))
