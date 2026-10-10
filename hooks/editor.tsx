import type { ClientModule, ClientSurface } from 'claude-code'

import type { Line } from '../types'

import { applyKey, fromText, place, toText } from './edit'
import type { Buffer, Key } from './edit'
import { tokenize } from './highlight'
import { sliceLine } from './text'

/** What the hooks module hands the editor: which draft, at which revision, and its text. */
export type EditorProps = {
  id: string
  rev: number
  code: string
  lang: string
  wheel: { seq: number; by: number }
}

type State = {
  id: string
  rev: number
  lang: string
  buffer: Buffer
  top: number
  left: number
  wheelSeq: number
  isConfirming: boolean
  hasFocus: boolean
}

const gutterOf = (count: number): number => Math.max(2, String(count).length) + 1

/** The window moved the least that shows the cursor in a region of that size. */
const follow = (state: State, columns: number, rows: number): State => {
  const textRows = Math.max(1, rows - 1)
  const textColumns = Math.max(1, columns - gutterOf(state.buffer.lines.length))
  const { row, col } = state.buffer
  const top = Math.max(0, Math.min(Math.max(row - textRows + 1, Math.min(state.top, row)), state.buffer.lines.length - 1))
  const left = Math.max(0, Math.max(col - textColumns + 1, Math.min(state.left, col)))

  return { ...state, top, left }
}

const load = (props: EditorProps): State => ({
  id: props.id,
  rev: props.rev,
  lang: props.lang,
  buffer: fromText(props.code),
  top: 0,
  left: 0,
  wheelSeq: props.wheel.seq,
  isConfirming: false,
  hasFocus: false,
})

const listen = (surface: ClientSurface<State>) => {
  surface.onKey(event => {
    const now = surface.state

    if (now === undefined) {
      return
    }

    const key: Key = event

    if (now.isConfirming) {
      const isConfirmed = key.key === 'return' || key.key === 'enter'

      surface.setState({ ...now, isConfirming: false, hasFocus: true })

      if (isConfirmed) {
        surface.post({ type: 'submit', id: now.id, code: toText(now.buffer) })
      }

      return
    }

    const outcome = applyKey(now.buffer, key, { lang: now.lang, page: Math.max(1, surface.rows - 2) })
    const next = follow(
      { ...now, buffer: outcome.buffer, isConfirming: outcome.command === 'submit', hasFocus: true },
      surface.columns,
      surface.rows,
    )

    surface.setState(next)

    if (outcome.command === 'run') {
      surface.post({ type: 'run', id: now.id, code: toText(now.buffer) })
    } else if (outcome.isEdit) {
      surface.post({ type: 'edit', id: now.id, code: toText(outcome.buffer) })
    }
  })

  surface.onPointer(event => {
    const now = surface.state

    if (now === undefined || event.type !== 'down') {
      return
    }

    const gutter = gutterOf(now.buffer.lines.length)
    const buffer = place(now.buffer, now.top + event.y, now.left + Math.max(0, event.x - gutter))

    surface.setState(follow({ ...now, buffer, isConfirming: false, hasFocus: true }, surface.columns, surface.rows))
  })
}

/** One row of code with the cursor's cell inverted. */
const withCursor = (line: Line, col: number): Line => {
  const width = line.reduce((total, span) => total + span.text.length, 0)
  const under = sliceLine(line, col, col + 1)[0]

  return [
    ...sliceLine(line, 0, col),
    { ...(under ?? { text: ' ' }), inverse: true },
    ...sliceLine(line, col + 1, width),
  ]
}

const Editor: ClientModule<EditorProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const held = surface.state
  const rows = Math.max(2, surface.rows)
  const columns = Math.max(12, surface.columns)
  const isStale = held === undefined || held.id !== props.id || held.rev !== props.rev
  const loaded = isStale ? load(props) : held
  const isWheeled = loaded.wheelSeq !== props.wheel.seq
  const last = Math.max(0, loaded.buffer.lines.length - (rows - 1))
  const state = isWheeled
    ? { ...loaded, wheelSeq: props.wheel.seq, top: Math.max(0, Math.min(last, loaded.top + props.wheel.by)) }
    : loaded

  if (held === undefined) {
    listen(surface)
  }

  if (isStale || isWheeled) {
    surface.setState(state)
  }

  const { buffer } = state
  const top = Math.max(0, Math.min(state.top, buffer.lines.length - 1))
  const left = Math.max(0, state.left)
  const gutter = gutterOf(buffer.lines.length)
  const textColumns = Math.max(1, columns - gutter)
  const visible = buffer.lines.slice(top, top + rows - 1)
  const status = state.isConfirming
    ? 'Submit to LeetCode? Enter confirms, any other key cancels'
    : `Ln ${buffer.row + 1}, Col ${buffer.col + 1} · ${state.hasFocus ? '' : 'click here to type · '}^R run · ^S submit · esc: prompt`

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      {visible.map((text, index) => {
        const row = top + index
        const spans = tokenize(text, state.lang)
        const line = sliceLine(row === buffer.row ? withCursor(spans, buffer.col) : spans, left, left + textColumns)

        return (
          <Box height={1} flexShrink={0} overflow="hidden">
            <Text dimColor>{`${String(row + 1).padStart(gutter - 1)} `}</Text>
            <Text wrap="truncate-end">
              {line.length === 0
                ? ' '
                : line.map(span =>
                    span.color === undefined && span.dim !== true && span.inverse !== true ? (
                      span.text
                    ) : (
                      <Text
                        {...(span.color === undefined ? {} : { color: span.color })}
                        {...(span.dim === true ? { dimColor: true } : {})}
                        {...(span.inverse === true ? { inverse: true } : {})}
                      >
                        {span.text}
                      </Text>
                    ),
                  )}
            </Text>
          </Box>
        )
      })}
      <Box flexGrow={1} />
      <Box height={1} flexShrink={0} overflow="hidden">
        <Text wrap="truncate-end" {...(state.isConfirming ? { color: 'warning' } : { dimColor: true })}>
          {status.slice(0, columns)}
        </Text>
      </Box>
    </Box>
  )
}

export default Editor
