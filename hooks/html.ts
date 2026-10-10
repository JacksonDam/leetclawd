import type { Line, Span } from '../types'

import { chunkLine, clean, widthOf, wrapLine } from './text'

/** One block of a problem statement: a paragraph or list item, a preformatted row, or a blank row. */
export type Block = {
  kind: 'text' | 'pre' | 'gap'
  spans: Line
  indent: number
  bullet: string
}

const CODE_COLOR = 'suggestion'

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
  le: '≤',
  ge: '≥',
  ne: '≠',
  times: '×',
  minus: '−',
  hellip: '…',
  rarr: '→',
  larr: '←',
  uarr: '↑',
  darr: '↓',
  harr: '↔',
  middot: '·',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  infin: '∞',
  deg: '°',
  plusmn: '±',
  divide: '÷',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  sum: '∑',
  radic: '√',
  pi: 'π',
  theta: 'θ',
  isin: '∈',
  cap: '∩',
  cup: '∪',
  oplus: '⊕',
  and: '∧',
  or: '∨',
  copy: '©',
  thinsp: ' ',
  ensp: ' ',
  emsp: ' ',
  zwnj: '',
  zwj: '',
  lrm: '',
  rlm: '',
  shy: '',
}

const decode = (text: string): string =>
  text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, name: string) => {
    if (name.startsWith('#')) {
      const isHex = name[1] === 'x' || name[1] === 'X'
      const code = Number.parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      const isDrawable = Number.isFinite(code) && code >= 32 && code <= 0x10ffff

      return isDrawable ? String.fromCodePoint(code) : ''
    }

    return ENTITIES[name] ?? whole
  })

const TOKEN =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|(<)/g

const GAPPED = new Set(['p', 'div', 'section', 'blockquote', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const BOLD = new Set(['strong', 'b', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th'])
const ITALIC = new Set(['em', 'i', 'u', 'var'])
const CODE = new Set(['code', 'kbd', 'tt', 'samp'])
const SKIPPED = new Set(['style', 'script'])

/** Reads a LeetCode problem statement (HTML) into blocks of styled text. */
export const parse = (html: string): Block[] => {
  const blocks: Block[] = []
  const lists: { isOrdered: boolean; count: number }[] = []
  const hangs: number[] = []
  let spans: Line = []
  let bold = 0
  let italic = 0
  let code = 0
  let pre = 0
  let preStart = 0
  let bullet = ''
  let skipping = ''

  const indentNow = () => 2 * Math.max(0, hangs.length - 1)

  const push = (kind: 'text' | 'pre') => {
    const hang = hangs.at(-1) ?? 0
    const lead = bullet !== '' ? bullet : ' '.repeat(hang)

    blocks.push({ kind, spans, indent: indentNow(), bullet: lead })
    spans = []
    bullet = ''
  }

  const flush = () => {
    while (spans.length > 0 && (spans.at(-1) as Span).text.trim() === '') {
      spans.pop()
    }

    if (spans.length > 0) {
      push('text')
    } else {
      spans = []
    }
  }

  const gap = () => {
    flush()

    if (blocks.length > 0 && (blocks.at(-1) as Block).kind !== 'gap') {
      blocks.push({ kind: 'gap', spans: [], indent: 0, bullet: '' })
    }
  }

  const styled = (text: string): Span => ({
    text,
    ...(bold > 0 ? { bold: true } : {}),
    ...(italic > 0 ? { italic: true } : {}),
    ...(code > 0 ? { color: CODE_COLOR } : {}),
  })

  const addText = (raw: string) => {
    const text = clean(decode(raw))

    if (pre > 0) {
      const rows = text.split('\n')

      rows.forEach((row, index) => {
        if (index > 0) {
          push('pre')
        }

        if (row !== '') {
          spans.push(styled(row))
        }
      })

      return
    }

    const flat = text.replace(/\s+/g, ' ')
    const piece = spans.length === 0 ? flat.trimStart() : flat

    if (piece !== '') {
      spans.push(styled(piece))
    }
  }

  const closePre = () => {
    if (spans.length > 0) {
      push('pre')
    }

    while (blocks.length > preStart && (blocks.at(-1) as Block).spans.length === 0) {
      blocks.pop()
    }

    while (blocks.length > preStart && (blocks[preStart] as Block).spans.length === 0) {
      blocks.splice(preStart, 1)
    }
  }

  for (const match of html.matchAll(TOKEN)) {
    const [, slash, rawName, , text, stray] = match

    if (rawName === undefined) {
      if (skipping === '' && (text !== undefined || stray !== undefined)) {
        addText(text ?? '<')
      }

      continue
    }

    const name = rawName.toLowerCase()
    const isClose = slash === '/'

    if (skipping !== '') {
      skipping = isClose && name === skipping ? '' : skipping
      continue
    }

    if (SKIPPED.has(name)) {
      skipping = isClose ? '' : name
      continue
    }

    if (BOLD.has(name)) {
      bold = Math.max(0, bold + (isClose ? -1 : 1))
    }

    if (ITALIC.has(name)) {
      italic = Math.max(0, italic + (isClose ? -1 : 1))
    }

    if (CODE.has(name)) {
      code = Math.max(0, code + (isClose ? -1 : 1))
    }

    if (name === 'pre') {
      if (isClose && pre > 0) {
        closePre()
        pre -= 1
        gap()
      } else if (!isClose) {
        gap()
        pre += 1
        preStart = blocks.length
      }
    } else if (name === 'br') {
      if (pre > 0) {
        push('pre')
      } else {
        flush()
      }
    } else if (name === 'ul' || name === 'ol') {
      if (isClose) {
        flush()
        lists.pop()
      }

      if (lists.length === 0) {
        gap()
      } else {
        flush()
      }

      if (!isClose) {
        lists.push({ isOrdered: name === 'ol', count: 0 })
      }
    } else if (name === 'li') {
      flush()

      if (isClose) {
        hangs.pop()
      } else {
        const list = lists.at(-1)

        if (list !== undefined) {
          list.count += 1
        }

        bullet = list?.isOrdered === true ? `${list.count}. ` : '• '
        hangs.push(bullet.length)
      }
    } else if (name === 'tr') {
      flush()
    } else if ((name === 'td' || name === 'th') && !isClose && spans.length > 0) {
      spans.push({ text: ' | ', dim: true })
    } else if (name === 'sup' && !isClose) {
      addText('^')
    } else if (name === 'sub' && !isClose) {
      addText('_')
    } else if (name === 'img') {
      addText('[image]')
    } else if (GAPPED.has(name)) {
      gap()
    }
  }

  if (pre > 0) {
    closePre()
  }

  flush()

  while (blocks.length > 0 && (blocks.at(-1) as Block).kind === 'gap') {
    blocks.pop()
  }

  return blocks
}

/** A preformatted row as it is where it fits; a longer one wrapped at words under its own indent. */
const preRows = (spans: Line, width: number): Line[] => {
  if (widthOf(spans) <= width) {
    return [spans]
  }

  const text = spans.map(span => span.text).join('')
  const indent = Math.min(text.length - text.trimStart().length, Math.floor(width / 2))

  if (!/\S\s+\S/.test(text)) {
    return chunkLine(spans, width)
  }

  return wrapLine(spans, width - indent).map(row => (indent === 0 ? row : [{ text: ' '.repeat(indent) }, ...row]))
}

/** Lays blocks out as rows no wider than `width`. */
export const layout = (blocks: readonly Block[], width: number): Line[] => {
  const lines: Line[] = []

  for (const block of blocks) {
    if (block.kind === 'gap') {
      lines.push([])
    } else if (block.kind === 'pre') {
      for (const row of preRows(block.spans, width - 2)) {
        lines.push([{ text: '│ ', dim: true }, ...row])
      }
    } else {
      const lead = ' '.repeat(block.indent) + block.bullet
      const hang = ' '.repeat(lead.length)
      const rows = wrapLine(block.spans, width - lead.length)

      rows.forEach((row, index) => {
        const head = index === 0 ? lead : hang

        lines.push(head === '' ? row : [{ text: head }, ...row])
      })
    }
  }

  return lines
}
