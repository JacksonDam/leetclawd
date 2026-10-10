import type { Problem, ProblemSummary, Snippet, Tone, Verdict, VerdictSection } from '../types'

import { clean, oneLine, truncate } from './text'

export const ORIGIN = 'https://leetcode.com'

/** The cookies a signed-in request carries. */
export type Auth = { session: string; csrf: string }

export type Request = {
  url: string
  init: { method: string; headers: Record<string, string>; body?: string }
}

export type Reply = { status: number; text: string; headers: Record<string, string> }

export type Filters = { search: string; difficulty: string; skip: number; limit: number }

type Json = Record<string, unknown>

const LIST_QUERY =
  'query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) { problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) { total: totalNum questions: data { acRate difficulty frontendQuestionId: questionFrontendId paidOnly: isPaidOnly status title titleSlug } } }'

const QUESTION_QUERY =
  'query question($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug difficulty isPaidOnly content exampleTestcases sampleTestCase metaData codeSnippets { lang langSlug code } topicTags { name } } }'

const DAILY_QUERY = 'query daily { activeDailyCodingChallengeQuestion { question { titleSlug } } }'

const RANDOM_QUERY =
  'query randomQuestion($categorySlug: String, $filters: QuestionListFilterInput) { randomQuestion(categorySlug: $categorySlug, filters: $filters) { titleSlug } }'

const USER_QUERY = 'query user { userStatus { isSignedIn username } }'

const STATUS: Record<number, string> = {
  10: 'Accepted',
  11: 'Wrong Answer',
  12: 'Memory Limit Exceeded',
  13: 'Output Limit Exceeded',
  14: 'Time Limit Exceeded',
  15: 'Runtime Error',
  16: 'Internal Error',
  20: 'Compile Error',
}

const LONGEST = 4000
const MOST_CASES = 8

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

/** A judge field that is a string in one answer and a list of rows in another. */
const rows = (value: unknown): string =>
  Array.isArray(value) ? value.map(text).join('\n') : text(value)

const shown = (value: string): string => truncate(clean(value).trimEnd(), LONGEST)

const headers = (auth: Auth | null, referer: string): Record<string, string> => ({
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (leetclawd; Claude Code mod)',
  Origin: ORIGIN,
  Referer: referer,
  ...(auth === null
    ? {}
    : {
        'x-csrftoken': auth.csrf,
        Cookie: `LEETCODE_SESSION=${auth.session}; csrftoken=${auth.csrf}`,
      }),
})

const graphql = (query: string, variables: Json, auth: Auth | null): Request => ({
  url: `${ORIGIN}/graphql`,
  init: {
    method: 'POST',
    headers: headers(auth, `${ORIGIN}/problemset/`),
    body: JSON.stringify({ query, variables }),
  },
})

export const listRequest = (filters: Filters, auth: Auth | null): Request =>
  graphql(
    LIST_QUERY,
    {
      categorySlug: '',
      skip: filters.skip,
      limit: filters.limit,
      filters: {
        ...(filters.difficulty === '' ? {} : { difficulty: filters.difficulty }),
        ...(filters.search.trim() === '' ? {} : { searchKeywords: filters.search.trim() }),
      },
    },
    auth,
  )

export const questionRequest = (slug: string, auth: Auth | null): Request =>
  graphql(QUESTION_QUERY, { titleSlug: slug }, auth)

export const dailyRequest = (auth: Auth | null): Request => graphql(DAILY_QUERY, {}, auth)

export const randomRequest = (difficulty: string, auth: Auth | null): Request =>
  graphql(
    RANDOM_QUERY,
    { categorySlug: '', filters: difficulty === '' ? {} : { difficulty } },
    auth,
  )

export const userRequest = (auth: Auth | null): Request => graphql(USER_QUERY, {}, auth)

/** A request with no cookie of its own, whose reply hands out a CSRF token. */
export const csrfRequest = (): Request => graphql(USER_QUERY, {}, null)

/** The LEETCODE_SESSION value in what a person pasted, or '' when it holds none. */
export const cookieOf = (pasted: string): string => {
  const trimmed = pasted.trim()
  const named = /LEETCODE_SESSION=([^;\s]+)/.exec(trimmed)?.[1] ?? trimmed
  const value = named.replace(/^["']+|["';]+$/g, '')

  return /^[A-Za-z0-9._~+/=%-]{20,}$/.test(value) ? value : ''
}

const problemUrl = (slug: string): string => `${ORIGIN}/problems/${slug}/`

export const runRequest = (problem: Problem, lang: string, code: string, auth: Auth): Request => ({
  url: `${problemUrl(problem.slug)}interpret_solution/`,
  init: {
    method: 'POST',
    headers: headers(auth, problemUrl(problem.slug)),
    body: JSON.stringify({
      lang,
      question_id: problem.questionId,
      typed_code: code,
      data_input: problem.testcases,
    }),
  },
})

export const submitRequest = (problem: Problem, lang: string, code: string, auth: Auth): Request => ({
  url: `${problemUrl(problem.slug)}submit/`,
  init: {
    method: 'POST',
    headers: headers(auth, problemUrl(problem.slug)),
    body: JSON.stringify({ lang, question_id: problem.questionId, typed_code: code }),
  },
})

export const checkRequest = (id: string, slug: string, auth: Auth): Request => ({
  url: `${ORIGIN}/submissions/detail/${encodeURIComponent(id)}/check/`,
  init: { method: 'GET', headers: headers(auth, problemUrl(slug)) },
})

/** The JSON a reply carries, or an error a person can act on. */
export const readJson = (reply: Reply): Json => {
  let parsed: unknown

  try {
    parsed = JSON.parse(reply.text)
  } catch {
    if (reply.text.includes('Just a moment')) {
      throw new Error('LeetCode asked for a browser check (Cloudflare). Sign in on the Account screen, or try again later.')
    }

    if (reply.status === 429) {
      throw new Error('LeetCode is rate limiting requests. Wait a little and try again.')
    }

    throw new Error(
      reply.status === 401 || reply.status === 403
        ? 'LeetCode refused the request: your session may have expired. Sign in again on the Account screen.'
        : `LeetCode answered HTTP ${reply.status}.`,
    )
  }

  if (!isObject(parsed)) {
    throw new Error(`LeetCode answered HTTP ${reply.status} with no data.`)
  }

  const refusal = text(parsed.error) || text((list(parsed.errors)[0] as Json | undefined)?.message)

  if (refusal !== '') {
    throw new Error(
      /not authenticated|login|sign in/i.test(refusal)
        ? 'LeetCode says you are not signed in: your session cookie is missing or expired. Sign in on the Account screen.'
        : `LeetCode: ${oneLine(refusal)}`,
    )
  }

  return parsed
}

const dataOf = (reply: Reply): Json => {
  const data = readJson(reply).data

  if (!isObject(data)) {
    throw new Error('LeetCode answered with no data.')
  }

  return data
}

export const parseList = (reply: Reply): { total: number; items: ProblemSummary[] } => {
  const page = dataOf(reply).problemsetQuestionList

  if (!isObject(page)) {
    throw new Error('LeetCode answered with no problem list.')
  }

  return {
    total: Number(page.total) || 0,
    items: list(page.questions)
      .filter(isObject)
      .map(question => ({
        id: oneLine(text(question.frontendQuestionId)),
        title: oneLine(text(question.title)),
        slug: text(question.titleSlug),
        difficulty: oneLine(text(question.difficulty)),
        acRate: Number(question.acRate) || 0,
        isPaidOnly: question.paidOnly === true,
        status: text(question.status),
      }))
      .filter(item => /^[a-z0-9-]+$/.test(item.slug)),
  }
}

const paramsOf = (metaData: string): { count: number; names: string[] } => {
  try {
    const meta: unknown = JSON.parse(metaData)

    if (isObject(meta)) {
      const names = list(meta.params)
        .filter(isObject)
        .map(param => oneLine(text(param.name)))

      if (names.length > 0) {
        return { count: names.length, names }
      }

      if (text(meta.classname) !== '') {
        return { count: 2, names: ['calls', 'arguments'] }
      }
    }
  } catch {
    // a statement with no machine-readable signature (SQL, shell): one row a case
  }

  return { count: 1, names: [] }
}

export const parseQuestion = (reply: Reply): Problem => {
  const question = dataOf(reply).question

  if (!isObject(question)) {
    throw new Error('LeetCode has no such problem.')
  }

  if (!/^[a-z0-9-]+$/.test(text(question.titleSlug))) {
    throw new Error('LeetCode answered with a problem it did not name.')
  }

  const params = paramsOf(text(question.metaData))
  const snippets: Snippet[] = list(question.codeSnippets)
    .filter(isObject)
    .map(snippet => ({
      lang: oneLine(text(snippet.lang)),
      langSlug: text(snippet.langSlug),
      code: clean(text(snippet.code)),
    }))
    .filter(snippet => /^[a-z0-9]+$/.test(snippet.langSlug))

  return {
    questionId: text(question.questionId),
    id: oneLine(text(question.questionFrontendId)),
    title: oneLine(text(question.title)),
    slug: text(question.titleSlug),
    difficulty: oneLine(text(question.difficulty)),
    isPaidOnly: question.isPaidOnly === true,
    content: text(question.content),
    testcases: text(question.exampleTestcases) || text(question.sampleTestCase),
    paramCount: params.count,
    paramNames: params.names,
    snippets,
    topics: list(question.topicTags)
      .filter(isObject)
      .map(tag => oneLine(text(tag.name))),
  }
}

export const parseDaily = (reply: Reply): string => {
  const daily = dataOf(reply).activeDailyCodingChallengeQuestion
  const slug = isObject(daily) && isObject(daily.question) ? text(daily.question.titleSlug) : ''

  if (slug === '') {
    throw new Error('LeetCode named no daily problem.')
  }

  return slug
}

export const parseRandom = (reply: Reply): string => {
  const random = dataOf(reply).randomQuestion
  const slug = isObject(random) ? text(random.titleSlug) : ''

  if (slug === '') {
    throw new Error('LeetCode named no random problem.')
  }

  return slug
}

export const parseUser = (reply: Reply): { isSignedIn: boolean; username: string } => {
  const user = dataOf(reply).userStatus

  return isObject(user)
    ? { isSignedIn: user.isSignedIn === true, username: oneLine(text(user.username)) }
    : { isSignedIn: false, username: '' }
}

/** The CSRF token a reply's Set-Cookie header hands out, or '' when it hands none. */
export const parseCsrf = (reply: Reply): string =>
  /csrftoken=([A-Za-z0-9]+)/.exec(reply.headers['set-cookie'] ?? '')?.[1] ?? ''

/** The id LeetCode gave a run or a submission, to ask its verdict by. */
export const parseStarted = (reply: Reply): string => {
  const started = readJson(reply)
  const id = text(started.interpret_id) || text(started.submission_id)

  if (id === '') {
    throw new Error('LeetCode did not start the judge.')
  }

  return id
}

/** The example inputs of a problem, one string a case. */
export const casesOf = (problem: Problem | null): string[] => {
  if (problem === null || problem.testcases.trim() === '') {
    return []
  }

  const lines = clean(problem.testcases).split('\n')
  const cases: string[] = []

  for (let start = 0; start < lines.length; start += problem.paramCount) {
    const values = lines.slice(start, start + problem.paramCount)

    cases.push(
      values
        .map((value, index) => {
          const name = problem.paramNames[index]

          return name === undefined ? value : `${name} = ${value}`
        })
        .join(', '),
    )
  }

  return cases
}

const section = (label: string, body: string, tone: Tone = 'plain'): VerdictSection[] =>
  body.trim() === '' ? [] : [{ label, text: shown(body), tone }]

const percent = (value: unknown): string =>
  typeof value === 'number' && Number.isFinite(value) ? ` (beats ${value.toFixed(1)}%)` : ''

const runVerdict = (check: Json, problem: Problem | null): Verdict => {
  const answers = list(check.code_answer).map(text)
  const expected = list(check.expected_code_answer).map(text)
  const stdout = list(check.std_output_list).map(text)
  const compared = text(check.compare_result)
  const inputs = casesOf(problem)
  const total = Number(check.total_testcases) || inputs.length || compared.length
  const passes = Array.from({ length: total }, (_, index) =>
    compared === '' ? answers[index] === expected[index] : compared[index] === '1',
  )
  const passed = passes.filter(Boolean).length
  const isCorrect = total > 0 ? passed === total : check.correct_answer === true
  const runtime = text(check.status_runtime)

  return {
    tone: isCorrect ? 'ok' : 'bad',
    headline: isCorrect ? 'Accepted' : 'Wrong Answer',
    detail: `${passed}/${total} example cases passed${runtime === '' ? '' : ` · ${runtime}`}`,
    sections: passes.slice(0, MOST_CASES).map((isPass, index) => ({
      label: `Case ${index + 1}: ${isPass ? 'passed' : 'failed'}`,
      tone: isPass ? ('ok' as const) : ('bad' as const),
      text: shown(
        [
          inputs[index] === undefined ? '' : `Input:    ${inputs[index]}`,
          `Output:   ${answers[index] ?? ''}`,
          `Expected: ${expected[index] ?? ''}`,
          (stdout[index] ?? '').trim() === '' ? '' : `Stdout:   ${(stdout[index] ?? '').trimEnd()}`,
        ]
          .filter(row => row !== '')
          .join('\n'),
      ),
    })),
  }
}

/** What a finished judge answer says, for the result panel. */
export const verdictOf = (kind: 'run' | 'submit', check: Json, problem: Problem | null): Verdict => {
  const code = Number(check.status_code)
  const message = oneLine(text(check.status_msg)) || STATUS[code] || 'Finished'
  const progress =
    Number(check.total_testcases) > 0
      ? `${Number(check.total_correct) || 0}/${Number(check.total_testcases)} testcases passed`
      : ''
  const lastCase = [
    ...section('Last testcase', rows(check.input_formatted) || rows(check.last_testcase)),
    ...section('Output', rows(check.code_output)),
    ...section('Expected', rows(check.expected_output)),
    ...section('Stdout', rows(check.std_output) || rows(check.std_output_list)),
  ]

  if (code === 20) {
    return {
      tone: 'bad',
      headline: 'Compile Error',
      detail: '',
      sections: section('Compiler', text(check.full_compile_error) || text(check.compile_error), 'bad'),
    }
  }

  if (code === 15) {
    return {
      tone: 'bad',
      headline: 'Runtime Error',
      detail: kind === 'submit' ? progress : '',
      sections: [
        ...section('Error', text(check.full_runtime_error) || text(check.runtime_error), 'bad'),
        ...lastCase.filter(part => part.label !== 'Output'),
      ],
    }
  }

  if (code !== 10) {
    return { tone: code === 14 || code === 12 ? 'warn' : 'bad', headline: message, detail: progress, sections: lastCase }
  }

  if (kind === 'run') {
    return runVerdict(check, problem)
  }

  const runtime = text(check.status_runtime)
  const memory = text(check.status_memory)

  return {
    tone: 'ok',
    headline: 'Accepted',
    detail: [
      progress,
      runtime === '' ? '' : `Runtime ${runtime}${percent(check.runtime_percentile)}`,
      memory === '' ? '' : `Memory ${memory}${percent(check.memory_percentile)}`,
    ]
      .filter(part => part !== '')
      .join(' · '),
    sections: [],
  }
}

/** A judge poll: still working, or done with its verdict. */
export const parseCheck = (
  kind: 'run' | 'submit',
  reply: Reply,
  problem: Problem | null,
): { isDone: false } | { isDone: true; verdict: Verdict } => {
  const check = readJson(reply)
  const state = text(check.state)

  return state === 'SUCCESS' || state === 'FAILURE'
    ? { isDone: true, verdict: verdictOf(kind, check, problem) }
    : { isDone: false }
}

export const draftKey = (slug: string, lang: string): string => `${slug}/${lang}`

const MARKER = /^\[leetclawd ([a-z0-9-]+) ([a-z0-9]+)\][^\n]*(?:\n|$)([\s\S]*)$/

/** A solution as it sits in the prompt box: a first line that names it, then the code. */
export const toPrompt = (slug: string, lang: string, code: string): string =>
  `[leetclawd ${slug} ${lang}] Enter saves this to LeetClawd, not Claude. Keep this line.\n${code}`

export const fromPrompt = (prompt: string): { slug: string; lang: string; code: string } | null => {
  const match = MARKER.exec(prompt.trimStart())

  return match === null
    ? null
    : { slug: match[1] as string, lang: match[2] as string, code: clean(match[3] as string).trimEnd() }
}

/** The starting code of a problem in a language, or '' when it has none. */
export const snippetOf = (problem: Problem, lang: string): string =>
  problem.snippets.find(snippet => snippet.langSlug === lang)?.code ?? ''

/** The language a problem opens in: the wanted one where it has it, else its first. */
export const langFor = (problem: Problem, wanted: string): string =>
  problem.snippets.some(snippet => snippet.langSlug === wanted)
    ? wanted
    : (problem.snippets[0]?.langSlug ?? wanted)
