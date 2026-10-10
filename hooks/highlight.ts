import type { Line, Span } from '../types'

type Grammar = { words: Set<string>; comments: string[]; quotes: string; isCaseless?: boolean }

const grammar = (words: string, comments: string[], quotes = '"\''): Grammar => ({
  words: new Set(words.split(' ')),
  comments,
  quotes,
})

const PYTHON = grammar(
  'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self',
  ['#'],
)

const C_FAMILY =
  'auto bool break case catch char class const continue default delete do double else enum explicit extern false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while'

const JAVA =
  'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws true false try var void volatile while'

const SCRIPT =
  'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof interface let new null of return static super switch this throw true try type typeof undefined var void while yield number string boolean any'

const GRAMMARS: Record<string, Grammar> = {
  python: PYTHON,
  python3: PYTHON,
  pythondata: PYTHON,
  cpp: grammar(`${C_FAMILY} vector string map set unordered_map unordered_set pair`, ['//']),
  c: grammar(C_FAMILY, ['//']),
  java: grammar(JAVA, ['//']),
  csharp: grammar(`${JAVA} bool string var foreach in out ref namespace using override virtual`, ['//']),
  kotlin: grammar(`${JAVA} fun val when in is object companion override data open it`, ['//']),
  scala: grammar(`${JAVA} def val object trait match case with yield override`, ['//']),
  dart: grammar(`${JAVA} late required dynamic bool String List Map Set`, ['//']),
  javascript: grammar(SCRIPT, ['//'], '"\'`'),
  typescript: grammar(SCRIPT, ['//'], '"\'`'),
  golang: grammar(
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false int string bool byte rune error',
    ['//'],
    '"`',
  ),
  rust: grammar(
    'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    ['//'],
    '"',
  ),
  swift: grammar(
    'break case catch class continue default defer do else enum extension false for func guard if import in init inout let nil private protocol public return self static struct switch throw true try var where while',
    ['//'],
    '"',
  ),
  ruby: grammar(
    'alias and begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true unless until when while yield',
    ['#'],
  ),
  php: grammar(
    'abstract array as break case catch class const continue default do echo else elseif extends false final finally for foreach function if implements interface new null private protected public return static switch this throw true try var while',
    ['//', '#'],
  ),
  elixir: grammar('def defp defmodule do end fn if else case cond when true false nil', ['#'], '"'),
  erlang: grammar('case of end fun if when receive after true false', ['%'], '"'),
  racket: grammar('define lambda let if cond else', [';'], '"'),
  bash: grammar('if then else elif fi for in do done while case esac function return', ['#']),
}

const SQL: Grammar = {
  ...grammar(
    'select from where group by order having join left right inner outer on as and or not null is in distinct limit offset union all insert into values update set delete create table with case when then else end count sum avg min max over partition',
    ['--', '#'],
  ),
  isCaseless: true,
}

const grammarOf = (lang: string): Grammar | undefined =>
  /sql/.test(lang) ? SQL : GRAMMARS[lang]

const WORD = /[A-Za-z_][A-Za-z0-9_]*/y
const NUMBER = /\d[\dA-Fa-fxXobOB_.]*/y

/** One row of source as coloured spans; rows are read one at a time, so a block comment is not followed. */
export const tokenize = (line: string, lang: string): Line => {
  const rules = grammarOf(lang)

  if (rules === undefined || line === '') {
    return line === '' ? [] : [{ text: line }]
  }

  const out: Line = []
  let plain = ''

  const push = (span: Span) => {
    if (plain !== '') {
      out.push({ text: plain })
      plain = ''
    }

    out.push(span)
  }

  let at = 0

  while (at < line.length) {
    const char = line[at] as string

    if (rules.comments.some(mark => line.startsWith(mark, at))) {
      push({ text: line.slice(at), dim: true })
      at = line.length
      break
    }

    if (rules.quotes.includes(char)) {
      let end = at + 1

      while (end < line.length && line[end] !== char) {
        end += line[end] === '\\' ? 2 : 1
      }

      end = Math.min(line.length, end + 1)
      push({ text: line.slice(at, end), color: 'success' })
      at = end
      continue
    }

    WORD.lastIndex = at
    const word = WORD.exec(line)?.[0]

    if (word !== undefined) {
      const isKeyword = rules.words.has(rules.isCaseless === true ? word.toLowerCase() : word)

      if (isKeyword) {
        push({ text: word, color: 'suggestion' })
      } else {
        plain += word
      }

      at += word.length
      continue
    }

    NUMBER.lastIndex = at
    const number = NUMBER.exec(line)?.[0]

    if (number !== undefined) {
      push({ text: number, color: 'warning' })
      at += number.length
      continue
    }

    plain += char
    at += 1
  }

  if (plain !== '') {
    out.push({ text: plain })
  }

  return out
}
