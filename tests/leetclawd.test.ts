import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { toPrompt } from '../hooks/leetcode'

import { base64Of, cookieFile } from './cookies'

const PLUGIN = 'leetclawd'
const GOOD = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.good-session'
const START = 'class Solution:\n    def twoSum(self, nums, target):\n        '

const QUESTION = {
  questionId: '1',
  questionFrontendId: '1',
  title: 'Two Sum',
  titleSlug: 'two-sum',
  difficulty: 'Easy',
  isPaidOnly: false,
  content:
    '<p>Given an array of integers <code>nums</code>, return the two indices.</p><pre><strong>Input:</strong> nums = [2,7,11,15], target = 9\n<strong>Output:</strong> [0,1]</pre>',
  exampleTestcases: '[2,7,11,15]\n9\n[3,2,4]\n6',
  metaData: JSON.stringify({ name: 'twoSum', params: [{ name: 'nums' }, { name: 'target' }] }),
  codeSnippets: [
    { lang: 'Python3', langSlug: 'python3', code: START },
    { lang: 'C++', langSlug: 'cpp', code: 'class Solution {\npublic:\n    \n};' },
  ],
  topicTags: [{ name: 'Array' }],
}

const LONG = Array.from({ length: 80 }, (_, index) => `<p>Paragraph ${index + 1}</p>`).join('')

const RUN_DONE = {
  state: 'SUCCESS',
  status_code: 10,
  status_msg: 'Accepted',
  code_answer: ['[0,1]', '[1,2]', ''],
  expected_code_answer: ['[0,1]', '[1,2]', ''],
  compare_result: '11',
  correct_answer: true,
  total_testcases: 2,
  status_runtime: '0 ms',
}

const SUBMIT_DONE = {
  state: 'SUCCESS',
  status_code: 10,
  status_msg: 'Accepted',
  total_correct: 63,
  total_testcases: 63,
  status_runtime: '3 ms',
  runtime_percentile: 87.2,
  status_memory: '18.1 MB',
  memory_percentile: 45,
}

const PANE = {
  title: 'LeetClawd',
  isFocused: false,
  bodyColumns: 72,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 44 },
  view: {},
}

const BAND = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 16,
  bodyColumns: 95,
  scroll: { offset: 0, bodyRows: 15 },
  view: {},
}

const TERMINAL = { columns: 160, rows: 50, isFullscreen: true }

const FIREFOX = '/Users/me/Library/Application Support/Firefox/Profiles'
const CHROME = '/Users/me/Library/Application Support/Google/Chrome'

/** The tests' session as Chrome keeps it: encrypted by Node under the password `test-keychain-password`. */
const CHROME_SEALED =
  '763130F2444AEB21877F7EE2132BABDEBB350E845DF6A3A50641A15FA42D96CD50099F5733B04B7C1292036343843529A03FBDB5279F5C91E923CE0F7F1D904D2941548A25B67370D0B0723D49B78AB55B9F6C6B9735455D67D674255872AA18A18782'

/** The tests' session as Firefox keeps it, in the hex sqlite3 is asked for. */
const FIREFOX_HEX =
  '65794A30655841694F694A4B563151694C434A68624763694F694A49557A49314E694A392E676F6F642D73657373696F6E'

/** One key typed in the prompt box: the edit the engine raises for it. */
const typing = ($: Engine, text: string, inputText: string) =>
  // the kit raises the event; its typings do not list it yet
  ($.prompt as unknown as { edit: (e: object) => Promise<{ text: string; cursor: number }> }).edit({
    origin: { kind: 'composer' },
    text,
    cursor: text.length,
    start: text.length,
    end: text.length,
    inputText,
    ...([...inputText].length === 1 ? { key: { key: inputText } } : {}),
  })

type Sent = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }

/** The world beneath the plugin: a clock, a store, a prompt box, panes, and a LeetCode that answers. */
const world = (
  on: On,
  options: {
    isPlaced?: boolean
    env?: Record<string, string>
    store?: Record<string, unknown>
    /** What reading Safari's cookie file gives: its bytes, or the error the read ends in. */
    safari?: Uint8Array | Error
    /** What sqlite3 prints for Firefox's store, where this machine has a Firefox profile. */
    firefox?: string
    /** What sqlite3 prints for Chrome's store, and what macOS answers for its key (null: denied). */
    chrome?: { rows: string; key: string | null }
  } = {},
) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const sent: Sent[] = []
  const panes = { opened: 0, closed: 0, isOpen: false }
  const box = { text: '' }
  const store: Record<string, unknown> = { ...options.store }
  const state: Record<string, unknown> = {}
  const writes = { count: 0 }
  const ran: string[][] = []
  let polls = 0

  on('state.set', (_, e, next) => {
    state[e.key] = e.value
    writes.count += 1

    return next(e)
  })

  mock.env(on, options.env ?? {})
  on('store.get', (_, e) => ({ value: store[e.key] }))
  on('store.set', (_, e) => {
    store[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete store[e.key]

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({
    value:
      (options.safari !== undefined && e.path === '/Applications/Safari.app') ||
      (options.firefox !== undefined && [FIREFOX, `${FIREFOX}/abc.default-release/cookies.sqlite`].includes(e.path)) ||
      (options.chrome !== undefined && [CHROME, `${CHROME}/Default/Cookies`].includes(e.path)),
  }))
  on('fs.list', (_, e) => ({
    value: (e.path === FIREFOX ? ['abc.default-release'] : e.path === CHROME ? ['Default', 'System Profile'] : []).map(name => ({
      name,
      kind: 'dir' as const,
      size: 0,
      mtimeMs: 0,
      isLink: false,
    })),
  }))
  on('process.run', (_, e) => {
    const done = (exitCode: number, stdout: string) => ({
      value: { exitCode, stdout, stderr: exitCode === 0 ? '' : 'refused', isStdoutTruncated: false, isStderrTruncated: false },
    })

    ran.push([...e.argv])

    if (e.argv[0] === '/usr/bin/security') {
      return options.chrome?.key == null ? done(44, '') : done(0, `${options.chrome.key}\n`)
    }

    return done(0, (e.argv[4] ?? '').includes('Firefox') ? (options.firefox ?? '') : (options.chrome?.rows ?? ''))
  })
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
  on('fs.read', (_, e) => {
    if (options.safari instanceof Uint8Array && e.path === '/Users/me/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies') {
      return { value: { base64: base64Of(options.safari) } }
    }

    return {
      deny:
        options.safari instanceof Error && e.path.includes('/Containers/')
          ? options.safari.message
          : `ENOENT: no such file or directory, open '${e.path}'`,
    }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.fill', (_, e) => {
    box.text = e.text

    return { isFilled: true }
  })
  on('ui.message', () => ({}))
  on('ui.scroll', () => ({}))
  on('ui.open', () => {
    panes.opened += 1
    panes.isOpen = options.isPlaced !== false

    return { value: options.isPlaced === false ? { isPlaced: false, reason: 'unasked below 144 columns' } : { isPlaced: true } }
  })
  on('ui.close', () => {
    panes.closed += panes.isOpen ? 1 : 0
    panes.isOpen = false

    return { value: undefined }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: 'the engine’s own band' }))
  on('http.fetch', (_, e) => {
    const headers = e.init?.headers ?? {}
    const body: Record<string, unknown> = e.init?.body === undefined ? {} : JSON.parse(e.init.body)
    const isSignedIn = (headers.Cookie ?? '').includes(`LEETCODE_SESSION=${GOOD}`) && headers['x-csrftoken'] === 'csrf123'
    const answer = (data: unknown, status = 200, extra: Record<string, string> = {}) => ({
      value: { status, ok: status < 300, headers: extra, text: JSON.stringify(data) },
    })

    sent.push({ url: e.url, method: e.init?.method ?? 'GET', headers, body })

    if (e.url.endsWith('/graphql')) {
      const query = String(body.query)
      const variables = (body.variables ?? {}) as { skip?: number; limit?: number; titleSlug?: string }

      if (query.includes('userStatus')) {
        return answer(
          { data: { userStatus: { isSignedIn, username: isSignedIn ? 'jackson' : '' } } },
          200,
          headers.Cookie === undefined ? { 'set-cookie': 'csrftoken=csrf123; Path=/; Secure' } : {},
        )
      }

      if (query.includes('problemsetQuestionList')) {
        const skip = variables.skip ?? 0

        return answer({
          data: {
            problemsetQuestionList: {
              total: 120,
              questions: Array.from({ length: Math.min(variables.limit ?? 50, 120 - skip) }, (_, index) => ({
                acRate: 50,
                difficulty: 'Easy',
                frontendQuestionId: String(skip + index + 1),
                paidOnly: false,
                status: null,
                title: skip + index === 0 ? 'Two Sum' : `Problem ${skip + index + 1}`,
                titleSlug: skip + index === 0 ? 'two-sum' : `problem-${skip + index + 1}`,
              })),
            },
          },
        })
      }

      if (query.includes('activeDailyCodingChallengeQuestion')) {
        return answer({ data: { activeDailyCodingChallengeQuestion: { question: { titleSlug: 'two-sum' } } } })
      }

      const slug = variables.titleSlug ?? 'two-sum'

      return answer({ data: { question: { ...QUESTION, titleSlug: slug, ...(slug === 'two-sum' ? {} : { content: LONG }) } } })
    }

    if (!isSignedIn) {
      return answer({ error: 'User is not authenticated' }, 403)
    }

    if (e.url.endsWith('/interpret_solution/')) {
      return answer({ interpret_id: 'runcode_1', test_case: body.data_input })
    }

    if (e.url.endsWith('/submit/')) {
      return answer({ submission_id: 777 })
    }

    polls += 1

    return answer(polls < 3 ? { state: polls === 1 ? 'PENDING' : 'STARTED' } : e.url.includes('runcode_1') ? RUN_DONE : SUBMIT_DONE)
  })

  return { clock, sent, panes, box, store, state, writes, ran }
}

const command = ($: Engine, name: string) =>
  $.command.run({
    command: name,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })

const think = ($: Engine, turnId: string) => $.turn.start({ text: 'think hard', turnId })

const answer = ($: Engine, turnId: string) =>
  $.turn.complete({ answer: 'done', durationMs: 20_000, isAborted: false, turnId, reason: 'answer' })

const pane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, viewport: TERMINAL, props: PANE })

const band = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', viewport: { ...TERMINAL, columns: 100 }, props: BAND })

describe('when LeetClawd shows', () => {
  test('never before /leetclawd, however long Claude thinks', async ($, on) => {
    const { clock, panes } = world(on)

    await think($, 't1')
    await clock.advance(60_000)

    expect(panes.opened).toBe(0)
    expect(await (await band($)).find({ text: /LeetClawd/ })).toBe(undefined)
  })

  test('after /leetclawd, once Claude has been thinking for more than ten seconds, and not when it is idle', async ($, on) => {
    const { clock, panes, state } = world(on)

    expect((await command($, 'leetclawd')).text).toContain('LeetClawd is on')
    await clock.advance(60_000)
    expect(panes.opened).toBe(0)

    await think($, 't1')
    await clock.advance(9_900)
    expect(panes.opened).toBe(0)

    await clock.advance(200)
    expect(panes.isOpen).toBe(true)
    expect(state.power).toMatchObject({ isArmed: true, shown: 'pane' })
    expect(await (await pane($)).find({ text: /LeetClawd/ })).toBeDefined()
  })

  test('a turn shorter than ten seconds shows nothing', async ($, on) => {
    const { clock, panes } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(8_000)
    await answer($, 't1')
    await clock.advance(30_000)

    expect(panes.opened).toBe(0)
  })

  test('it goes when Claude is done, and comes back with what was open and typed', async ($, on) => {
    const { clock, panes, state } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const first = await pane($)

    await first.press({ key: 'open:two-sum' })
    expect(await first.find({ text: /1\. Two Sum/ })).toBeDefined()
    expect(await first.find({ text: /Input: nums = \[2,7,11,15\], target = 9/ })).toBeDefined()

    await first.resize({ columns: 72, rows: 20, in: 'editor' })
    await first.pointer({ type: 'down', x: 30, y: 2, button: 'left', in: 'editor' })
    await first.key({ key: 'end', in: 'editor' })

    for (const key of 'return i') {
      await first.key({ key: key === ' ' ? 'space' : key, in: 'editor' })
    }

    expect(await first.find({ text: /return i/, in: 'editor' })).toBeDefined()

    await answer($, 't1')
    expect(state.drafts).toEqual({ 'two-sum/python3': `${START}return i` })
    expect(panes.isOpen).toBe(false)
    expect(panes.closed).toBe(1)
    expect(state.power).toMatchObject({ isArmed: true, shown: 'none', turn: null })
    await first.unmount()

    await think($, 't2')
    await clock.advance(10_100)
    expect(panes.isOpen).toBe(true)

    const second = await pane($)

    expect(await second.find({ text: /1\. Two Sum/ })).toBeDefined()
    expect(await second.find({ text: /return i/, in: 'editor' })).toBeDefined()
  })

  test('a subagent finishing does not hide it', async ($, on) => {
    const { clock, panes } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)
    await $.turn.complete({ answer: 'sub', durationMs: 5, isAborted: false, turnId: 's1', reason: 'answer', agentId: 'agent-1' })

    expect(panes.isOpen).toBe(true)
  })

  test('where no pane is seated it draws in the band above the prompt, and leaves it with the turn', async ($, on) => {
    const { clock, panes, state } = world(on, { isPlaced: false })

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    expect(panes.opened).toBe(1)
    expect(panes.isOpen).toBe(false)
    expect(state.power).toMatchObject({ shown: 'band' })

    const ui = await band($)

    expect(await ui.find({ text: /LeetClawd/ })).toBeDefined()
    await ui.press({ key: 'open:two-sum' })
    expect(await ui.find({ text: /1\. Two Sum/ })).toBeDefined()
    await ui.press({ key: 'code' })
    expect(await ui.find({ type: 'Client', key: 'editor' })).toBeDefined()

    await answer($, 't1')
    expect(await ui.find({ text: /LeetClawd/ })).toBe(undefined)
    expect(await ui.find({ text: /the engine’s own band/ })).toBeDefined()
  })

  test('in a terminal of 80 by 24 the band has seven rows, and everything is still within reach', async ($, on) => {
    const { clock } = world(on, { isPlaced: false })

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: { columns: 80, rows: 24, isFullscreen: true },
      props: { ...BAND, maxRows: 7, bodyColumns: 75, scroll: { offset: 0, bodyRows: 6 } },
    })

    expect(await ui.find({ text: /needs at least/ })).toBe(undefined)
    expect((await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('open:'))).toHaveLength(4)
    await ui.press({ key: 'open:two-sum' })
    expect(await ui.find({ text: /1\. Two Sum \(Easy\)/ })).toBeDefined()
    expect(await ui.find({ key: 'account' })).toBe(undefined)

    await ui.press({ key: 'more' })
    await ui.press({ key: 'account' })
    expect(await ui.find({ type: 'Input', key: 'cookie' })).toBeDefined()
  })

  test('/leetclawd typed while Claude is already long at work shows at once', async ($, on) => {
    const { clock, panes } = world(on)

    await think($, 't1')
    await clock.advance(30_000)
    await command($, 'leetclawd')
    await clock.settle()

    expect(panes.isOpen).toBe(true)
  })

  test('/unleetclawd clears the state and stops it showing', async ($, on) => {
    const { clock, panes, store, state } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await pane($)

    await ui.press({ key: 'open:two-sum' })
    await clock.advance(2_000)
    expect(store.workspace).toMatchObject({ slug: 'two-sum' })
    expect((await command($, 'unleetclawd')).text).toContain('cleared')

    expect(panes.isOpen).toBe(false)
    expect(store.workspace).toBe(undefined)
    expect(state.power).toMatchObject({ isArmed: false, shown: 'none' })
    expect(state.problem).toMatchObject({ status: 'idle', slug: '', data: null })
    expect(state.work).toEqual({ lang: '', preferred: '', rev: 0 })
    expect(state.drafts).toEqual({})

    await answer($, 't1')
    await think($, 't2')
    await clock.advance(60_000)
    expect(panes.opened).toBe(1)
  })
})

describe('/leetclawdf', () => {
  test('opens it at once with Claude idle and /leetclawd never typed, and it draws the list', async ($, on) => {
    const { clock, panes, state } = world(on)

    expect((await command($, 'leetclawdf')).text).toContain('stays open')
    await clock.settle()

    expect(panes.opened).toBe(1)
    expect(panes.isOpen).toBe(true)
    expect(state.power).toMatchObject({ isArmed: false, isPinned: true, shown: 'pane', turn: null })
    expect(await (await pane($)).find({ key: 'open:two-sum' })).toBeDefined()
  })

  test('it stays open through a turn and after it', async ($, on) => {
    const { clock, panes, state } = world(on)

    await command($, 'leetclawdf')
    await think($, 't1')
    await clock.advance(30_000)
    await answer($, 't1')
    await clock.advance(30_000)

    expect(panes.isOpen).toBe(true)
    expect(panes.opened).toBe(1)
    expect(state.power).toMatchObject({ isPinned: true, shown: 'pane', turn: null })
  })

  test('typed again it closes it, and what /leetclawd set up goes on as before', async ($, on) => {
    const { clock, panes, state } = world(on)

    await command($, 'leetclawd')
    await command($, 'leetclawdf')
    expect(panes.isOpen).toBe(true)

    expect((await command($, 'leetclawdf')).text).toContain('still appears once Claude has been thinking')
    expect(panes.isOpen).toBe(false)
    expect(state.power).toMatchObject({ isArmed: true, isPinned: false, shown: 'none' })

    await think($, 't1')
    await clock.advance(9_000)
    expect(panes.isOpen).toBe(false)
    await clock.advance(1_100)
    expect(panes.isOpen).toBe(true)
    await answer($, 't1')
    expect(panes.isOpen).toBe(false)
  })

  test('typed while it shows for a thinking turn, it keeps it after the turn', async ($, on) => {
    const { clock, panes } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)
    expect(panes.isOpen).toBe(true)

    await command($, 'leetclawdf')
    await answer($, 't1')
    expect(panes.isOpen).toBe(true)
  })

  test('where no pane is seated it holds the band above the prompt, turn or no turn', async ($, on) => {
    const { state } = world(on, { isPlaced: false })

    await command($, 'leetclawdf')
    expect(state.power).toMatchObject({ isPinned: true, shown: 'band' })

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: { ...TERMINAL, columns: 100 },
      props: { ...BAND, isWorking: false },
    })

    expect(await ui.find({ text: /LeetClawd/ })).toBeDefined()
    await command($, 'leetclawdf')
    expect(await ui.find({ text: /LeetClawd/ })).toBe(undefined)
  })

  test('/unleetclawd closes it and clears it', async ($, on) => {
    const { panes, state } = world(on)

    await command($, 'leetclawdf')
    await command($, 'unleetclawd')

    expect(panes.isOpen).toBe(false)
    expect(state.power).toMatchObject({ isArmed: false, isPinned: false, shown: 'none' })
  })
})

describe('the shortcut key', () => {
  test('typed twice in an empty prompt box, it shows LeetClawd at once and keeps it, then hides it', async ($, on) => {
    const { panes, state } = world(on)

    expect(await typing($, '', ';')).toEqual({ text: ';', cursor: 1 })
    expect(await typing($, ';', ';')).toEqual({ text: '', cursor: 0 })
    expect(panes.isOpen).toBe(true)
    expect(state.power).toMatchObject({ isPinned: true, shown: 'pane' })

    await think($, 't1')
    await answer($, 't1')
    expect(panes.isOpen).toBe(true)

    await typing($, '', ';')
    expect(await typing($, ';', ';')).toEqual({ text: '', cursor: 0 })
    expect(panes.isOpen).toBe(false)
    expect(state.power).toMatchObject({ isPinned: false, shown: 'none' })
  })

  test('it hides what a thinking turn brought up, for the rest of that turn', async ($, on) => {
    const { clock, panes } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)
    expect(panes.isOpen).toBe(true)

    await typing($, ';', ';')
    expect(panes.isOpen).toBe(false)
    await clock.advance(60_000)
    expect(panes.isOpen).toBe(false)
  })

  test('then a button’s letter presses that button, and a row’s number opens the row', async ($, on) => {
    const { sent, clock } = world(on, { env: { LEETCODE_SESSION: GOOD } })

    await typing($, ';', ';')

    const ui = await pane($)

    expect(await typing($, ';', '1')).toEqual({ text: '', cursor: 0 })
    await clock.settle()
    expect(await ui.find({ text: /1\. Two Sum/ })).toBeDefined()

    expect(await typing($, ';', 'r')).toEqual({ text: '', cursor: 0 })
    await clock.settle()
    expect(sent.some(one => one.url.endsWith('/interpret_solution/'))).toBe(true)
    expect(await ui.find({ text: /Running the examples on LeetCode/ })).toBeDefined()

    await typing($, ';', 'R')
    await clock.settle()
    expect(await ui.find({ text: /still judging your last run/ })).toBeDefined()
  })

  test('two keys that arrive together are read as the shortcut key and what follows it', async ($, on) => {
    const { panes, clock } = world(on)

    expect(await typing($, '', ';;')).toEqual({ text: '', cursor: 0 })
    expect(panes.isOpen).toBe(true)

    const ui = await pane($)

    expect(await typing($, '', ';h')).toEqual({ text: '', cursor: 0 })
    await clock.settle()
    expect(await ui.find({ text: /Showing and hiding/ })).toBeDefined()
  })

  test('it leaves every other typing alone', async ($, on) => {
    const { panes, sent } = world(on, { env: { LEETCODE_SESSION: GOOD } })

    // with LeetClawd off screen, only the key twice means anything
    expect(await typing($, ';', 'r')).toEqual({ text: ';r', cursor: 2 })
    expect(await typing($, 'fix this', ';')).toEqual({ text: 'fix this;', cursor: 9 })
    expect(await typing($, 'a;', ';')).toEqual({ text: 'a;;', cursor: 3 })
    expect(await typing($, '', '; then a pasted line')).toEqual({ text: '; then a pasted line', cursor: 20 })
    expect(panes.opened).toBe(0)

    // on screen, the key and a space is still text; a key that names no button is taken and said so
    await typing($, ';', ';')

    const ui = await pane($)

    expect(await typing($, ';', ' ')).toEqual({ text: '; ', cursor: 2 })
    expect(await typing($, ';', 'q')).toEqual({ text: '', cursor: 0 })
    expect(await ui.find({ text: /;q presses nothing here\. ;h lists the keys\./ })).toBeDefined()
    expect(sent.some(one => one.url.includes('/problems/'))).toBe(false)
  })

  test('another key can be set in its place', { options: { shortcutKey: ',' } }, async ($, on) => {
    const { panes } = world(on)

    expect(await typing($, ';', ';')).toEqual({ text: ';;', cursor: 2 })
    expect(panes.opened).toBe(0)
    expect(await typing($, ',', ',')).toEqual({ text: '', cursor: 0 })
    expect(panes.isOpen).toBe(true)
    expect(await (await pane($)).find({ text: /,1-,9 open a row/ })).toBeDefined()
  })
})

describe('the help page', () => {
  test('is a button on every screen, says how to drive LeetClawd, scrolls, and goes back where it came from', async ($, on) => {
    const { state, clock } = world(on)

    await command($, 'leetclawdf')

    const ui = await pane($)

    await ui.press({ key: 'open:two-sum' })

    for (const screen of ['list', 'account', 'langs'] as const) {
      await ui.press({ key: screen })
      expect(await ui.find({ type: 'Button', key: 'help' })).toBeDefined()
      await ui.press({ key: 'problem' })
    }

    await ui.press({ key: 'help' })
    expect(await ui.find({ text: /\/leetclawdf/ })).toBeDefined()
    expect(await ui.find({ text: /Show or hide it at once/ })).toBeDefined()
    expect(await ui.find({ text: /that letter: ;r runs, ;s submits, ;h is this page/ })).toBeDefined()
    expect(state.view).toMatchObject({ screen: 'help', from: 'problem' })

    await typing($, ';', 'j')
    await clock.settle()
    expect((state.view as { helpTop: number }).helpTop > 0).toBe(true)

    await ui.press({ key: 'leave' })
    expect(state.view).toMatchObject({ screen: 'problem' })
    expect(await ui.find({ text: /1\. Two Sum/ })).toBeDefined()
  })

  test('fits the seven rows of a small terminal’s band', async ($, on) => {
    const { clock } = world(on, { isPlaced: false })

    await command($, 'leetclawdf')

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'AbovePrompt',
      viewport: { columns: 80, rows: 24, isFullscreen: true },
      props: { ...BAND, isWorking: false, maxRows: 7, bodyColumns: 75, scroll: { offset: 0, bodyRows: 6 } },
    })

    await typing($, ';', 'h')
    await clock.settle()
    expect(await ui.find({ text: /LeetCode inside Claude Code/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'leave' })).toBeDefined()
  })
})

describe('working a problem', () => {
  const opened = async ($: Engine, on: On, options: Parameters<typeof world>[1] = {}) => {
    const held = world(on, options)

    await command($, 'leetclawd')
    await think($, 't1')
    await held.clock.advance(10_100)

    const ui = await pane($)

    await ui.press({ key: 'open:two-sum' })

    return { ...held, ui }
  }

  test('the difficulty button steps the list through the levels', async ($, on) => {
    const { clock, sent } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await pane($)

    await ui.press({ key: 'difficulty' })
    expect(await ui.find({ key: 'difficulty', text: /Difficulty: Easy/ })).toBeDefined()
    expect((sent.at(-1)?.body.variables as { filters: unknown }).filters).toEqual({ difficulty: 'EASY' })
  })

  test('the list pages on as it is scrolled', async ($, on) => {
    const { clock, sent } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await pane($)

    expect(await ui.find({ key: 'open:problem-2' })).toBeDefined()
    expect(await ui.find({ key: 'open:problem-45' })).toBe(undefined)
    await ui.press({ key: 'next' })
    expect(await ui.find({ key: 'open:problem-45' })).toBeDefined()
    expect(sent.filter(one => String(one.body.query).includes('problemsetQuestionList')).map(one => (one.body.variables as { skip: number }).skip)).toEqual([0, 50])
  })

  test('Run sends the code and the examples to LeetCode as the signed-in person and shows the verdict', async ($, on) => {
    const { ui, clock, sent } = await opened($, on, { env: { LEETCODE_SESSION: GOOD } })

    await ui.press({ key: 'run' })

    const run = sent.find(one => one.url.endsWith('/interpret_solution/'))

    expect(run?.url).toBe('https://leetcode.com/problems/two-sum/interpret_solution/')
    expect(run?.body).toEqual({ lang: 'python3', question_id: '1', typed_code: START, data_input: QUESTION.exampleTestcases })
    expect(run?.headers).toMatchObject({
      Cookie: `LEETCODE_SESSION=${GOOD}; csrftoken=csrf123`,
      'x-csrftoken': 'csrf123',
      Referer: 'https://leetcode.com/problems/two-sum/',
    })
    expect(await ui.find({ text: /Running the examples on LeetCode/ })).toBeDefined()

    await clock.advance(3_000)
    expect(sent.filter(one => one.url.includes('/submissions/detail/runcode_1/check/'))).toHaveLength(3)
    expect(await ui.find({ text: 'Accepted' })).toBeDefined()
    expect(await ui.find({ text: /2\/2 example cases passed/ })).toBeDefined()
    expect(await ui.find({ text: /Input: {4}nums = \[2,7,11,15\], target = 9/ })).toBeDefined()
    expect(await ui.find({ text: 'Case 2: passed' })).toBeDefined()
  })

  test('Submit makes a submission and shows how it did', async ($, on) => {
    const { ui, clock, sent } = await opened($, on, { env: { LEETCODE_SESSION: GOOD } })

    await ui.press({ key: 'submit' })
    expect(sent.find(one => one.url.endsWith('/submit/'))?.body).toEqual({ lang: 'python3', question_id: '1', typed_code: START })

    await clock.advance(3_000)
    expect(sent.some(one => one.url.includes('/submissions/detail/777/check/'))).toBe(true)
    expect(await ui.find({ text: /63\/63 testcases passed · Runtime 3 ms \(beats 87\.2%\)/ })).toBeDefined()
  })

  test('signed out, Run sends nothing to the judge and says how to sign in', async ($, on) => {
    const { ui, sent } = await opened($, on)

    await ui.press({ key: 'run' })

    expect(sent.some(one => one.url.includes('/problems/'))).toBe(false)
    expect(await ui.find({ text: /you are not signed in/ })).toBeDefined()
  })

  test('ctrl+r in the editor runs what is typed; ctrl+s submits only once confirmed', async ($, on) => {
    const { ui, sent, state } = await opened($, on, { env: { LEETCODE_SESSION: GOOD } })

    await ui.resize({ columns: 72, rows: 20, in: 'editor' })
    await ui.key({ key: 'x', in: 'editor' })
    await ui.key({ key: 'r', ctrl: true, in: 'editor' })
    expect(sent.find(one => one.url.endsWith('/interpret_solution/'))?.body.typed_code).toBe(`x${START}`)

    await ui.key({ key: 's', ctrl: true, in: 'editor' })
    expect(await ui.find({ text: /Submit to LeetCode\?/, in: 'editor' })).toBeDefined()
    await ui.key({ key: 'y', in: 'editor' })
    expect(sent.some(one => one.url.endsWith('/submit/'))).toBe(false)
    expect(state.drafts).toEqual({ 'two-sum/python3': `x${START}` })
  })

  test('characters that arrive together are all typed, and typing writes nothing until it pauses', async ($, on) => {
    const { ui, state, writes, clock } = await opened($, on)

    await ui.resize({ columns: 72, rows: 20, in: 'editor' })

    const before = writes.count

    await ui.key({ key: 'seen := map[byte]int{}', in: 'editor' })
    await ui.key({ key: 'home', in: 'editor' })
    await ui.key({ key: 'x', in: 'editor' })
    expect(await ui.find({ text: /xseen := map\[byte\]int\{\}/, in: 'editor' })).toBeDefined()
    expect(writes.count).toBe(before)

    await clock.advance(1_000)
    expect(state.drafts).toEqual({ 'two-sum/python3': `xseen := map[byte]int{}${START}` })
  })

  test('a language switch keeps a draft for each language', async ($, on) => {
    const { ui, state, clock } = await opened($, on)

    await ui.press({ key: 'langs' })
    expect(await ui.find({ key: 'lang:python3', text: /● Python3/ })).toBeDefined()
    await ui.press({ key: 'lang:cpp' })
    expect(await ui.find({ text: /Code · C\+\+/ })).toBeDefined()
    expect(state.work).toMatchObject({ lang: 'cpp', preferred: 'cpp' })

    await clock.advance(1_000)
    expect(state.drafts).toEqual({ 'two-sum/python3': START, 'two-sum/cpp': 'class Solution {\npublic:\n    \n};' })
  })

  test('the code goes to the prompt box and Enter there saves it back without reaching Claude', async ($, on) => {
    const { ui, box, clock, state } = await opened($, on)

    await ui.press({ key: 'prompt' })
    expect(box.text).toBe(toPrompt('two-sum', 'python3', START))

    const edited = `${box.text}return [0, 1]`
    const saved = await $.prompt.submit({ text: edited, wait: false, origin: { kind: 'composer' } })

    expect(saved.drop).toContain('not sent to Claude')
    expect(state.drafts).toEqual({ 'two-sum/python3': `${START}return [0, 1]` })
    box.text = edited
    await clock.advance(100)
    expect(box.text).toBe('')

    const plain = await $.prompt.submit({ text: 'fix the bug', wait: false, origin: { kind: 'composer' } })

    expect(plain).toEqual({ text: 'fix the bug' })
  })

  test('text already in the prompt box is never overwritten', async ($, on) => {
    const { ui, box } = await opened($, on)

    box.text = 'a prompt I am still writing'
    await ui.press({ key: 'prompt' })

    expect(box.text).toBe('a prompt I am still writing')
    expect(await ui.find({ text: /The prompt box holds text/ })).toBeDefined()
  })

  test('Reset asks twice before it replaces the code', async ($, on) => {
    const { ui, state, clock } = await opened($, on)

    await ui.resize({ columns: 72, rows: 20, in: 'editor' })
    await ui.key({ key: 'x', in: 'editor' })
    await ui.press({ key: 'reset' })
    await clock.advance(1_000)
    expect(state.drafts).toEqual({ 'two-sum/python3': `x${START}` })
    expect(await ui.find({ text: /Press z again/ })).toBeDefined()

    await ui.press({ key: 'reset' })
    expect(state.drafts).toEqual({ 'two-sum/python3': START })
    expect(await ui.find({ text: /def twoSum/, in: 'editor' })).toBeDefined()
  })

  test('the wheel scrolls the panel under the pointer', async ($, on) => {
    const { ui, state } = await opened($, on)

    await ui.press({ key: 'list' })
    await ui.press({ key: 'open:problem-2' })
    expect(await ui.find({ text: /Paragraph 1$/ })).toBeDefined()
    await $.ui.scroll({
      component: 'Pane',
      requestId: PLUGIN,
      offset: 0,
      by: 5,
      bodyRows: 44,
      contentRows: 44,
      origin: { kind: 'person' },
      pointer: { column: 3, row: 4 },
    })

    expect(state.view).toMatchObject({ descTop: 5 })
    expect(await ui.find({ text: /Paragraph 1$/ })).toBe(undefined)
  })
})

describe('the LeetCode account', () => {
  test('a pasted cookie signs in and is kept; one LeetCode turns down is not', async ($, on) => {
    const { clock, store } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await pane($)

    await ui.press({ key: 'account' })
    expect(await ui.find({ text: /Not signed in/ })).toBeDefined()

    await ui.input({ key: 'cookie', text: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.expired-session' })
    expect(await ui.find({ text: /did not accept that session/ })).toBeDefined()
    expect(store.session).toBe(undefined)

    await ui.input({ key: 'cookie', text: `LEETCODE_SESSION=${GOOD};` })
    expect(await ui.find({ text: /Signed in as @jackson/ })).toBeDefined()
    expect(store.session).toBe(GOOD)

    await ui.press({ key: 'signout' })
    expect(store.session).toBe(undefined)
    expect(await ui.find({ text: /Not signed in/ })).toBeDefined()
  })
  test('a pasted cookie comes before the environment’s, which signs in by itself', async ($, on) => {
    const { clock, store } = world(on, { env: { LEETCODE_SESSION: GOOD } })

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await pane($)

    await ui.press({ key: 'account' })
    expect(await ui.find({ text: /Signed in as @jackson, using the LEETCODE_SESSION environment variable/ })).toBeDefined()

    await ui.input({ key: 'cookie', text: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.another-session' })
    expect(store.session).toBe(undefined)
    expect(await ui.find({ text: /did not accept that session/ })).toBeDefined()
  })
})

describe('signing in with the session Safari holds', () => {
  const NOW = 1_000_000
  const account = async ($: Engine, on: On, safari: Uint8Array | Error | undefined) => {
    const held = world(on, { env: { HOME: '/Users/me' }, ...(safari === undefined ? {} : { safari }) })

    await command($, 'leetclawd')
    await think($, 't1')
    await held.clock.advance(10_100)

    const ui = await pane($)

    await ui.press({ key: 'account' })

    return { ...held, ui }
  }

  test('the session of a Google sign-in in Safari signs in here, and is the one cookie taken', async ($, on) => {
    const file = cookieFile([
      [
        { domain: '.bank.example', name: 'session', value: 'never-read-out', expiresAt: NOW + 9e9 },
        { domain: '.leetcode.com', name: 'LEETCODE_SESSION', value: GOOD, expiresAt: NOW + 9e9 },
      ],
    ])
    const { ui, store, sent } = await account($, on, file)

    expect(await ui.find({ text: /Signed in to leetcode\.com in a browser, with Google or any other way\?/ })).toBeDefined()
    await ui.press({ key: 'safari' })

    expect(await ui.find({ text: /Signed in as @jackson/ })).toBeDefined()
    expect(store.session).toBe(GOOD)
    expect(JSON.stringify([store, sent])).not.toContain('never-read-out')
    expect(sent.every(one => one.url.startsWith('https://leetcode.com/'))).toBe(true)
  })

  test('with no leetcode.com session in Safari it says to sign in there first', async ($, on) => {
    const { ui, store } = await account($, on, cookieFile([[{ domain: '.example.com', name: 'a', value: 'b', expiresAt: NOW + 9e9 }]]))

    await ui.press({ key: 'safari' })

    expect(await ui.find({ text: /Safari holds no live leetcode\.com session/ })).toBeDefined()
    expect(store.session).toBe(undefined)
  })

  test('cookies the terminal may not read say how to allow it', async ($, on) => {
    const { ui } = await account($, on, new Error('EPERM: operation not permitted'))

    await ui.press({ key: 'safari' })

    expect(await ui.find({ text: /macOS did not let this terminal read Safari’s cookies/ })).toBeDefined()
    expect(await ui.find({ text: /Full Disk Access/ })).toBeDefined()
  })

  test('where there is no Safari the button is not offered', async ($, on) => {
    const { ui } = await account($, on, undefined)

    expect(await ui.find({ key: 'safari' })).toBe(undefined)
    expect(await ui.find({ type: 'Input', key: 'cookie' })).toBeDefined()
  })
})

describe('signing in with the session Firefox or Chrome holds', () => {
  const account = async ($: Engine, on: On, options: Parameters<typeof world>[1]) => {
    const held = world(on, { env: { HOME: '/Users/me' }, ...options })

    await command($, 'leetclawdf')

    const ui = await pane($)

    await ui.press({ key: 'account' })

    return { ...held, ui }
  }

  test('only the browsers this machine has are offered', async ($, on) => {
    const { ui } = await account($, on, { firefox: '' })

    expect(await ui.find({ type: 'Button', key: 'firefox' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'chrome' })).toBe(undefined)
    expect(await ui.find({ type: 'Button', key: 'safari' })).toBe(undefined)
  })

  test('Firefox: its store is asked for the one cookie, read-only, and the session signs in', async ($, on) => {
    const { ui, store, ran } = await account($, on, { firefox: `${FIREFOX_HEX}|2000000000\n` })

    await ui.press({ key: 'firefox' })

    expect(await ui.find({ text: /Signed in as @jackson, using the session imported from Firefox/ })).toBeDefined()
    expect(store).toMatchObject({ session: GOOD, sessionVia: 'firefox' })
    expect(ran).toHaveLength(1)
    expect(ran[0]?.slice(0, 5)).toEqual(['sqlite3', '-readonly', '-batch', '-noheader', `${FIREFOX}/abc.default-release/cookies.sqlite`])
    expect(ran[0]?.[5]).toContain("name='LEETCODE_SESSION' AND host IN ('leetcode.com','.leetcode.com','www.leetcode.com')")
  })

  test('Firefox with no session there says to sign in there', async ($, on) => {
    const { ui, store } = await account($, on, { firefox: '' })

    await ui.press({ key: 'firefox' })

    expect(await ui.find({ text: /Firefox holds no live leetcode\.com session/ })).toBeDefined()
    expect(store.session).toBe(undefined)
  })

  test('Chrome: macOS is asked for the key, the cookie is opened with it, and the session signs in', async ($, on) => {
    const { ui, store, ran } = await account($, on, {
      chrome: { rows: `${CHROME_SEALED}||13644473600000000\n`, key: 'test-keychain-password' },
    })

    await ui.press({ key: 'chrome' })

    expect(await ui.find({ text: /Signed in as @jackson, using the session imported from Chrome/ })).toBeDefined()
    expect(store).toMatchObject({ session: GOOD, sessionVia: 'chrome' })
    expect(ran.map(argv => argv[0])).toEqual(['sqlite3', '/usr/bin/security'])
    expect(ran[0]?.[4]).toBe(`${CHROME}/Default/Cookies`)
    expect(JSON.stringify(store)).not.toContain('test-keychain-password')
  })

  test('Chrome with no session there never asks macOS for the key', async ($, on) => {
    const { ui, ran } = await account($, on, { chrome: { rows: '', key: 'test-keychain-password' } })

    await ui.press({ key: 'chrome' })

    expect(await ui.find({ text: /Chrome holds no live leetcode\.com session/ })).toBeDefined()
    expect(ran.map(argv => argv[0])).toEqual(['sqlite3'])
  })

  test('Chrome, the key denied or the wrong one, signs nothing in and says why', async ($, on) => {
    const denied = await account($, on, { chrome: { rows: `${CHROME_SEALED}||13644473600000000\n`, key: null } })

    await denied.ui.press({ key: 'chrome' })
    expect(await denied.ui.find({ text: /macOS did not unlock Chrome’s cookies/ })).toBeDefined()
    expect(denied.store.session).toBe(undefined)
  })

  test('Chrome, a key that does not open the cookie signs nothing in', async ($, on) => {
    const { ui, store } = await account($, on, { chrome: { rows: `${CHROME_SEALED}||13644473600000000\n`, key: 'another-password' } })

    await ui.press({ key: 'chrome' })

    expect(await ui.find({ text: /Not signed in|could not be opened|does not open/ })).toBeDefined()
    expect(store.session).toBe(undefined)
  })
})

describe('other surfaces', () => {
  test('the pane draws on each of them', async ($, on) => {
    const { clock } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, viewport: TERMINAL, props: PANE })

      expect(await ui.find({ text: /LeetClawd/ })).toBeDefined()
      await ui.press({ key: 'open:two-sum' })
      expect(await ui.find({ text: /1\. Two Sum/ })).toBeDefined()
      await ui.press({ key: 'list' })
      await ui.unmount()
    }
  })

  test('on the terminal’s main screen, where no click reaches an editor, the code is read-only with a way to edit it', async ($, on) => {
    const { clock } = world(on)

    await command($, 'leetclawd')
    await think($, 't1')
    await clock.advance(10_100)

    const ui = await $.ui.mount({
      plugin: PLUGIN,
      surface: 'terminal',
      component: 'Pane',
      requestId: PLUGIN,
      viewport: { columns: 160, rows: 46, isFullscreen: false },
      props: { ...PANE, bodyColumns: 156, placement: 'inline', scroll: { offset: 0, bodyRows: 30 } },
    })

    await ui.press({ key: 'open:two-sum' })
    expect(await ui.find({ type: 'Client' })).toBe(undefined)
    expect(await ui.find({ text: /def twoSum/ })).toBeDefined()
    expect(await ui.find({ text: /e puts the code in the prompt box/ })).toBeDefined()
  })
})
