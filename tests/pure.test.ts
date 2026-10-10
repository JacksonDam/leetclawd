import { describe, expect, test } from 'claude-code/testing'

import { applyKey, fromText, toText } from '../hooks/edit'
import type { Buffer, Key } from '../hooks/edit'
import { tokenize } from '../hooks/highlight'
import { followsLeader, leaderOf } from '../hooks/keys'
import { chromeRows, chromeValue, firefoxSessions, liveSession, sqliteArgv } from '../hooks/browsers'
import { aesCbcDecrypt, bytesOfHex, pbkdf2Sha1 } from '../hooks/crypto'
import { layout, parse } from '../hooks/html'
import { casesOf, cookieOf, fromPrompt, parseQuestion, readJson, toPrompt, verdictOf } from '../hooks/leetcode'
import { bytesOf, leetcodeSession, readCookies } from '../hooks/safari'
import { widthOf } from '../hooks/text'

import { base64Of, cookieFile } from './cookies'

const STATEMENT = `<p>Given an array of integers <code>nums</code>&nbsp;and an integer <code>target</code>, return <em>indices</em>.</p>

<p>&nbsp;</p>
<p><strong class="example">Example 1:</strong></p>

<pre>
<strong>Input:</strong> nums = [2,7,11,15], target = 9
<strong>Output:</strong> [0,1]
</pre>

<p><strong>Constraints:</strong></p>

<ul>
	<li><code>2 &lt;= nums.length &lt;= 10<sup>4</sup></code></li>
	<li><strong>Only one valid answer exists.</strong></li>
</ul>`

const rowsOf = (html: string, width: number): string[] =>
  layout(parse(html), width).map(line => line.map(span => span.text).join(''))

const type = (buffer: Buffer, keys: readonly (Key | string)[], lang = 'python3'): Buffer =>
  keys.reduce<Buffer>(
    (held, key) =>
      typeof key === 'string'
        ? [...key].reduce<Buffer>((now, char) => applyKey(now, { key: char }, { lang, page: 10 }).buffer, held)
        : applyKey(held, key, { lang, page: 10 }).buffer,
    buffer,
  )

describe('a problem statement', () => {
  test('reads as rows of text: paragraphs, an example block, a list', () => {
    const rows = rowsOf(STATEMENT, 60)

    expect(rows.slice(0, 2)).toEqual(['Given an array of integers nums and an integer target,', 'return indices.'])
    expect(rows).toContain('Example 1:')
    expect(rows).toContain('│ Input: nums = [2,7,11,15], target = 9')
    expect(rows).toContain('│ Output: [0,1]')
    expect(rows).toContain('• 2 <= nums.length <= 10^4')
    expect(rows).toContain('• Only one valid answer exists.')
  })

  test('never draws a row wider than its room, nor a control character', () => {
    for (const width of [20, 37, 80]) {
      for (const line of layout(parse(`${STATEMENT}<pre>\ta\u0007 very long preformatted row that has to be wrapped somewhere</pre>`), width)) {
        expect(widthOf(line) <= width).toBe(true)
        expect(/[\u0000-\u001f\u007f]/.test(line.map(span => span.text).join(''))).toBe(false)
      }
    }
  })

  test('keeps a word and the code beside it on one row', () => {
    const rows = rowsOf('<p>aaaa bbbb <code>cccc</code>.dddd</p>', 12)

    expect(rows).toEqual(['aaaa bbbb', 'cccc.dddd'])
  })

  test('draws a run of words of one style as one span', () => {
    expect(layout(parse('<p>one two <strong>three four</strong> five</p>'), 60)).toEqual([
      [{ text: 'one two ' }, { text: 'three four', bold: true }, { text: ' five' }],
    ])
  })
})

describe('the editor', () => {
  test('indents after a colon and leaves the block after a return', () => {
    const start = applyKey(fromText('def f(x):'), { key: 'end' }, { lang: 'python3', page: 10 }).buffer
    const done = type(start, [{ key: 'return' }, 'if x:', { key: 'return' }, 'return 1', { key: 'return' }, 'return 2'])

    expect(toText(done)).toBe('def f(x):\n    if x:\n        return 1\n    return 2')
  })

  test('backspace in the indent steps back one stop; tab and shift+tab move by one', () => {
    const start = type(fromText(''), ['        x'])
    const home = applyKey(start, { key: 'a', ctrl: true }, { lang: 'python3', page: 10 }).buffer
    const indented = type(home, [{ key: 'tab' }])

    expect(toText(indented)).toBe('            x')
    expect(toText(type(indented, [{ key: 'tab', shift: true }, { key: 'tab', shift: true }]))).toBe('    x')

    const inIndent = type(fromText('        x'), [{ key: 'right' }, { key: 'right' }, { key: 'right' }, { key: 'right' }, { key: 'right' }, { key: 'right' }, { key: 'backspace' }])

    expect(toText(inIndent)).toBe('      x')
  })

  test('splits a pair of braces around the cursor', () => {
    const start = type(fromText('int f() {}', ), [{ key: 'end' }, { key: 'left' }, { key: 'return' }, 'return 1;'], 'cpp')

    expect(toText(start)).toBe('int f() {\n    return 1;\n}')
  })

  test('asks for a run or a submit and types nothing for a key it does not know', () => {
    const buffer = fromText('x')

    expect(applyKey(buffer, { key: 'r', ctrl: true }, { lang: 'python3', page: 10 }).command).toBe('run')
    expect(applyKey(buffer, { key: 's', ctrl: true }, { lang: 'python3', page: 10 }).command).toBe('submit')
    expect(toText(type(buffer, [{ key: '\u001b[15~' }, { key: '\u0000' }, { key: 'q', meta: true }]))).toBe('x')
    expect(toText(type(buffer, [{ key: 'space' }, { key: 'A', shift: true }]))).toBe(' Ax')
  })

  test('types every character of a burst that arrives as one key', () => {
    const typedFast = type(fromText(''), [{ key: 'seen := {}' }, { key: 'return' }, { key: 'ok' }, { key: 'up' }, { key: '!' }])

    expect(toText(typedFast)).toBe('se!en := {}\nok')
  })

  test('colours a keyword, a string and a comment', () => {
    expect(tokenize('return "a"  # done', 'python3')).toEqual([
      { text: 'return', color: 'suggestion' },
      { text: ' ' },
      { text: '"a"', color: 'success' },
      { text: '  ' },
      { text: '# done', dim: true },
    ])
  })
})

describe('what LeetCode answers', () => {
  const question = {
    status: 200,
    headers: {},
    text: JSON.stringify({
      data: {
        question: {
          questionId: '1',
          questionFrontendId: '1',
          title: 'Two Sum',
          titleSlug: 'two-sum',
          difficulty: 'Easy',
          isPaidOnly: false,
          content: STATEMENT,
          exampleTestcases: '[2,7,11,15]\n9\n[3,2,4]\n6',
          metaData: JSON.stringify({ name: 'twoSum', params: [{ name: 'nums' }, { name: 'target' }] }),
          codeSnippets: [{ lang: 'Python3', langSlug: 'python3', code: 'class Solution:\n\tpass' }],
          topicTags: [{ name: 'Array' }],
        },
      },
    }),
  }

  test('a question: its cases by parameter, its snippets with tabs widened', () => {
    const problem = parseQuestion(question)

    expect(casesOf(problem)).toEqual(['nums = [2,7,11,15], target = 9', 'nums = [3,2,4], target = 6'])
    expect(problem.snippets[0]?.code).toBe('class Solution:\n    pass')
  })

  test('a run that fails one example names the case', () => {
    const verdict = verdictOf(
      'run',
      {
        state: 'SUCCESS',
        status_code: 10,
        status_msg: 'Accepted',
        code_answer: ['[0,1]', '[0,2]', ''],
        expected_code_answer: ['[0,1]', '[1,2]', ''],
        std_output_list: ['', 'debug\n', ''],
        compare_result: '10',
        correct_answer: false,
        total_testcases: 2,
        status_runtime: '4 ms',
      },
      parseQuestion(question),
    )

    expect(verdict.headline).toBe('Wrong Answer')
    expect(verdict.detail).toBe('1/2 example cases passed · 4 ms')
    expect(verdict.sections.map(part => part.label)).toEqual(['Case 1: passed', 'Case 2: failed'])
    expect(verdict.sections[1]?.text).toBe(
      'Input:    nums = [3,2,4], target = 6\nOutput:   [0,2]\nExpected: [1,2]\nStdout:   debug',
    )
  })

  test('an accepted submission, a wrong one and a compile error', () => {
    expect(
      verdictOf(
        'submit',
        { status_code: 10, status_msg: 'Accepted', total_correct: 63, total_testcases: 63, status_runtime: '3 ms', runtime_percentile: 87.21, status_memory: '18.1 MB', memory_percentile: 45 },
        null,
      ),
    ).toEqual({
      tone: 'ok',
      headline: 'Accepted',
      detail: '63/63 testcases passed · Runtime 3 ms (beats 87.2%) · Memory 18.1 MB (beats 45.0%)',
      sections: [],
    })

    const wrong = verdictOf(
      'submit',
      { status_code: 11, status_msg: 'Wrong Answer', total_correct: 57, total_testcases: 63, last_testcase: '[3,3]\n6', code_output: '[0,0]', expected_output: '[0,1]' },
      null,
    )

    expect(wrong.headline).toBe('Wrong Answer')
    expect(wrong.detail).toBe('57/63 testcases passed')
    expect(wrong.sections.map(part => part.label)).toEqual(['Last testcase', 'Output', 'Expected'])
    expect(verdictOf('run', { status_code: 20, full_compile_error: 'Line 3: SyntaxError' }, null).sections).toEqual([
      { label: 'Compiler', text: 'Line 3: SyntaxError', tone: 'bad' },
    ])
  })

  test('a refusal is said in words a person can act on', () => {
    expect(() => readJson({ status: 403, headers: {}, text: '{"error": "User is not authenticated"}' })).toThrow(
      /not signed in/,
    )
    expect(() => readJson({ status: 403, headers: {}, text: '<html><title>Just a moment...</title></html>' })).toThrow(
      /browser check/,
    )
  })

  test('a solution goes to the prompt box and back; any other prompt is left alone', () => {
    const code = 'class Solution:\n    pass'

    expect(fromPrompt(toPrompt('two-sum', 'python3', code))).toEqual({ slug: 'two-sum', lang: 'python3', code })
    expect(fromPrompt('please fix [leetclawd two-sum python3]')).toBe(null)
    expect(fromPrompt('[leetclawd] hello')).toBe(null)
  })

  test('a pasted cookie: the value alone, the named pair, and nothing that is no cookie', () => {
    const value = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.abc-def_123'

    expect(cookieOf(` ${value} `)).toBe(value)
    expect(cookieOf(`csrftoken=x; LEETCODE_SESSION=${value}; other=1`)).toBe(value)
    expect(cookieOf(`${value}\r\nX-Injected: 1`)).toBe('')
    expect(cookieOf('short')).toBe('')
  })
})

describe('Safari’s cookie file', () => {
  const NOW = Date.UTC(2026, 9, 10)
  const DAY = 86_400_000
  const file = cookieFile([
    [
      { domain: '.example.com', name: 'LEETCODE_SESSION', value: 'not-leetcode', expiresAt: NOW + 30 * DAY },
      { domain: 'leetcode.com', name: 'csrftoken', value: 'abc', expiresAt: NOW + 300 * DAY },
    ],
    [
      { domain: '.leetcode.com', name: 'LEETCODE_SESSION', value: 'old.session.value', expiresAt: NOW - DAY },
      { domain: '.leetcode.com', name: 'LEETCODE_SESSION', value: 'live.session.value', expiresAt: NOW + 14 * DAY },
      { domain: '.leetcode.cn', name: 'LEETCODE_SESSION', value: 'another.site', expiresAt: NOW + 60 * DAY },
    ],
  ])

  test('gives every cookie of every page, with its domain, path and expiry', () => {
    const cookies = readCookies(bytesOf(base64Of(file)))

    expect(cookies).toHaveLength(5)
    expect(cookies[1]).toEqual({ domain: 'leetcode.com', name: 'csrftoken', path: '/', value: 'abc', expiresAt: NOW + 300 * DAY })
  })

  test('names the live leetcode.com session, not a lapsed one nor another site’s', () => {
    expect(leetcodeSession(readCookies(file), NOW)?.value).toBe('live.session.value')
    expect(leetcodeSession(readCookies(file), NOW + 20 * DAY)).toBe(undefined)
  })

  test('a file cut short gives what it holds, and one that is no cookie file is refused', () => {
    expect(readCookies(file.subarray(0, file.length - 40)).map(cookie => cookie.name)).toEqual(['LEETCODE_SESSION', 'csrftoken'])
    expect(() => readCookies(new TextEncoder().encode('not a cookie file'))).toThrow(/not a Safari cookie file/)
  })
})

describe('the shortcut key', () => {
  const edit = (text: string, inputText: string, cursor = text.length) => ({ text, cursor, start: cursor, end: cursor, inputText })

  test('leads only in an empty prompt box, one key after it', () => {
    expect(followsLeader(edit(';', 'r'), ';')).toBe('r')
    expect(followsLeader(edit(';', ';'), ';')).toBe(';')
    expect(followsLeader(edit('', ';r'), ';')).toBe('r')
    expect(followsLeader(edit('', ';'), ';')).toBe(undefined)
    expect(followsLeader(edit('a;', 'r'), ';')).toBe(undefined)
    expect(followsLeader(edit(';', 'run'), ';')).toBe(undefined)
    expect(followsLeader(edit(';', 'r', 0), ';')).toBe(undefined)
    expect(followsLeader({ text: ';', cursor: 1, start: 0, end: 1, inputText: '' }, ';')).toBe(undefined)
  })

  test('is one character that leads nothing else in the prompt box, else the semicolon', () => {
    expect(leaderOf(',')).toBe(',')
    expect(leaderOf('`')).toBe('`')

    for (const refused of ['', 'ab', 'a', '7', ' ', '/', '!', '@', '#', '?', undefined, 3]) {
      expect(leaderOf(refused)).toBe(';')
    }
  })
})

describe('what Firefox and Chrome keep', () => {
  const SESSION = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.good-session'
  const HEX = '65794A30655841694F694A4B563151694C434A68624763694F694A49557A49314E694A392E676F6F642D73657373696F6E'
  const SEALED =
    '763130F2444AEB21877F7EE2132BABDEBB350E845DF6A3A50641A15FA42D96CD50099F5733B04B7C1292036343843529A03FBDB5279F5C91E923CE0F7F1D904D2941548A25B67370D0B0723D49B78AB55B9F6C6B9735455D67D674255872AA18A18782'

  test('AES-128-CBC and PBKDF2-SHA1 agree with the published vectors', () => {
    // FIPS-197 appendix C.1's key and block, through CBC with a zero IV and its padding block (by OpenSSL);
    // RFC 6070 gives the PBKDF2 keys
    const key = bytesOfHex('000102030405060708090a0b0c0d0e0f')
    const block = bytesOfHex('69c4e0d86a7b0430d8cdb78070b4c55a9e978e6d16b086570ef794ef97984232')
    const text = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    const utf8 = (value: string) => new TextEncoder().encode(value)

    expect(text(aesCbcDecrypt(key, new Uint8Array(16), block))).toBe('00112233445566778899aabbccddeeff')
    expect(text(pbkdf2Sha1(utf8('password'), utf8('salt'), 1, 20))).toBe('0c60c80f961f0e71f3a9b524af6012062fe037a6')
    expect(text(pbkdf2Sha1(utf8('password'), utf8('salt'), 2, 20))).toBe('ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957')
    expect(text(pbkdf2Sha1(utf8('password'), utf8('salt'), 4096, 20))).toBe('4b007901b765489abead49d926f721d065a429c1')
  })

  test('Firefox’s answer: the session, its expiry in seconds or in milliseconds', () => {
    expect(firefoxSessions(`${HEX}|2000000000\n`)).toEqual([{ value: SESSION, expiresAt: 2_000_000_000_000 }])
    expect(firefoxSessions(`${HEX}|2000000000000\n`)).toEqual([{ value: SESSION, expiresAt: 2_000_000_000_000 }])
    expect(firefoxSessions('\n')).toEqual([])
    expect(liveSession(firefoxSessions(`${HEX}|1000\n${HEX}|2000000000\n`), 1_900_000_000_000)?.expiresAt).toBe(2_000_000_000_000)
    expect(liveSession(firefoxSessions(`${HEX}|1000\n`), 1_900_000_000_000)).toBe(undefined)
  })

  test('Chrome’s answer: the cookie opened with the Keychain’s password, and not with another', () => {
    const [row] = chromeRows(`${SEALED}||13644473600000000\n`)

    expect(row?.expiresAt).toBe(2_000_000_000_000)
    expect(row === undefined ? '' : chromeValue(row, 'test-keychain-password')).toBe(SESSION)

    let other = 'unopened'

    try {
      other = row === undefined ? '' : chromeValue(row, 'another-password')
    } catch {
      other = ''
    }

    expect(other).toBe('')
    expect(chromeValue({ encrypted: new Uint8Array(), plain: SESSION, expiresAt: Number.NaN }, '')).toBe(SESSION)
  })

  test('the store is opened read-only, and past a lock only by a path that cannot be mistaken', () => {
    expect(sqliteArgv('/p/Application Support/x#1/cookies.sqlite', 'SELECT 1', false)).toEqual([
      'sqlite3',
      '-readonly',
      '-batch',
      '-noheader',
      '/p/Application Support/x#1/cookies.sqlite',
      'SELECT 1',
    ])
    expect(sqliteArgv('/p/Application Support/x#1?/cookies.sqlite', 'SELECT 1', true)[4]).toBe(
      'file:/p/Application%20Support/x%231%3F/cookies.sqlite?immutable=1',
    )
  })
})
