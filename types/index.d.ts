export type Span = {
  text: string
  color?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  inverse?: boolean
}

export type Line = Span[]

export type Shown = 'none' | 'pane' | 'band'

export type Power = {
  /** `/leetclawd` was typed: it shows once Claude has been thinking long enough, and hides after. */
  isArmed: boolean
  /** `/leetclawdf` was typed: it is open and stays open, whatever Claude is doing. */
  isPinned: boolean
  shown: Shown
  turn: { id: string; startedAt: number } | null
}

export type Screen = 'list' | 'problem' | 'account' | 'langs' | 'help'

export type Tab = 'desc' | 'code' | 'result'

export type View = {
  screen: Screen
  tab: Tab
  descTop: number
  codeTop: number
  resultTop: number
  listTop: number
  wheel: { seq: number; by: number }
  toolPage: number
  helpTop: number
  /** The screen Help was opened from, and goes back to. */
  from: Screen
  notice: string
}

export type Load = 'idle' | 'loading' | 'ready' | 'failed'

export type ProblemSummary = {
  id: string
  title: string
  slug: string
  difficulty: string
  acRate: number
  isPaidOnly: boolean
  status: string
}

export type ProblemList = {
  status: Load
  error: string
  search: string
  difficulty: string
  total: number
  items: ProblemSummary[]
}

export type Snippet = { lang: string; langSlug: string; code: string }

export type Problem = {
  questionId: string
  id: string
  title: string
  slug: string
  difficulty: string
  isPaidOnly: boolean
  content: string
  testcases: string
  paramCount: number
  paramNames: string[]
  snippets: Snippet[]
  topics: string[]
}

export type ProblemState = {
  status: Load
  error: string
  slug: string
  data: Problem | null
}

export type Work = {
  lang: string
  preferred: string
  rev: number
}

export type Drafts = Record<string, string>

export type Tone = 'ok' | 'bad' | 'warn' | 'plain'

export type VerdictSection = { label: string; text: string; tone: Tone }

export type Verdict = {
  tone: Tone
  headline: string
  detail: string
  sections: VerdictSection[]
}

export type Judge = {
  token: number
  kind: 'run' | 'submit'
  slug: string
  status: 'pending' | 'done' | 'failed'
  seconds: number
  verdict: Verdict | null
  error: string
}

export type Account = {
  status: 'unknown' | 'checking' | 'in' | 'out'
  username: string
  source: 'none' | 'option' | 'env' | 'saved'
  /** How a saved session came in: pasted, or taken from a browser. */
  via: 'none' | 'paste' | 'safari' | 'chrome' | 'firefox'
  error: string
}

declare module 'claude-code' {
  interface PluginState {
    leetclawd: {
      power: Power
      view: View
      list: ProblemList
      problem: ProblemState
      work: Work
      drafts: Drafts
      judge: Judge | null
      account: Account
    }
  }
}
