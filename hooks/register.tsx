import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, UiScrollPointer } from 'claude-code'

import type {
  Account,
  Drafts,
  Judge,
  Power,
  Problem,
  ProblemList,
  ProblemState,
  Screen,
  Tab,
  View,
  Work,
} from '../types'

import {
  checkRequest,
  cookieOf,
  csrfRequest,
  dailyRequest,
  draftKey,
  fromPrompt,
  langFor,
  listRequest,
  parseCheck,
  parseCsrf,
  parseDaily,
  parseList,
  parseQuestion,
  parseRandom,
  parseStarted,
  parseUser,
  questionRequest,
  randomRequest,
  runRequest,
  snippetOf,
  submitRequest,
  toPrompt,
  userRequest,
} from './leetcode'
import {
  BROWSER_NAMES,
  CHROME_KEY_ARGV,
  CHROME_SQL,
  FIREFOX_SQL,
  chromeCookieFiles,
  chromeRoot,
  chromeRows,
  chromeValue,
  firefoxRoots,
  firefoxSessions,
  isChromeProfile,
  isEncrypted,
  liveSession,
  sqliteArgv,
} from './browsers'
import type { Browser, FoundSession } from './browsers'
import { followsLeader, leaderOf } from './keys'
import type { Auth, Reply, Request } from './leetcode'
import { bytesOf, cookieFiles, leetcodeSession, readCookies } from './safari'
import { clamp, clean, oneLine, truncate } from './text'
import { draw, panelAt, scrolledPanel, shortcutsOf } from './view'
import type { Actions, Frame, Kit, Limits, Model, Panel, Size } from './view'

type Engine = EngineInterface

const PANE = 'leetclawd'
const PAGE = 50
const MOST_LISTED = 1000
const POLL_MS = 1000
const MOST_POLLS = 90
const SAVE_MS = 800
const INLINE_ROWS = 24
const LONGEST_CODE = 100_000

const VIEW: View = {
  screen: 'list',
  tab: 'desc',
  descTop: 0,
  codeTop: 0,
  resultTop: 0,
  listTop: 0,
  wheel: { seq: 0, by: 0 },
  toolPage: 0,
  helpTop: 0,
  from: 'list',
  notice: '',
}
const LIST: ProblemList = { status: 'idle', error: '', search: '', difficulty: '', total: 0, items: [] }
const PROBLEM: ProblemState = { status: 'idle', error: '', slug: '', data: null }
const WORK: Work = { lang: '', preferred: '', rev: 0 }
const ACCOUNT: Account = { status: 'unknown', username: '', source: 'none', via: 'none', error: '' }

const power = atom({ plugin: 'leetclawd', key: 'power' } as const, {
  isArmed: false,
  isPinned: false,
  shown: 'none',
  turn: null,
})
const view = atom({ plugin: 'leetclawd', key: 'view' } as const, VIEW)
const list = atom({ plugin: 'leetclawd', key: 'list' } as const, LIST)
const problem = atom({ plugin: 'leetclawd', key: 'problem' } as const, PROBLEM)
const work = atom({ plugin: 'leetclawd', key: 'work' } as const, WORK)
const drafts = atom({ plugin: 'leetclawd', key: 'drafts' } as const, {})
const judge = atom({ plugin: 'leetclawd', key: 'judge' } as const, null)
const account = atom({ plugin: 'leetclawd', key: 'account' } as const, ACCOUNT)

// The module's own, lost at a reload: `reconcile` and `paint` take up again from `$.state`.
let settings = { language: 'python3', delayMs: 10_000, session: '', leader: ';' }
let showTimer: Timer | undefined
let saveTimer: Timer | undefined
let mirror: Drafts | undefined
let isDirty = false
let epoch = 0
let csrfToken = ''
let opening = 0
let resetArmedAt = 0
let lastFrame: Frame | undefined
let lastLimits: Limits = { desc: 0, code: 0, result: 0, list: 0, help: 0 }
let lastModel: Model | undefined
let editorFault = ''
let browsers: Record<Browser, boolean> = { safari: false, chrome: false, firefox: false }

const messageOf = (error: unknown): string =>
  truncate(oneLine(error instanceof Error ? error.message : String(error)), 300)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function say($: Engine, notice: string): Promise<void> {
  await update($, view, (value): View => ({ ...value, notice }))
}

async function send($: Engine, request: Request): Promise<Reply> {
  try {
    const reply = await $.http.fetch(request.url, request.init)

    return { status: reply.status, text: reply.text, headers: reply.headers }
  } catch (error) {
    throw new Error(`Could not reach leetcode.com: ${messageOf(error)}`)
  }
}

type Session = { session: string; source: Account['source']; via: Account['via'] }

const VIAS: readonly Account['via'][] = ['paste', 'safari', 'chrome', 'firefox']

/** The session cookie in force: the one saved from the Account screen, else the option's, else the environment's. */
async function sessionOf($: Engine): Promise<Session> {
  const saved = await $.store.get('session')
  const fromStore = typeof saved === 'string' ? cookieOf(saved) : ''

  if (fromStore !== '') {
    const via = await $.store.get('sessionVia')

    return { session: fromStore, source: 'saved', via: VIAS.find(one => one === via) ?? 'paste' }
  }

  const fromOption = cookieOf(settings.session)

  if (fromOption !== '') {
    return { session: fromOption, source: 'option', via: 'none' }
  }

  const fromEnv = cookieOf((await $.env.get('LEETCODE_SESSION')) ?? '')

  return fromEnv === '' ? { session: '', source: 'none', via: 'none' } : { session: fromEnv, source: 'env', via: 'none' }
}

/** The cookies of a signed-in request, or null with no session to send. */
async function authOf($: Engine): Promise<Auth | null> {
  const { session } = await sessionOf($)

  if (session === '') {
    return null
  }

  if (csrfToken === '') {
    csrfToken = parseCsrf(await send($, csrfRequest()))
  }

  if (csrfToken === '') {
    throw new Error('LeetCode handed out no CSRF token; try again in a moment.')
  }

  return { session, csrf: csrfToken }
}

/** The cookies for a read: a problem is readable signed out, so a failure here is no error. */
async function readerOf($: Engine): Promise<Auth | null> {
  try {
    return await authOf($)
  } catch {
    return null
  }
}

/** Asks LeetCode who the session belongs to; false when it answered that the cookie is no session. */
async function verify($: Engine): Promise<boolean> {
  const { session, source, via } = await sessionOf($)

  if (session === '') {
    await update($, account, (): Account => ACCOUNT)

    return true
  }

  await update($, account, (value): Account => ({ ...ACCOUNT, ...value, status: 'checking', source, via, error: '' }))

  try {
    const user = parseUser(await send($, userRequest(await authOf($))))

    await update($, account, (): Account =>
      user.isSignedIn
        ? { status: 'in', username: user.username, source, via, error: '' }
        : {
            status: 'out',
            username: '',
            source,
            via,
            error: 'LeetCode did not accept that session: it may have expired. Sign in at leetcode.com again, then import or paste it anew.',
          },
    )

    return user.isSignedIn
  } catch (error) {
    await update($, account, (): Account => ({ status: 'out', username: '', source, via, error: messageOf(error) }))

    return true
  }
}

async function signIn($: Engine, pasted: string, via: Account['via'] = 'paste'): Promise<void> {
  const session = cookieOf(pasted)

  if (session === '') {
    await update($, account, (value): Account => ({
      ...ACCOUNT,
      ...value,
      status: 'out',
      error: 'That does not look like a LEETCODE_SESSION value: paste the cookie’s value alone.',
    }))

    return
  }

  await $.store.set('session', session)
  await $.store.set('sessionVia', via)
  csrfToken = ''

  if (!(await verify($))) {
    await $.store.delete('session')
    await $.store.delete('sessionVia')
  }
}

async function isThere($: Engine, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

/** The folders in a folder, by name; none where it cannot be listed. */
async function foldersIn($: Engine, path: string): Promise<string[]> {
  try {
    return (await $.fs.list(path)).filter(entry => entry.kind === 'dir').map(entry => entry.name)
  } catch {
    return []
  }
}

/** Which browsers this machine has, whose leetcode.com session the Account screen offers to take up. */
async function findBrowsers($: Engine): Promise<void> {
  const home = (await $.env.get('HOME')) ?? ''
  const [safari, chrome, ...firefox] = await Promise.all([
    isThere($, '/Applications/Safari.app'),
    isThere($, chromeRoot(home)),
    ...firefoxRoots(home).map(root => isThere($, root)),
  ])

  browsers = { safari: safari === true, chrome: chrome === true, firefox: firefox.includes(true) }
}

/** The leetcode.com session Safari holds, read from its cookie file: that one cookie and nothing else. */
async function fromSafari($: Engine, home: string, now: number): Promise<FoundSession | undefined> {
  const found: FoundSession[] = []
  let trouble = ''
  let files = 0

  for (const path of cookieFiles(home)) {
    try {
      const { base64 } = await $.fs.read(path, { as: 'bytes' })
      const session = leetcodeSession(readCookies(bytesOf(base64)), now)

      files += 1

      if (session !== undefined) {
        found.push({ value: session.value, expiresAt: session.expiresAt })
      }
    } catch (error) {
      const message = messageOf(error).replace(/^.*\$\.fs\.read:\s*/, '')

      trouble = /ENOENT|no such file|not found|missing/i.test(message) ? trouble : message
    }
  }

  if (found.length > 0) {
    return liveSession(found, now)
  }

  if (/EPERM|EACCES|not permitted|denied/i.test(trouble)) {
    throw new Error(
      'macOS did not let this terminal read Safari’s cookies. Give your terminal app Full Disk Access in System Settings → Privacy & Security, restart it and import again, or paste the cookie instead.',
    )
  }

  if (trouble !== '') {
    throw new Error(`Safari’s cookies could not be read (${trouble}). Paste the cookie instead.`)
  }

  if (files === 0) {
    throw new Error('No Safari cookie store was found for this account on this machine. Paste the cookie instead.')
  }

  return undefined
}

/**
 * Asks a browser's cookie store one question with sqlite3, read-only: as the store stands, and where
 * the browser holds it locked, past the lock.
 */
async function ask($: Engine, path: string, sql: string): Promise<string> {
  let said = ''

  for (const isImmutable of [false, true]) {
    let ran

    try {
      ran = await $.process.run(sqliteArgv(path, sql, isImmutable), { timeoutMs: 15_000 })
    } catch (error) {
      throw new Error(`sqlite3, which reads this browser’s cookies, could not be run (${messageOf(error)}).`)
    }

    if (ran.exitCode === 0) {
      return ran.stdout
    }

    said = oneLine(ran.stderr)
  }

  throw new Error(`The browser’s cookie store could not be read (${truncate(said, 120)}).`)
}

/** The leetcode.com session Firefox holds, in whichever of its profiles holds the one that lapses last. */
async function fromFirefox($: Engine, home: string, now: number): Promise<FoundSession | undefined> {
  const found: FoundSession[] = []
  let stores = 0

  for (const root of firefoxRoots(home)) {
    for (const profile of await foldersIn($, root)) {
      const store = `${root}/${profile}/cookies.sqlite`

      if (await isThere($, store)) {
        stores += 1
        found.push(...firefoxSessions(await ask($, store, FIREFOX_SQL)))
      }
    }
  }

  if (stores === 0) {
    throw new Error('No Firefox profile with cookies was found on this machine. Paste the cookie instead.')
  }

  return liveSession(found, now)
}

/**
 * The leetcode.com session Chrome holds. Chrome keeps its cookies encrypted under a password in the
 * macOS Keychain, so macOS asks the person before this reads it, and only once a session is there
 * to open. The password is used here and kept nowhere.
 */
async function fromChrome($: Engine, home: string, now: number): Promise<FoundSession | undefined> {
  const root = chromeRoot(home)
  const rows = []
  let stores = 0

  for (const profile of (await foldersIn($, root)).filter(isChromeProfile)) {
    for (const store of chromeCookieFiles(`${root}/${profile}`)) {
      if (await isThere($, store)) {
        stores += 1
        rows.push(...chromeRows(await ask($, store, CHROME_SQL)))
        break
      }
    }
  }

  if (stores === 0) {
    throw new Error('No Chrome profile with cookies was found on this machine. Paste the cookie instead.')
  }

  const live = rows.filter(row => !(row.expiresAt <= now))
  let password = ''

  if (live.some(isEncrypted)) {
    await say($, 'macOS is asking whether Chrome’s cookies may be unlocked (“Chrome Safe Storage”): allow it to go on.')

    let asked

    try {
      asked = await $.process.run(CHROME_KEY_ARGV, { timeoutMs: 120_000 })
    } catch {
      throw new Error('macOS did not answer in time about unlocking Chrome’s cookies. Import again, or paste the cookie instead.')
    }

    if (asked.exitCode !== 0) {
      throw new Error('macOS did not unlock Chrome’s cookies: the Keychain request was denied or cancelled. Paste the cookie instead.')
    }

    password = asked.stdout.replace(/\r?\n$/, '')
  }

  const found: FoundSession[] = []

  for (const row of live) {
    const value = chromeValue(row, password)

    if (value !== '') {
      found.push({ value, expiresAt: row.expiresAt })
    }
  }

  if (live.length > 0 && found.length === 0) {
    throw new Error('Chrome’s leetcode.com session could not be opened with the key macOS gave. Paste the cookie instead.')
  }

  return liveSession(found, now)
}

/**
 * Signs in with the session a browser already holds for leetcode.com, however the person signed in
 * there (Google, GitHub, a password). Asked for by the person, from the Account screen.
 */
async function importFrom($: Engine, browser: Browser): Promise<void> {
  const name = BROWSER_NAMES[browser]

  await update($, account, (value): Account => ({ ...ACCOUNT, ...value, status: 'checking', error: '' }))

  try {
    const home = (await $.env.get('HOME')) ?? ''
    const now = await $.clock.now()
    const found =
      browser === 'safari'
        ? await fromSafari($, home, now)
        : browser === 'firefox'
          ? await fromFirefox($, home, now)
          : await fromChrome($, home, now)

    await say($, '')

    if (found === undefined) {
      throw new Error(
        `${name} holds no live leetcode.com session. Sign in at leetcode.com in ${name} (Google sign-in is fine), then import again.${
          browser === 'safari' ? '' : ` If you only just signed in, quit ${name} first so that it writes its cookies down.`
        }`,
      )
    }

    await signIn($, found.value, browser)
  } catch (error) {
    await say($, '')
    await update($, account, (value): Account => ({
      ...ACCOUNT,
      ...value,
      status: 'out',
      username: '',
      error: truncate(oneLine(error instanceof Error ? error.message : String(error)), 400),
    }))
  }
}

async function signOut($: Engine): Promise<void> {
  await $.store.delete('session')
  await $.store.delete('sessionVia')
  csrfToken = ''
  await verify($)

  const { source } = await read($, account)

  if (source === 'option' || source === 'env') {
    await say($, 'Your session comes from the plugin option or LEETCODE_SESSION: remove it there to sign out.')
  }
}

/**
 * The drafts, by problem and language. The module's own copy is the one typed into: every keystroke
 * of the editor lands here at once, and the session's and the store's copies follow a moment later,
 * so typing costs no redraw and no write.
 */
async function draftsOf($: Engine): Promise<Drafts> {
  mirror ??= { ...(await read($, drafts)) }

  return mirror
}

async function setDraft($: Engine, key: string, code: string): Promise<void> {
  mirror = { ...(await draftsOf($)), [key]: clean(code).slice(0, LONGEST_CODE) }
  isDirty = true
}

/** Writes the drafts where they outlive the module (the session) and the session (the store). */
async function flush($: Engine): Promise<void> {
  saveTimer?.cancel()
  saveTimer = undefined

  if (mirror === undefined || !isDirty) {
    return
  }

  isDirty = false

  const kept = mirror
  const mine = epoch
  const [held, state] = await Promise.all([read($, work), read($, problem)])

  if (mine !== epoch) {
    return
  }

  await update($, drafts, (): Drafts => kept)
  await $.store.set('workspace', { slug: state.slug, lang: held.lang, preferred: held.preferred, drafts: kept })
}

function flushSoon($: Engine): void {
  if (saveTimer !== undefined) {
    return
  }

  saveTimer = $.clock.after(SAVE_MS, () => {
    saveTimer = undefined
    void flush($)
  })
}

async function loadList($: Engine, mode: 'fresh' | 'more'): Promise<void> {
  const held = await read($, list)

  if (held.status === 'loading' || (mode === 'more' && held.items.length >= MOST_LISTED)) {
    return
  }

  const skip = mode === 'more' ? held.items.length : 0

  await update($, list, (value): ProblemList => ({
    ...value,
    status: 'loading',
    error: '',
    ...(mode === 'fresh' ? { items: [], total: 0 } : {}),
  }))

  if (mode === 'fresh') {
    await update($, view, (value): View => ({ ...value, listTop: 0 }))
  }

  try {
    const filters = { search: held.search, difficulty: held.difficulty, skip, limit: PAGE }
    const page = parseList(await send($, listRequest(filters, await readerOf($))))

    await update($, list, (value): ProblemList => ({
      ...value,
      status: 'ready',
      total: page.total,
      items: mode === 'more' ? [...value.items, ...page.items] : page.items,
    }))
  } catch (error) {
    await update($, list, (value): ProblemList => ({ ...value, status: 'failed', error: messageOf(error) }))
  }
}

async function openProblem($: Engine, slug: string): Promise<void> {
  const mine = ++opening

  await update($, problem, (value): ProblemState => ({ ...value, status: 'loading', error: '', slug }))
  await update($, view, (value): View => ({
    ...value,
    screen: 'problem',
    tab: 'desc',
    descTop: 0,
    codeTop: 0,
    resultTop: 0,
    toolPage: 0,
    notice: '',
  }))

  try {
    const data = parseQuestion(await send($, questionRequest(slug, await readerOf($))))

    if (mine !== opening) {
      return
    }

    const { preferred } = await read($, work)
    const lang = langFor(data, preferred === '' ? settings.language : preferred)
    const key = draftKey(data.slug, lang)

    if (!(key in (await draftsOf($)))) {
      await setDraft($, key, snippetOf(data, lang))
    }

    await update($, work, (value): Work => ({ ...value, lang, rev: value.rev + 1 }))
    await update($, judge, (value): Judge | null => (value !== null && value.slug === data.slug ? value : null))
    await update($, problem, (): ProblemState => ({ status: 'ready', error: '', slug: data.slug, data }))
    isDirty = true
    flushSoon($)
  } catch (error) {
    if (mine === opening) {
      await update($, problem, (value): ProblemState => ({ ...value, status: 'failed', error: messageOf(error) }))
    }
  }
}

async function openNamed($: Engine, which: 'daily' | 'random'): Promise<void> {
  await say($, which === 'daily' ? 'Finding today’s problem…' : 'Picking a problem…')

  try {
    const auth = await readerOf($)
    const { difficulty } = await read($, list)
    const slug =
      which === 'daily'
        ? parseDaily(await send($, dailyRequest(auth)))
        : parseRandom(await send($, randomRequest(difficulty, auth)))

    await openProblem($, slug)
  } catch (error) {
    await say($, messageOf(error))
  }
}

async function setScreen($: Engine, screen: Screen): Promise<void> {
  await update($, view, (value): View => ({
    ...VIEW,
    ...value,
    screen,
    toolPage: 0,
    notice: '',
    ...(screen === 'help' && value.screen !== 'help' ? { from: value.screen, helpTop: 0 } : {}),
  }))

  if (screen === 'list' && (await read($, list)).status === 'idle') {
    await loadList($, 'fresh')
  }

  if (screen === 'account' && (await read($, account)).status === 'unknown') {
    await verify($)
  }
}

async function setTab($: Engine, tab: Tab): Promise<void> {
  await update($, view, (value): View => ({ ...value, tab, notice: '' }))
}

async function search($: Engine, text: string): Promise<void> {
  await update($, list, (value): ProblemList => ({ ...value, search: truncate(oneLine(text), 80), status: 'idle' }))
  await loadList($, 'fresh')
}

async function setDifficulty($: Engine, difficulty: string): Promise<void> {
  await update($, list, (value): ProblemList => ({
    ...value,
    difficulty: ['EASY', 'MEDIUM', 'HARD'].includes(difficulty) ? difficulty : '',
    status: 'idle',
  }))
  await loadList($, 'fresh')
}

async function scrollList($: Engine, by: number): Promise<void> {
  const room = lastFrame?.panels.list?.height ?? 10
  const held = await read($, list)
  const { listTop } = await update($, view, (value): View => ({
    ...value,
    listTop: clamp(value.listTop + by, 0, Math.max(0, held.items.length - room)),
  }))
  const isNearEnd = listTop + 2 * room >= held.items.length

  if (by > 0 && isNearEnd && held.status === 'ready' && held.items.length < held.total) {
    await loadList($, 'more')
  }
}

async function scrollPanel($: Engine, panel: Panel | undefined, by: number): Promise<void> {
  if (panel === undefined || by === 0) {
    return
  }

  if (panel === 'list') {
    await scrollList($, by)

    return
  }

  await update($, view, (value): View => {
    if (panel === 'desc') {
      return { ...value, descTop: clamp(value.descTop + by, 0, lastLimits.desc) }
    }

    if (panel === 'help') {
      return { ...value, helpTop: clamp((value.helpTop ?? 0) + by, 0, lastLimits.help) }
    }

    if (panel === 'result') {
      return { ...value, resultTop: clamp(value.resultTop + by, 0, lastLimits.result) }
    }

    return {
      ...value,
      codeTop: clamp(value.codeTop + by, 0, lastLimits.code),
      wheel: { seq: value.wheel.seq + 1, by },
    }
  })
}

/** The scroll buttons: half a panel of whichever panel stands where the statement does. */
async function nudge($: Engine, direction: number): Promise<void> {
  if (lastFrame === undefined || lastModel === undefined) {
    return
  }

  const panel = scrolledPanel(lastModel, lastFrame)
  const height = panel === undefined ? 0 : (lastFrame.panels[panel]?.height ?? 0)

  await scrollPanel($, panel, direction * Math.max(1, Math.floor(height / 2)))
}

async function wheel($: Engine, by: number, pointer: UiScrollPointer | undefined): Promise<void> {
  if (lastFrame === undefined || lastModel === undefined) {
    return
  }

  const under = pointer === undefined ? undefined : panelAt(lastFrame, pointer.row, pointer.column)

  await scrollPanel($, under ?? scrolledPanel(lastModel, lastFrame), by)
}

async function setLang($: Engine, lang: string): Promise<void> {
  const { data } = await read($, problem)

  if (data === null || !data.snippets.some(snippet => snippet.langSlug === lang)) {
    return
  }

  const key = draftKey(data.slug, lang)

  if (!(key in (await draftsOf($)))) {
    await setDraft($, key, snippetOf(data, lang))
  }

  await update($, work, (value): Work => ({ lang, preferred: lang, rev: value.rev + 1 }))
  await update($, view, (value): View => ({ ...value, screen: 'problem', codeTop: 0, notice: '' }))
  isDirty = true
  flushSoon($)
}

async function resetCode($: Engine): Promise<void> {
  const { data } = await read($, problem)

  if (data === null) {
    return
  }

  const at = await $.clock.now()

  if (at - resetArmedAt > 5000) {
    resetArmedAt = at
    await say($, 'Press z again to replace your code with the problem’s starting code.')

    return
  }

  resetArmedAt = 0

  const { lang } = await read($, work)

  await replaceDraft($, draftKey(data.slug, lang), snippetOf(data, lang))
  await say($, 'Your code is back to the starting code.')
}

/** A draft changed from outside the editor: the editor is told to take it up, by a new revision. */
async function replaceDraft($: Engine, key: string, code: string): Promise<void> {
  await setDraft($, key, code)
  await update($, work, (value): Work => ({ ...value, rev: value.rev + 1 }))
  await flush($)
}

async function editInPrompt($: Engine): Promise<void> {
  const [{ data }, held] = await Promise.all([read($, problem), read($, work)])

  if (data === null) {
    await say($, 'Open a problem first.')

    return
  }

  const box = await $.prompt.read()

  if (box.text.trim() !== '' && fromPrompt(box.text) === null) {
    await say($, 'The prompt box holds text: send or clear it, then press e again.')

    return
  }

  const code = (await draftsOf($))[draftKey(data.slug, held.lang)] ?? ''
  const filled = await $.prompt.fill({ text: toPrompt(data.slug, held.lang, code), mode: 'replace' })

  await say(
    $,
    filled.isFilled
      ? 'Your code is in the prompt box: Enter there saves it back (not sent to Claude).'
      : 'The prompt box cannot take the code just now.',
  )
}

/** A solution that came back from the prompt box: kept, and the box emptied. */
async function saveFromPrompt($: Engine, saved: { slug: string; lang: string; code: string }): Promise<void> {
  await replaceDraft($, draftKey(saved.slug, saved.lang), saved.code)
  await say($, 'Saved your code from the prompt box.')
  $.clock.after(50, () => {
    void clearPrompt($)
  })
}

async function clearPrompt($: Engine): Promise<void> {
  const box = await $.prompt.read()

  if (fromPrompt(box.text) !== null) {
    await $.prompt.fill({ text: '', mode: 'replace' })
  }
}

async function failJudge($: Engine, token: number, error: string): Promise<void> {
  await update($, judge, (value): Judge | null =>
    value !== null && value.token === token ? { ...value, status: 'failed', error } : value,
  )
}

async function poll(
  $: Engine,
  token: number,
  kind: Judge['kind'],
  id: string,
  data: Problem,
  tries: number,
): Promise<void> {
  const held = await read($, judge)

  if (held === null || held.token !== token || held.status !== 'pending') {
    return
  }

  try {
    const auth = await authOf($)

    if (auth === null) {
      throw new Error('You were signed out while LeetCode was judging.')
    }

    const check = parseCheck(kind, await send($, checkRequest(id, data.slug, auth)), data)

    if (check.isDone) {
      await update($, judge, (value): Judge | null =>
        value !== null && value.token === token ? { ...value, status: 'done', verdict: check.verdict } : value,
      )
      await update($, view, (value): View => ({ ...value, resultTop: 0 }))

      return
    }

    if (tries >= MOST_POLLS) {
      throw new Error('LeetCode took too long to judge. Try again.')
    }

    await update($, judge, (value): Judge | null =>
      value !== null && value.token === token ? { ...value, seconds: tries + 1 } : value,
    )
    $.clock.after(POLL_MS, () => {
      void poll($, token, kind, id, data, tries + 1)
    })
  } catch (error) {
    await failJudge($, token, messageOf(error))
  }
}

async function startJudge($: Engine, kind: Judge['kind']): Promise<void> {
  const [state, held, running] = await Promise.all([read($, problem), read($, work), read($, judge)])
  const { data } = state

  if (data === null || state.status !== 'ready') {
    await say($, 'Open a problem first.')

    return
  }

  if (running !== null && running.status === 'pending') {
    await say($, 'LeetCode is still judging your last run.')

    return
  }

  const code = (await draftsOf($))[draftKey(data.slug, held.lang)] ?? ''
  const token = (running?.token ?? 0) + 1

  void flush($)

  await update($, judge, (): Judge | null => ({
    token,
    kind,
    slug: data.slug,
    status: 'pending',
    seconds: 0,
    verdict: null,
    error: '',
  }))
  await update($, view, (value): View => ({ ...value, tab: 'result', resultTop: 0, notice: '' }))

  try {
    if (code.trim() === '') {
      throw new Error('There is no code to send.')
    }

    const auth = await authOf($)

    if (auth === null) {
      throw new Error('Run and Submit use your LeetCode account, and you are not signed in: press a for the Account screen.')
    }

    const request = kind === 'run' ? runRequest(data, held.lang, code, auth) : submitRequest(data, held.lang, code, auth)
    const id = parseStarted(await send($, request))

    $.clock.after(POLL_MS, () => {
      void poll($, token, kind, id, data, 0)
    })
  } catch (error) {
    await failJudge($, token, messageOf(error))
  }
}

/** What the editor posted: its text after an edit, or a run or submit asked from the keyboard. */
async function heard($: Engine, data: unknown): Promise<void> {
  const open = lastModel?.problem.data

  if (!isRecord(data) || typeof data.id !== 'string' || typeof data.code !== 'string') {
    return
  }

  if (lastModel === undefined || open === null || open === undefined || data.id !== draftKey(open.slug, lastModel.work.lang)) {
    return
  }

  await setDraft($, data.id, data.code)

  if (data.type === 'run' || data.type === 'submit') {
    await startJudge($, data.type)
  } else {
    flushSoon($)
  }
}

function actionsOf($: Engine): Actions {
  return {
    show: screen => void setScreen($, screen),
    tab: tab => void setTab($, tab),
    scroll: by => void nudge($, by),
    open: slug => void openProblem($, slug),
    search: text => void search($, text),
    difficulty: value => void setDifficulty($, value),
    page: by => void scrollList($, by * (lastFrame?.panels.list?.height ?? 10)),
    daily: () => void openNamed($, 'daily'),
    random: () => void openNamed($, 'random'),
    reload: () => void loadList($, 'fresh'),
    run: () => void startJudge($, 'run'),
    submit: () => void startJudge($, 'submit'),
    lang: slug => void setLang($, slug),
    reset: () => void resetCode($),
    editInPrompt: () => void editInPrompt($),
    signIn: cookie => void signIn($, cookie),
    signOut: () => void signOut($),
    verify: () => void verify($),
    importFrom: browser => void importFrom($, browser),
    more: () => void update($, view, (value): View => ({ ...value, toolPage: value.toolPage + 1 })),
  }
}

/** Draws LeetClawd for one site. Reads only: what it reads redraws it. */
async function paint($: Engine, kit: Kit, site: Model['site'], size: Size) {
  // The drafts are read from the session too, though the module's copy is the newer one: that read
  // is what has a flush draw the site again, so a drawing the engine keeps never holds old code.
  const [views, lists, state, held, verdict, who, saved] = await Promise.all([
    read($, view),
    read($, list),
    read($, problem),
    read($, work),
    read($, judge),
    read($, account),
    read($, drafts),
  ])

  mirror ??= { ...saved }

  const kept = mirror
  // What an older copy of this module left in the session may lack a field this one reads.
  const model: Model = {
    site,
    view: { ...VIEW, ...views },
    list: lists,
    problem: state,
    work: held,
    judge: verdict,
    account: { ...ACCOUNT, ...who },
    code: state.data === null ? '' : (kept[draftKey(state.data.slug, held.lang)] ?? ''),
    browsers,
    leader: settings.leader,
    delaySeconds: Math.round(settings.delayMs / 1000),
  }
  const drawn = draw(kit, model, actionsOf($), size)

  lastFrame = drawn.frame
  lastLimits = drawn.limits
  lastModel = model

  return drawn.tree
}

function scheduleShow($: Engine, delayMs: number): void {
  showTimer?.cancel()
  showTimer = $.clock.after(Math.max(0, delayMs), () => {
    void show($)
  })
}

/** Shows LeetClawd: a pane where the surface seats one opened unasked, else the band above the prompt. */
async function show($: Engine): Promise<void> {
  const before = await read($, power)

  if (!before.isArmed || before.turn === null || before.shown !== 'none') {
    return
  }

  let isPlaced = false

  try {
    await flush($)
    $.ui.invalidate('ui.render')
    isPlaced = (await $.ui.open({ id: PANE, title: 'LeetClawd', rows: INLINE_ROWS })).isPlaced
  } catch {
    isPlaced = false
  }

  const after = await read($, power)
  const isStillWanted = after.isArmed && after.turn !== null && after.turn.id === before.turn.id

  if (!isPlaced || !isStillWanted) {
    await $.ui.close({ id: PANE })
  }

  if (isStillWanted) {
    await update($, power, (value): Power => ({ ...value, shown: isPlaced ? 'pane' : 'band' }))
  }
}

async function hide($: Engine): Promise<void> {
  showTimer?.cancel()
  showTimer = undefined
  await $.ui.close({ id: PANE })
  await update($, power, (value): Power => (value.shown === 'none' ? value : { ...value, shown: 'none' }))
}

async function endTurn($: Engine): Promise<void> {
  const held = await update($, power, (value): Power => ({ ...value, turn: null }))

  showTimer?.cancel()
  showTimer = undefined

  // Opened with /leetclawdf, it stays: only one that came with the thinking goes with it.
  if (held.isPinned !== true) {
    await hide($)
  }

  await flush($)
}

/** Brings back the problem and drafts kept from an earlier session, where this one has none yet. */
async function restore($: Engine): Promise<void> {
  const [held, state] = await Promise.all([draftsOf($), read($, problem)])

  if (Object.keys(held).length > 0 || state.slug !== '') {
    return
  }

  const saved = await $.store.get('workspace')

  if (!isRecord(saved) || !isRecord(saved.drafts)) {
    return
  }

  const kept: Drafts = Object.fromEntries(
    Object.entries(saved.drafts).flatMap(([key, code]) =>
      typeof code === 'string' ? [[key, clean(code).slice(0, LONGEST_CODE)] as const] : [],
    ),
  )
  const preferred = typeof saved.preferred === 'string' ? saved.preferred : ''

  mirror = kept
  isDirty = false
  await update($, drafts, (): Drafts => kept)
  await update($, work, (value): Work => ({ ...value, preferred }))

  if (typeof saved.slug === 'string' && /^[a-z0-9-]+$/.test(saved.slug)) {
    void openProblem($, saved.slug)
  }
}

/** What LeetClawd needs before it is first seen: the workspace kept from before, the list, who is signed in. */
async function prepare($: Engine): Promise<void> {
  await restore($)
  await findBrowsers($)

  if ((await read($, list)).status !== 'ready') {
    void loadList($, 'fresh')
  }

  void verify($)
}

/** Opens LeetClawd now, to stay open whatever Claude is doing: a pane where one is seated, else the band. */
async function openToStay($: Engine): Promise<void> {
  showTimer?.cancel()
  showTimer = undefined
  await prepare($)
  await flush($)
  $.ui.invalidate('ui.render')

  let isPlaced = false

  try {
    // Asked for by the person, so the surface seats the pane at any width where it hears it as asked.
    // The keyboard is not asked for: the next thing typed may be a prompt, and its letters would press
    // the pane's buttons, Submit among them.
    isPlaced = (await $.ui.open({ id: PANE, title: 'LeetClawd', rows: INLINE_ROWS })).isPlaced
  } catch {
    isPlaced = false
  }

  if (!isPlaced) {
    await $.ui.close({ id: PANE })
  }

  await update($, power, (value): Power => ({ ...value, isPinned: true, shown: isPlaced ? 'pane' : 'band' }))
}

/** Takes LeetClawd off the screen now; what `/leetclawd` set up goes on with the next turn. */
async function closeNow($: Engine): Promise<void> {
  await update($, power, (value): Power => ({ ...value, isPinned: false }))
  await hide($)
  await flush($)
}

/** `/leetclawdf`: opens LeetClawd now and keeps it open, whatever Claude is doing; typed again, it closes it. */
async function pin($: Engine): Promise<string> {
  const before = await read($, power)
  const key = settings.leader

  if (before.isPinned === true) {
    await closeNow($)

    return before.isArmed
      ? `LeetClawd is closed. It still appears once Claude has been thinking for more than ${Math.round(settings.delayMs / 1000)}s.`
      : 'LeetClawd is closed, with your problem and code kept.'
  }

  await openToStay($)

  return `LeetClawd is open and stays open whatever Claude is doing. ${key}${key} in an empty prompt box hides or shows it at once; ${key}h is its help.`
}

/** The shortcut: on screen, it goes; off screen, it comes and stays. */
async function toggle($: Engine): Promise<void> {
  if ((await read($, power)).shown === 'none') {
    await openToStay($)
  } else {
    await closeNow($)
  }
}

/**
 * A key typed after the shortcut key in an empty prompt box. Twice the shortcut key shows or hides
 * LeetClawd; with LeetClawd on screen, any other key presses what it names there. True when the key
 * was taken, false when the two are to be typed as they came.
 */
async function shortcut($: Engine, typed: string): Promise<boolean> {
  if (typed === settings.leader) {
    await toggle($)

    return true
  }

  if (lastModel === undefined || lastFrame === undefined || (await read($, power)).shown === 'none') {
    return false
  }

  const press = shortcutsOf(lastModel, lastFrame, actionsOf($))[typed.toLowerCase()]

  if (press !== undefined) {
    press()

    return true
  }

  // The shortcut key and a space is text after all. Any other key was meant for a button that is
  // not there: left in the box, it would stand in the way of the next shortcut.
  if (typed.trim() === '') {
    return false
  }

  await say($, `${settings.leader}${oneLine(typed)} presses nothing here. ${settings.leader}h lists the keys.`)

  return true
}

async function arm($: Engine): Promise<string> {
  const before = await read($, power)
  const held = await update($, power, (value): Power => ({ ...value, isArmed: true }))
  const seconds = Math.round(settings.delayMs / 1000)

  await prepare($)

  if (held.turn !== null && held.shown === 'none') {
    scheduleShow($, settings.delayMs - ((await $.clock.now()) - held.turn.startedAt))
  }

  return `${before.isArmed ? 'LeetClawd is already on' : 'LeetClawd is on'}: LeetCode appears once Claude has been thinking for more than ${seconds}s and hides when it is done, with your problem and code kept. ${settings.leader}${settings.leader} in an empty prompt box shows or hides it at once. /unleetclawd turns it off and clears them.`
}

async function disarm($: Engine): Promise<string> {
  showTimer?.cancel()
  showTimer = undefined
  saveTimer?.cancel()
  saveTimer = undefined
  opening += 1
  epoch += 1
  resetArmedAt = 0
  mirror = {}
  isDirty = false
  await $.ui.close({ id: PANE })
  await update($, power, (value): Power => ({ isArmed: false, isPinned: false, shown: 'none', turn: value.turn }))
  await update($, view, (): View => VIEW)
  await update($, list, (): ProblemList => LIST)
  await update($, problem, (): ProblemState => PROBLEM)
  await update($, work, (): Work => WORK)
  await update($, drafts, (): Drafts => ({}))
  await update($, judge, (): Judge | null => null)
  await update($, account, (): Account => ACCOUNT)
  await $.store.delete('workspace')

  return 'LeetClawd is off and its state is cleared: the open problem, your drafts and the last result.'
}

/** After a reload: what the old module left in flight is ended, and a show still owed is scheduled again. */
async function reconcile($: Engine): Promise<void> {
  const [held, verdict, lists, state] = await Promise.all([
    read($, power),
    read($, judge),
    read($, list),
    read($, problem),
  ])

  if (verdict !== null && verdict.status === 'pending') {
    await failJudge($, verdict.token, 'The judge’s answer was lost when the plugin reloaded. Run it again.')
  }

  if (lists.status === 'loading') {
    await update($, list, (value): ProblemList => ({ ...value, status: 'idle' }))
  }

  if (state.status === 'loading') {
    await update($, problem, (value): ProblemState => ({
      ...value,
      status: 'failed',
      error: 'Loading was interrupted when the plugin reloaded. Open the problem again.',
    }))
  }

  if (held.isArmed) {
    await findBrowsers($)
  }

  if (held.isArmed && held.turn !== null && held.shown === 'none') {
    scheduleShow($, settings.delayMs - ((await $.clock.now()) - held.turn.startedAt))
  }
}

export const register: Register = (on, options) => {
  settings = {
    language: typeof options.language === 'string' && options.language !== '' ? options.language : 'python3',
    delayMs: typeof options.delaySeconds === 'number' ? Math.max(0, options.delaySeconds) * 1000 : 10_000,
    session: typeof options.session === 'string' ? options.session : '',
    leader: leaderOf(options.shortcutKey),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'leetclawd',
      description: `Show LeetCode while Claude thinks: it appears after ${Math.round(settings.delayMs / 1000)}s of thinking and hides when Claude is done`,
      immediate: true,
    })
    await $.command.register({
      name: 'leetclawdf',
      description: 'Open LeetCode now and keep it open, whether or not Claude is working; typed again, it closes it',
      immediate: true,
    })
    await $.command.register({
      name: 'unleetclawd',
      description: 'Turn LeetClawd off and clear its state',
      immediate: true,
    })
    await reconcile($)

    return next(e)
  })

  on('command.run', { command: 'leetclawd' }, async $ => ({ text: await arm($) }))

  on('command.run', { command: 'leetclawdf' }, async $ => ({ text: await pin($) }))

  on('command.run', { command: 'unleetclawd' }, async $ => ({ text: await disarm($) }))

  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const held = await update($, power, (value): Power => ({ ...value, turn: { id: e.turnId, startedAt } }))

    if (held.isArmed && held.shown === 'none') {
      scheduleShow($, settings.delayMs)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await endTurn($)
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const saved = e.origin.kind === 'composer' ? fromPrompt(e.text) : null

    if (saved !== null) {
      await saveFromPrompt($, saved)

      return { drop: 'LeetClawd saved your code; it was not sent to Claude.' }
    }

    // A prompt entered while nothing runs: a turn still on record ended unheard.
    if (e.turnId === undefined && (await read($, power)).turn !== null) {
      await endTurn($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Every key typed in the prompt box passes here, so all but a key after the shortcut key leave at once.
  on('prompt.edit', async ($, e, next) => {
    const typed = followsLeader(e, settings.leader)

    if (typed === undefined || !(await shortcut($, typed))) {
      return next(e)
    }

    return { text: '', cursor: 0 }
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    // Closed by hand: it is no longer kept open, and stays away for the rest of this turn.
    if (e.origin.kind === 'person') {
      await update($, power, (value): Power => ({ ...value, isPinned: false, shown: 'none' }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    await heard($, e.data)

    return next(e)
  })

  on('ui.fault', async ($, e, next) => {
    // The engine draws the site again next: leaving the editor out of it is the way on.
    editorFault = truncate(oneLine(e.reason), 120)
    await say($, `The editor stopped (${editorFault}): press e to edit your code in the prompt box.`)

    return next(e)
  })

  on('ui.scroll', { requestId: PANE }, async ($, e) => {
    await wheel($, e.by, e.pointer)

    return {}
  }).catch(($, e, next) => next(e))

  on('ui.scroll', { component: 'AbovePrompt' }, async ($, e, next) => {
    if ((await read($, power)).shown !== 'band') {
      return next(e)
    }

    await wheel($, e.by, e.pointer)

    return {}
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const t = $.ui.resolve(e)
    const canType =
      editorFault === '' && 'Client' in t && (e.surface !== 'terminal' || e.viewport?.isFullscreen === true)
    const kit: Kit = {
      Box: t.Box,
      Text: t.Text,
      Button: t.Button,
      ...('Input' in t ? { Input: t.Input } : {}),
      ...('Client' in t && canType
        ? {
            editor: (props, width, height) => (
              <t.Client key="editor" module="./editor.tsx" props={props} width={width} height={height} />
            ),
          }
        : {}),
    }
    const rows = e.props.placement === 'dock' ? e.props.scroll.bodyRows : Math.min(e.props.scroll.bodyRows, INLINE_ROWS)

    return paint($, kit, 'pane', { columns: e.props.bodyColumns, rows })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const held = await read($, power)

    if (held.shown !== 'band' || e.props.hasSurvey) {
      return next(e)
    }

    const t = $.ui.resolve(e)
    const canType =
      editorFault === '' && 'Client' in t && (e.surface !== 'terminal' || e.viewport?.isFullscreen === true)
    const kit: Kit = {
      Box: t.Box,
      Text: t.Text,
      Button: t.Button,
      ...('Input' in t ? { Input: t.Input } : {}),
      ...('Client' in t && canType
        ? {
            editor: (props, width, height) => (
              <t.Client key="editor" module="./editor.tsx" props={props} width={width} height={height} />
            ),
          }
        : {}),
    }

    return paint($, kit, 'band', { columns: e.props.bodyColumns, rows: Math.min(e.props.maxRows, INLINE_ROWS) })
  })
}
