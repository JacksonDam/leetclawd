import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  InputProps,
  RenderElement,
  TextProps,
} from 'claude-code'

import type {
  Account,
  Judge,
  Line,
  Problem,
  ProblemList,
  ProblemState,
  ProblemSummary,
  Screen,
  Shown,
  Span,
  Tab,
  Tone,
  View,
  Work,
} from '../types'

import { BROWSER_NAMES } from './browsers'
import type { Browser } from './browsers'
import type { EditorProps } from './editor'
import { tokenize } from './highlight'
import { layout, parse } from './html'
import { draftKey } from './leetcode'
import { chunkText, clamp, oneLine, sliceLine, truncate, widthOf, wrapText } from './text'

/** The elements a surface draws with; the ones only some surfaces have are optional. */
export type Kit = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Input?: ElementConstructor<InputProps>
  /** Draws the code editor in a region of that size, where the surface can run and focus one. */
  editor?: (props: EditorProps, width: number, height: number) => RenderElement
}

export type Model = {
  site: Exclude<Shown, 'none'>
  view: View
  list: ProblemList
  problem: ProblemState
  work: Work
  judge: Judge | null
  account: Account
  code: string
  /** The browsers found on this machine, whose leetcode.com session can be taken up. */
  browsers: Record<Browser, boolean>
  /** The key that leads a shortcut typed in an empty prompt box. */
  leader: string
  /** How long Claude thinks before `/leetclawd` shows it, in seconds. */
  delaySeconds: number
}

export type Panel = 'desc' | 'code' | 'result' | 'list' | 'help'

export type Actions = {
  show: (screen: Screen) => void
  tab: (tab: Tab) => void
  scroll: (by: number) => void
  open: (slug: string) => void
  search: (text: string) => void
  difficulty: (value: string) => void
  page: (by: number) => void
  daily: () => void
  random: () => void
  reload: () => void
  run: () => void
  submit: () => void
  lang: (slug: string) => void
  reset: () => void
  editInPrompt: () => void
  signIn: (cookie: string) => void
  signOut: () => void
  verify: () => void
  importFrom: (browser: Browser) => void
  more: () => void
}

export type Size = { columns: number; rows: number }

export type Rect = { top: number; left: number; width: number; height: number }

/** Where each part sits in the drawing: the rows kept for header, buttons and notice, and each panel. */
export type Frame = {
  layout: 'small' | 'stacked' | 'split' | 'single'
  /** True in a site too short for a header and a help row: the panels' titles say where one is. */
  isCompact: boolean
  headerRows: number
  noticeRows: number
  body: Rect
  tools: Tool[][]
  panels: Partial<Record<Panel, Rect>>
}

export type Limits = Record<Panel, number>

type Tool = {
  id: string
  label: string
  hotkey: string
  width: number
  isDim: boolean
}

const GAP = 2
const COMPACT_UNDER = 12
const TONES: Record<Tone, string | undefined> = { ok: 'success', bad: 'error', warn: 'warning', plain: undefined }
const DIFFICULTIES: Record<string, string> = { Easy: 'success', Medium: 'warning', Hard: 'error' }
const LEVELS = ['', 'EASY', 'MEDIUM', 'HARD']
const LEVEL_NAMES: Record<string, string> = { '': 'All', EASY: 'Easy', MEDIUM: 'Medium', HARD: 'Hard' }

const langName = (problem: Problem | null, lang: string): string =>
  problem?.snippets.find(snippet => snippet.langSlug === lang)?.lang ?? lang

const layoutOf = (size: Size): Frame['layout'] => {
  if (size.columns < 40 || size.rows < 5) {
    return 'small'
  }

  if (size.rows >= 34) {
    return 'stacked'
  }

  return size.columns >= 110 ? 'split' : 'single'
}

const button = (id: string, hotkey: string, label: string, isDim = false): Tool => ({
  id,
  label,
  hotkey,
  width: label.length + 3,
  isDim,
})

const MORE = button('more', 'm', 'More')

/** The import buttons of the Account screen: each browser and the letter that presses it. */
const IMPORTS: [Browser, string][] = [
  ['safari', 'i'],
  ['chrome', 'g'],
  ['firefox', 'f'],
]

/** The keys that pick a row: the digits, then the letters no button of that screen takes. */
const rowKeys = (taken: string): string[] => [...'123456789abcdefghijklmnopqrstuvwxyz'].filter(key => !taken.includes(key))

const toolsOf = (model: Model, kind: Frame['layout']): Tool[] => {
  const { view, problem } = model
  const hasProblem = problem.data !== null

  if (view.screen === 'list') {
    return [
      button('next', 'n', 'Next'),
      button('back', 'b', 'Back'),
      button('daily', 'y', 'Daily'),
      button('random', 'x', 'Random'),
      ...(hasProblem ? [button('problem', 'c', 'Current problem')] : []),
      button('account', 'a', 'Account'),
      button('help', 'h', 'Help'),
      button('reload', 'u', 'Reload'),
    ]
  }

  if (view.screen === 'langs') {
    return [button('problem', 'c', 'Back to the problem'), button('help', 'h', 'Help')]
  }

  if (view.screen === 'help') {
    return [button('leave', 'c', 'Back'), button('down', 'j', '↓'), button('up', 'k', '↑')]
  }

  if (view.screen === 'account') {
    return [
      ...IMPORTS.filter(([browser]) => model.browsers[browser]).map(([browser, hotkey]) =>
        button(browser, hotkey, `Import ${BROWSER_NAMES[browser]}`),
      ),
      button('verify', 'v', 'Verify'),
      button('signout', 'o', 'Sign out'),
      button('list', 'p', 'Problems'),
      ...(hasProblem ? [button('problem', 'c', 'Current problem')] : []),
      button('help', 'h', 'Help'),
    ]
  }

  const tabs =
    kind === 'stacked'
      ? []
      : [
          button('desc', 'd', 'Description', view.tab !== 'desc'),
          ...(kind === 'single' ? [button('code', 'c', 'Code', view.tab !== 'code')] : []),
          button('result', 't', 'Result', view.tab !== 'result'),
        ]
  const name = langName(problem.data, model.work.lang)

  return [
    button('run', 'r', 'Run'),
    button('submit', 's', 'Submit'),
    ...tabs,
    button('list', 'p', 'Problems'),
    button('down', 'j', '↓'),
    button('up', 'k', '↑'),
    ...((problem.data?.snippets.length ?? 0) > 1 ? [button('langs', 'l', name)] : []),
    button('prompt', 'e', 'Edit in prompt'),
    button('reset', 'z', 'Reset'),
    button('account', 'a', 'Account'),
    button('help', 'h', 'Help'),
  ]
}

/** Tools laid in rows of `columns` cells, in order; one wider than a row is left out. */
const pack = (tools: readonly Tool[], columns: number): Tool[][] => {
  const rows: Tool[][] = [[]]
  let used = 0

  for (const tool of tools) {
    if (tool.width > columns) {
      continue
    }

    if (used > 0 && used + GAP + tool.width > columns) {
      rows.push([])
      used = 0
    }

    ;(rows.at(-1) as Tool[]).push(tool)
    used += (used > 0 ? GAP : 0) + tool.width
  }

  return rows
}

/** The button rows on show: all of them where they fit in `most` rows, else one page and a More button. */
const toolRowsOf = (model: Model, kind: Frame['layout'], columns: number, most: number): Tool[][] => {
  const tools = toolsOf(model, kind)
  const whole = pack(tools, columns)

  if (whole.length <= most) {
    return whole
  }

  const rows = pack(tools, columns - MORE.width - GAP)
  const pages = Math.ceil(rows.length / most)
  const page = ((model.view.toolPage % pages) + pages) % pages
  const shown = rows.slice(page * most, page * most + most)

  return shown.map((row, index) => (index === shown.length - 1 ? [...row, MORE] : row))
}

/** The geometry of a drawing of `model` in `size` cells. */
export const frameOf = (model: Model, size: Size): Frame => {
  const kind = layoutOf(size)
  const isCompact = size.rows < COMPACT_UNDER
  const headerRows = isCompact ? 0 : 1
  const noticeRows = isCompact && model.view.notice === '' ? 0 : 1
  const tools = kind === 'small' ? [] : toolRowsOf(model, kind, size.columns, isCompact ? 1 : 2)
  const body: Rect = {
    top: headerRows,
    left: 0,
    width: size.columns,
    height: Math.max(2, size.rows - headerRows - noticeRows - tools.length),
  }
  const frame = { layout: kind, isCompact, headerRows, noticeRows, body, tools }

  if (kind === 'small' || model.view.screen === 'account' || model.view.screen === 'langs') {
    return { ...frame, panels: {} }
  }

  if (model.view.screen === 'help') {
    return { ...frame, panels: { help: body } }
  }

  if (model.view.screen === 'list') {
    return { ...frame, panels: { list: { ...body, top: body.top + 2, height: Math.max(1, body.height - 2) } } }
  }

  if (kind === 'stacked') {
    const result = model.judge === null ? 3 : clamp(Math.round(body.height * 0.32), 6, 18)
    const desc = clamp(Math.round(body.height * (model.judge === null ? 0.36 : 0.3)), 6, body.height - result - 8)
    const code = body.height - desc - result

    return {
      ...frame,
      panels: {
        desc: { ...body, height: desc },
        code: { ...body, top: body.top + desc, height: code },
        result: { ...body, top: body.top + desc + code, height: result },
      },
    }
  }

  if (kind === 'split') {
    const left = clamp(Math.round(body.width * 0.42), 40, 80)
    const side: Rect = { ...body, width: left }

    return {
      ...frame,
      panels: {
        ...(model.view.tab === 'result' ? { result: side } : { desc: side }),
        code: { ...body, left: left + 1, width: body.width - left - 1 },
      },
    }
  }

  return { ...frame, panels: { [model.view.tab]: body } }
}

/** The panel a cell of the drawing belongs to, for a wheel over it. */
export const panelAt = (frame: Frame, row: number, column: number): Panel | undefined =>
  (Object.entries(frame.panels) as [Panel, Rect][]).find(
    ([, rect]) =>
      row >= rect.top && row < rect.top + rect.height && column >= rect.left && column < rect.left + rect.width,
  )?.[0]

/** The panel the scroll buttons move: the statement, or what stands in its place. */
export const scrolledPanel = (model: Model, frame: Frame): Panel | undefined => {
  if (model.view.screen === 'list') {
    return 'list'
  }

  if (model.view.screen === 'help') {
    return 'help'
  }

  if (model.view.screen !== 'problem') {
    return undefined
  }

  if (frame.layout === 'stacked') {
    return 'desc'
  }

  if (frame.layout === 'split') {
    return model.view.tab === 'result' ? 'result' : 'desc'
  }

  return model.view.tab
}

let statement: { key: string; lines: Line[] } | undefined

const statementLines = (problem: Problem, width: number): Line[] => {
  const key = `${problem.slug}:${width}:${problem.content.length}`

  if (statement?.key === key) {
    return statement.lines
  }

  const body =
    problem.content.trim() === ''
      ? wrapText(
          problem.isPaidOnly
            ? 'This is a premium problem: LeetCode shows its statement to subscribers only. Sign in with a premium account on the Account screen, or pick another problem.'
            : 'LeetCode sent no statement for this problem.',
          width,
          { dim: true },
        )
      : layout(parse(problem.content), width)
  const topics: Line[] =
    problem.topics.length === 0 ? [] : [[], ...wrapText(`Topics: ${problem.topics.join(', ')}`, width, { dim: true })]
  const lines = [...body, ...topics]

  statement = { key, lines }

  return lines
}

const descLines = (state: ProblemState, width: number): Line[] => {
  if (state.data !== null && state.status !== 'loading') {
    return statementLines(state.data, width)
  }

  if (state.status === 'failed') {
    return wrapText(state.error, width, { color: 'error' })
  }

  return wrapText(state.status === 'loading' ? `Loading ${state.slug}…` : 'No problem is open: p lists them.', width, {
    dim: true,
  })
}

const codeLines = (model: Model, width: number): Line[] => {
  const rows = model.code.split('\n')
  const gutter = Math.max(2, String(rows.length).length) + 1

  return rows.map((text, index) => [
    { text: `${String(index + 1).padStart(gutter - 1)} `, dim: true },
    ...sliceLine(tokenize(text, model.work.lang), 0, Math.max(1, width - gutter)),
  ])
}

const indented = (lines: Line[]): Line[] => lines.map(line => (line.length === 0 ? line : [{ text: '  ' }, ...line]))

const resultLines = (judge: Judge | null, width: number): Line[] => {
  if (judge === null) {
    return wrapText('No result yet: r runs the examples on LeetCode, s submits your solution.', width, { dim: true })
  }

  if (judge.status === 'pending') {
    const doing = judge.kind === 'run' ? 'Running the examples' : 'Judging your submission'

    return wrapText(`${doing} on LeetCode… ${judge.seconds}s`, width, { color: 'warning' })
  }

  if (judge.status === 'failed' || judge.verdict === null) {
    return wrapText(judge.error === '' ? 'The judge gave no verdict.' : judge.error, width, { color: 'error' })
  }

  const { verdict } = judge
  const tone = TONES[verdict.tone]
  const head: Line = [
    { text: verdict.headline, bold: true, ...(tone === undefined ? {} : { color: tone }) },
    { text: judge.kind === 'run' ? '  (run)' : '  (submission)', dim: true },
  ]

  return [
    head,
    ...(verdict.detail === '' ? [] : wrapText(verdict.detail, width)),
    ...verdict.sections.flatMap(part => {
      const color = TONES[part.tone]

      return [
        [],
        [{ text: part.label, bold: true, ...(color === undefined ? {} : { color }) }],
        ...indented(chunkText(part.text, width - 2)),
      ]
    }),
  ]
}

/** A row of the help page that names a command or key, its meaning wrapped beside it. */
const entry = (name: string, meaning: string, width: number): Line[] => {
  const lead = 15

  if (width < lead + 20) {
    return [[{ text: name, color: 'suggestion' }], ...indented(wrapText(meaning, width - 2))]
  }

  return wrapText(meaning, width - lead).map((line, index) => [
    index === 0 ? { text: `  ${truncate(name, lead - 3)}`.padEnd(lead), color: 'suggestion' } : { text: ' '.repeat(lead) },
    ...line,
  ])
}

/** The help page: what LeetClawd is and every way to drive it. */
const helpLines = (model: Model, width: number): Line[] => {
  const key = model.leader
  const heading = (text: string): Line[] => [[], [{ text, bold: true }]]
  const browsers = (Object.keys(BROWSER_NAMES) as Browser[]).filter(browser => model.browsers[browser])
  const names = browsers.map(browser => BROWSER_NAMES[browser]).join(', ')

  return [
    ...wrapText('LeetCode inside Claude Code: read a problem, write a solution, run it and submit it.', width),
    ...heading('Showing and hiding'),
    ...entry('/leetclawd', `Show it once Claude has been thinking for more than ${model.delaySeconds}s; it goes when Claude is done.`, width),
    ...entry('/leetclawdf', 'Open it now and keep it open, whatever Claude is doing. Typed again, it closes it.', width),
    ...entry(`${key}${key}`, 'Show or hide it at once. Typed in an empty prompt box.', width),
    ...entry('/unleetclawd', 'Turn it off and clear the open problem, your drafts and the last result.', width),
    ...heading('Pressing buttons'),
    ...entry(`${key} + letter`, `Typed in an empty prompt box, presses the button with that letter: ${key}r runs, ${key}s submits, ${key}h is this page.`, width),
    ...entry(`${key}1 to ${key}9`, 'On the problem list, open the row with that number.', width),
    ...entry('click', 'Any button, or a row of the list.', width),
    ...entry('ctrl+x tab', 'Give LeetClawd the keyboard: then a letter alone presses its button, tab and enter walk and press. esc returns to the prompt.', width),
    ...heading('Writing code'),
    ...entry('click code', 'Type in it. esc returns to the prompt.', width),
    ...entry('ctrl+r', 'Run the examples on LeetCode.', width),
    ...entry('ctrl+s', 'Submit; enter confirms, any other key cancels.', width),
    ...entry('moving', 'Arrows, home, end, page up and page down; option or ctrl with left and right moves by words.', width),
    ...entry('editing', 'tab and shift+tab indent; ctrl+k, ctrl+u and ctrl+w delete to the end, to the start, and a word.', width),
    ...entry('e', 'Put the code in the prompt box, for pasting or your own editor (ctrl+g). enter there saves it back, and sends nothing to Claude.', width),
    ...entry('l, z', 'Pick the language; z twice brings the starting code back.', width),
    ...heading('Signing in'),
    ...wrapText(
      `Run and Submit use your LeetCode account. On the Account screen (a), ${
        names === '' ? 'paste' : `import the session of a browser you are signed in with (${names}), or paste`
      } the LEETCODE_SESSION cookie. However you signed in there, Google included, no password is asked.`,
      width,
    ),
    ...(model.browsers.chrome
      ? wrapText('Chrome keeps its cookies locked: macOS asks you before it unlocks them.', width)
      : []),
    ...wrapText('The session is kept on this machine and sent only to leetcode.com.', width),
    ...heading('Settings'),
    ...wrapText(
      `/plugin configure leetclawd@leetclawd sets the default language, the seconds of thinking before it shows, and the shortcut key (now ${key}).`,
      width,
    ),
  ]
}

/** The rows each panel holds at the widths `frame` gives them. */
const contentOf = (model: Model, frame: Frame): Record<Panel, Line[]> => ({
  desc: frame.panels.desc === undefined ? [] : descLines(model.problem, frame.panels.desc.width),
  code: frame.panels.code === undefined ? [] : codeLines(model, frame.panels.code.width),
  result: frame.panels.result === undefined ? [] : resultLines(model.judge, frame.panels.result.width),
  list: [],
  help: frame.panels.help === undefined ? [] : helpLines(model, frame.panels.help.width),
})

const limitsOf = (model: Model, frame: Frame, content: Record<Panel, Line[]>): Limits => {
  const room = (panel: Panel) => Math.max(1, (frame.panels[panel]?.height ?? 2) - 1)

  return {
    desc: Math.max(0, content.desc.length - room('desc')),
    code: Math.max(0, content.code.length - room('code')),
    result: Math.max(0, content.result.length - room('result')),
    list: Math.max(0, model.list.items.length - (frame.panels.list?.height ?? 1)),
    help: Math.max(0, content.help.length - room('help')),
  }
}

const spanNode = (kit: Kit, span: Span) => {
  const isPlain =
    span.color === undefined && span.bold !== true && span.dim !== true && span.italic !== true && span.inverse !== true

  if (isPlain) {
    return span.text
  }

  return (
    <kit.Text
      {...(span.color === undefined ? {} : { color: span.color })}
      {...(span.bold === true ? { bold: true } : {})}
      {...(span.dim === true ? { dimColor: true } : {})}
      {...(span.italic === true ? { italic: true } : {})}
      {...(span.inverse === true ? { inverse: true } : {})}
    >
      {span.text}
    </kit.Text>
  )
}

const rowOf = (kit: Kit, line: Line, width: number) => {
  const cut = widthOf(line) > width ? sliceLine(line, 0, width) : line

  return (
    <kit.Box height={1} width={width} flexShrink={0} overflow="hidden">
      <kit.Text wrap="truncate-end">{cut.length === 0 ? ' ' : cut.map(span => spanNode(kit, span))}</kit.Text>
    </kit.Box>
  )
}

const titleLine = (title: string, note: string, width: number): Line => {
  const name = truncate(title, Math.max(1, width - note.length - 8))
  const rule = Math.max(1, width - name.length - note.length - (note === '' ? 4 : 6))

  return [
    { text: '─ ', dim: true },
    { text: name, bold: true },
    { text: ` ${'─'.repeat(rule)}${note === '' ? '' : ' '}`, dim: true },
    ...(note === '' ? [] : [{ text: note, dim: true }]),
    { text: ' ─', dim: true },
  ]
}

const position = (top: number, room: number, total: number): string =>
  total <= room ? '' : `${top + 1}-${Math.min(total, top + room)} of ${total}`

/** A titled panel showing a window of `lines`. */
const textPanel = (kit: Kit, title: string, lines: Line[], top: number, rect: Rect) => {
  const room = Math.max(1, rect.height - 1)
  const start = clamp(top, 0, Math.max(0, lines.length - room))

  return (
    <kit.Box flexDirection="column" width={rect.width} height={rect.height} flexShrink={0} overflow="hidden">
      {rowOf(kit, titleLine(title, position(start, room, lines.length), rect.width), rect.width)}
      {lines.slice(start, start + room).map(line => rowOf(kit, line, rect.width))}
    </kit.Box>
  )
}

const codePanel = (kit: Kit, model: Model, lines: Line[], rect: Rect) => {
  const { data } = model.problem
  const title = `Code · ${langName(data, model.work.lang)}`

  if (kit.editor === undefined || data === null || model.problem.status !== 'ready') {
    const shown =
      data === null
        ? wrapText('Open a problem to write a solution.', rect.width, { dim: true })
        : [
            ...lines,
            [],
            ...wrapText('Read-only here: e puts the code in the prompt box to edit, Enter there saves it back.', rect.width, {
              dim: true,
            }),
          ]

    return textPanel(kit, title, shown, model.view.codeTop, rect)
  }

  return (
    <kit.Box flexDirection="column" width={rect.width} height={rect.height} flexShrink={0} overflow="hidden">
      {rowOf(kit, titleLine(title, '', rect.width), rect.width)}
      {kit.editor(
        {
          id: draftKey(data.slug, model.work.lang),
          rev: model.work.rev,
          code: model.code,
          lang: model.work.lang,
          wheel: model.view.wheel,
        },
        rect.width,
        Math.max(2, rect.height - 1),
      )}
    </kit.Box>
  )
}

const LIST_KEYS = [...'123456789']
const LANG_KEYS = rowKeys('ch')

/** The rows of the problem list on show. */
const listWindow = (model: Model, frame: Frame): ProblemSummary[] => {
  const height = (frame.panels.list ?? frame.body).height
  const top = clamp(model.view.listTop, 0, Math.max(0, model.list.items.length - height))

  return model.list.items.slice(top, top + height)
}

const listRow = (kit: Kit, item: ProblemSummary, pick: string, width: number, act: Actions) => {
  const room = Math.max(8, width - 28)
  const title = truncate(`${item.title}${item.isPaidOnly ? ' (premium)' : ''}`, room).padEnd(room)
  const isSolved = item.status === 'ac'
  const mark = isSolved ? '✓' : item.status === 'notac' ? '~' : ' '
  const tone = DIFFICULTIES[item.difficulty]

  return (
    <kit.Box height={1} width={width} flexShrink={0} overflow="hidden">
      <kit.Button key={`open:${item.slug}`} plain onPress={() => act.open(item.slug)}>
        <kit.Text color="suggestion">{pick.padEnd(2)}</kit.Text>
        <kit.Text {...(isSolved ? { color: 'success' } : { dimColor: true })}>{mark}</kit.Text>
        {` ${item.id.padStart(5)}  ${title}  `}
        <kit.Text {...(tone === undefined ? {} : { color: tone })}>{item.difficulty.padEnd(8)}</kit.Text>
        <kit.Text dimColor>{`${item.acRate.toFixed(1)}%`.padStart(6)}</kit.Text>
      </kit.Button>
    </kit.Box>
  )
}

const listBody = (kit: Kit, model: Model, act: Actions, frame: Frame) => {
  const { list, view } = model
  const { width, height } = frame.body
  const rect = frame.panels.list ?? frame.body
  const top = clamp(view.listTop, 0, Math.max(0, list.items.length - rect.height))
  const shown = listWindow(model, frame)
  const note =
    list.status === 'loading'
      ? 'loading…'
      : list.items.length === 0
        ? ''
        : `${top + 1}-${top + shown.length} of ${list.total}`
  const message =
    list.status === 'failed'
      ? wrapText(`${list.error} Press u to try again.`, width, { color: 'error' })
      : list.status === 'ready' && list.items.length === 0
        ? wrapText('No problem matches.', width, { dim: true })
        : list.items.length === 0
          ? wrapText('Loading problems…', width, { dim: true })
          : []
  const level = LEVELS.includes(list.difficulty) ? list.difficulty : ''
  const nextLevel = LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length] ?? ''

  return (
    <kit.Box flexDirection="column" width={width} height={height} flexShrink={0} overflow="hidden">
      <kit.Box height={1} width={width} flexShrink={0} gap={GAP} overflow="hidden">
        <kit.Button
          key="difficulty"
          plain
          hotkey="f"
          label={`Difficulty: ${LEVEL_NAMES[level] ?? 'All'}`}
          onPress={() => act.difficulty(nextLevel)}
        />
        {kit.Input === undefined ? null : (
          <kit.Input
            key="search"
            label="Search"
            placeholder="title or number, then Enter"
            value={list.search}
            submitLabel="search"
            onSubmit={value => act.search(value)}
          />
        )}
      </kit.Box>
      {rowOf(kit, titleLine('Problems', note, width), width)}
      {message.map(line => rowOf(kit, line, width))}
      {shown.map((item, index) => listRow(kit, item, LIST_KEYS[index] ?? '', width, act))}
    </kit.Box>
  )
}

/** The languages a problem can be solved in, as buttons in as many columns as fit. */
const langsBody = (kit: Kit, model: Model, act: Actions, frame: Frame) => {
  const { width, height } = frame.body
  const snippets = model.problem.data?.snippets ?? []
  const cell = Math.max(...snippets.map(snippet => snippet.lang.length), 8) + 6
  const perRow = Math.max(1, Math.floor(width / cell))
  const rows = Array.from({ length: Math.ceil(snippets.length / perRow) }, (_, index) =>
    snippets.slice(index * perRow, (index + 1) * perRow),
  )

  return (
    <kit.Box flexDirection="column" width={width} height={height} flexShrink={0} overflow="hidden">
      {rowOf(kit, titleLine('Language', '', width), width)}
      {rows.slice(0, Math.max(1, height - 1)).map(row => (
        <kit.Box height={1} width={width} flexShrink={0} overflow="hidden">
          {row.map(snippet => (
            <kit.Box width={cell} height={1} flexShrink={0} overflow="hidden">
              <kit.Button key={`lang:${snippet.langSlug}`} plain onPress={() => act.lang(snippet.langSlug)}>
                <kit.Text color="suggestion">{(LANG_KEYS[snippets.indexOf(snippet)] ?? '').padEnd(2)}</kit.Text>
                {`${snippet.langSlug === model.work.lang ? '●' : ' '} ${snippet.lang}`}
              </kit.Button>
            </kit.Box>
          ))}
        </kit.Box>
      ))}
    </kit.Box>
  )
}

const SOURCES: Record<Account['source'], string> = {
  none: '',
  option: 'the cookie in this plugin’s options',
  env: 'the LEETCODE_SESSION environment variable',
  saved: 'the session saved from this screen',
}

const VIAS: Record<Account['via'], string> = {
  none: '',
  paste: 'the cookie pasted on this screen',
  safari: 'the session imported from Safari',
  chrome: 'the session imported from Chrome',
  firefox: 'the session imported from Firefox',
}

const accountBody = (kit: Kit, model: Model, act: Actions, frame: Frame) => {
  const { account } = model
  const { width, height } = frame.body
  const status: Line[] =
    account.status === 'in'
      ? wrapText(
          `Signed in as @${account.username}, using ${
            account.source === 'saved' && VIAS[account.via] !== '' ? VIAS[account.via] : SOURCES[account.source]
          }.`,
          width,
          { color: 'success' },
        )
      : account.status === 'checking'
        ? wrapText('Checking your LeetCode session…', width, { dim: true })
        : wrapText(
            account.error === ''
              ? 'Not signed in. Problems can be read without an account; Run and Submit use your own LeetCode session.'
              : account.error,
            width,
            account.error === '' ? {} : { color: 'error' },
          )
  const offered = IMPORTS.filter(([browser]) => model.browsers[browser])
  const steps = [
    ...(offered.length > 0
      ? [
          `Signed in to leetcode.com in a browser, with Google or any other way? Import that session, and no password is asked: ${offered
            .map(([browser, hotkey]) => `${hotkey} for ${BROWSER_NAMES[browser]}`)
            .join(', ')}.${model.browsers.chrome ? ' Chrome keeps its cookies locked: macOS asks you before it unlocks them.' : ''}`,
          '',
          'Or by hand, from any browser:',
        ]
      : []),
    '1. Sign in at leetcode.com in your browser.',
    '2. Open the developer tools: Application (or Storage) → Cookies → https://leetcode.com.',
    '3. Copy the value of the LEETCODE_SESSION cookie, paste it in the field above, then press Enter.',
    '',
    'The session is kept in this plugin’s store on this machine and is sent only to leetcode.com. Sign out removes it.',
  ].flatMap(step => (step === '' ? [[]] : wrapText(step, width, { dim: true })))

  return (
    <kit.Box flexDirection="column" width={width} height={height} flexShrink={0} overflow="hidden">
      {rowOf(kit, titleLine('Account', '', width), width)}
      {status.map(line => rowOf(kit, line, width))}
      <kit.Box height={1} width={width} flexShrink={0} overflow="hidden">
        {kit.Input === undefined ? (
          <kit.Text dimColor>This surface has no text field: set the plugin’s session option instead.</kit.Text>
        ) : (
          <kit.Input
            key="cookie"
            label="LEETCODE_SESSION"
            placeholder="paste the cookie value, then Enter"
            value=""
            submitLabel="sign in"
            onSubmit={value => act.signIn(value)}
          />
        )}
      </kit.Box>
      {rowOf(kit, [], width)}
      {steps.map(line => rowOf(kit, line, width))}
    </kit.Box>
  )
}

/** The statement's title: with no header above it, it names the problem too. */
const descTitle = (model: Model, frame: Frame): string => {
  const { data } = model.problem

  return frame.isCompact && data !== null ? `${data.id}. ${data.title} (${data.difficulty})` : 'Description'
}

const problemBody = (kit: Kit, model: Model, frame: Frame, content: Record<Panel, Line[]>) => {
  const { desc, code, result } = frame.panels
  const { view } = model
  const parts = [
    desc === undefined ? null : textPanel(kit, descTitle(model, frame), content.desc, view.descTop, desc),
    code === undefined ? null : codePanel(kit, model, content.code, code),
    result === undefined ? null : textPanel(kit, 'Result', content.result, view.resultTop, result),
  ]

  if (frame.layout !== 'split' || code === undefined) {
    return (
      <kit.Box flexDirection="column" width={frame.body.width} height={frame.body.height} flexShrink={0} overflow="hidden">
        {parts}
      </kit.Box>
    )
  }

  return (
    <kit.Box flexDirection="row" width={frame.body.width} height={frame.body.height} flexShrink={0} overflow="hidden">
      {parts[0] ?? parts[2]}
      <kit.Box flexDirection="column" width={1} height={frame.body.height} flexShrink={0} overflow="hidden">
        {Array.from({ length: frame.body.height }, () => (
          <kit.Text dimColor>│</kit.Text>
        ))}
      </kit.Box>
      {parts[1]}
    </kit.Box>
  )
}

const headerLine = (model: Model, width: number): Line => {
  const { account, problem, view, list } = model
  const who: Span =
    account.status === 'in'
      ? { text: `@${account.username}`, color: 'success' }
      : { text: account.status === 'checking' ? 'checking sign-in…' : 'not signed in', dim: true }
  const brand: Line = [{ text: 'LeetClawd', bold: true, color: 'claude' }, { text: '  ' }]
  const room = Math.max(1, width - widthOf(brand) - who.text.length - 2)
  const tone = problem.data === null ? undefined : DIFFICULTIES[problem.data.difficulty]
  const context: Line =
    view.screen === 'account' || view.screen === 'help'
      ? [{ text: view.screen === 'help' ? 'Help' : 'Account' }]
      : view.screen === 'list' || problem.data === null
        ? [
            { text: view.screen === 'list' ? 'Problems' : 'No problem open' },
            ...(list.total > 0 ? [{ text: `  ${list.total}`, dim: true }] : []),
          ]
        : [
            {
              text: truncate(
                `${problem.data.id}. ${problem.data.title}`,
                Math.max(4, room - problem.data.difficulty.length - 2),
              ),
              bold: true,
            },
            { text: '  ' },
            { text: problem.data.difficulty, ...(tone === undefined ? {} : { color: tone }) },
          ]
  const left = sliceLine([...brand, ...context], 0, width - who.text.length - 2)

  return [...left, { text: ' '.repeat(Math.max(1, width - widthOf(left) - who.text.length)) }, who]
}

/** The one row of help under the buttons: the keys that reach what is on screen. */
const hintOf = (model: Model, kit: Kit, frame: Frame): string => {
  const key = model.leader
  const always = `${key}${key} hide · ${key}h help`

  if (model.view.screen === 'list') {
    return `${key}1-${key}9 open a row · ${key}+letter: a button · ${always}`
  }

  if (model.view.screen === 'account') {
    return `${key}+letter: a button · click the field to paste · ${always}`
  }

  if (model.view.screen === 'langs') {
    return `${key}+its key picks a language · ${always}`
  }

  if (model.view.screen === 'help') {
    return `${key}j ${key}k scroll · ${key}c back · ${key}${key} hide`
  }

  if (kit.editor === undefined) {
    return `${key}+letter: a button · ${key}e edits code in the prompt box · ${always}`
  }

  return frame.panels.code === undefined
    ? `${key}+letter: a button · ${key}c your code · ${always}`
    : `click the code to type · ${key}+letter: a button · ${always}`
}

/** What each button does, by its id. */
const handlersOf = (model: Model, act: Actions): Record<string, () => void> => ({
  next: () => act.page(1),
  back: () => act.page(-1),
  daily: act.daily,
  random: act.random,
  reload: act.reload,
  problem: () => act.show('problem'),
  account: () => act.show('account'),
  list: () => act.show('list'),
  help: () => act.show('help'),
  leave: () => act.show(model.view.from === 'help' ? 'list' : model.view.from),
  verify: act.verify,
  safari: () => act.importFrom('safari'),
  chrome: () => act.importFrom('chrome'),
  firefox: () => act.importFrom('firefox'),
  signout: act.signOut,
  run: act.run,
  submit: act.submit,
  desc: () => act.tab('desc'),
  code: () => act.tab('code'),
  result: () => act.tab('result'),
  down: () => act.scroll(1),
  up: () => act.scroll(-1),
  prompt: act.editInPrompt,
  reset: act.reset,
  langs: () => act.show('langs'),
  more: act.more,
})

/**
 * What each key does after the shortcut key, for the screen as drawn: every button's letter, whether
 * its page of buttons is the one on show or not, and the keys of the rows.
 */
export const shortcutsOf = (model: Model, frame: Frame, act: Actions): Record<string, () => void> => {
  if (frame.layout === 'small') {
    return {}
  }

  const handlers = handlersOf(model, act)
  const keys: Record<string, () => void> = { '?': () => act.show('help') }

  for (const tool of [...toolsOf(model, frame.layout), ...frame.tools.flat()]) {
    const press = handlers[tool.id]

    if (press !== undefined) {
      keys[tool.hotkey] = press
    }
  }

  if (model.view.screen === 'list') {
    const level = LEVELS.includes(model.list.difficulty) ? model.list.difficulty : ''

    keys.f = () => act.difficulty(LEVELS[(LEVELS.indexOf(level) + 1) % LEVELS.length] ?? '')
    listWindow(model, frame).forEach((item, index) => {
      const pick = LIST_KEYS[index]

      if (pick !== undefined) {
        keys[pick] = () => act.open(item.slug)
      }
    })
  }

  if (model.view.screen === 'langs') {
    ;(model.problem.data?.snippets ?? []).forEach((snippet, index) => {
      const pick = LANG_KEYS[index]

      if (pick !== undefined) {
        keys[pick] = () => act.lang(snippet.langSlug)
      }
    })
  }

  return keys
}

/** Draws LeetClawd for `model` into `size` cells, and says how far each panel scrolls. */
export const draw = (
  kit: Kit,
  model: Model,
  act: Actions,
  size: Size,
): { tree: RenderElement; limits: Limits; frame: Frame } => {
  const frame = frameOf(model, size)
  const content = contentOf(model, frame)
  const limits = limitsOf(model, frame, content)
  const { columns, rows } = size

  if (frame.layout === 'small') {
    return {
      frame,
      limits,
      tree: (
        <kit.Box flexDirection="column" width={Math.max(1, columns)}>
          <kit.Text wrap="truncate-end">
            <kit.Text bold color="claude">
              LeetClawd
            </kit.Text>
            {` needs at least 40 by 5 cells here (it has ${columns} by ${rows}).`}
          </kit.Text>
        </kit.Box>
      ),
    }
  }

  const handlers = handlersOf(model, act)
  const body =
    model.view.screen === 'list'
      ? listBody(kit, model, act, frame)
      : model.view.screen === 'account'
        ? accountBody(kit, model, act, frame)
        : model.view.screen === 'langs'
          ? langsBody(kit, model, act, frame)
          : model.view.screen === 'help'
            ? textPanel(kit, 'Help', content.help, model.view.helpTop, frame.panels.help ?? frame.body)
            : problemBody(kit, model, frame, content)
  const notice = oneLine(model.view.notice)

  return {
    frame,
    limits,
    tree: (
      <kit.Box flexDirection="column" width={columns} height={rows} overflow="hidden">
        {frame.headerRows === 0 ? null : rowOf(kit, headerLine(model, columns), columns)}
        {body}
        {frame.tools.map(tools => (
          <kit.Box height={1} width={columns} flexShrink={0} gap={GAP} overflow="hidden">
            {tools.map(tool => (
              <kit.Button
                key={tool.id}
                plain
                hotkey={tool.hotkey}
                label={tool.label}
                {...(tool.isDim === true ? { dimColor: true } : {})}
                onPress={handlers[tool.id] ?? (() => {})}
              />
            ))}
          </kit.Box>
        ))}
        {frame.noticeRows === 0
          ? null
          : rowOf(
              kit,
              notice === '' ? [{ text: hintOf(model, kit, frame), dim: true }] : [{ text: notice, color: 'warning' }],
              columns,
            )}
      </kit.Box>
    ),
  }
}
