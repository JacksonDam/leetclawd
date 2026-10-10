import { aesCbcDecrypt, bytesOfHex, pbkdf2Sha1 } from './crypto'
import { cookieOf } from './leetcode'

/** A browser whose leetcode.com session the Account screen can take up. */
export type Browser = 'safari' | 'chrome' | 'firefox'

/** A session cookie found in a browser: its value, and when it lapses (NaN when the browser names no time). */
export type FoundSession = { value: string; expiresAt: number }

export const BROWSER_NAMES: Record<Browser, string> = { safari: 'Safari', chrome: 'Chrome', firefox: 'Firefox' }

const HOSTS = "('leetcode.com','.leetcode.com','www.leetcode.com')"

/** Chrome counts microseconds from 1601-01-01; this is the Unix epoch on that clock, in milliseconds. */
const CHROME_EPOCH_MS = 11_644_473_600_000

/** The one cookie asked of Firefox: nothing else of its store is read. */
export const FIREFOX_SQL = `SELECT hex(value), expiry FROM moz_cookies WHERE name='LEETCODE_SESSION' AND host IN ${HOSTS} ORDER BY expiry DESC`

/** The one cookie asked of Chrome, as it keeps it: encrypted, or plain in a store from before it encrypted. */
export const CHROME_SQL = `SELECT hex(encrypted_value), hex(value), expires_utc FROM cookies WHERE name='LEETCODE_SESSION' AND host_key IN ${HOSTS} ORDER BY expires_utc DESC`

/** How macOS is asked for the password Chrome encrypts its cookies under; the person allows or denies it. */
export const CHROME_KEY_ARGV = ['/usr/bin/security', 'find-generic-password', '-w', '-s', 'Chrome Safe Storage', '-a', 'Chrome']

/** The folders that may hold Firefox profiles under a home folder: macOS, then Linux. */
export const firefoxRoots = (home: string): string[] => [
  `${home}/Library/Application Support/Firefox/Profiles`,
  `${home}/.mozilla/firefox`,
  `${home}/snap/firefox/common/.mozilla/firefox`,
]

/** Where Chrome keeps its profiles under a home folder, on macOS. */
export const chromeRoot = (home: string): string => `${home}/Library/Application Support/Google/Chrome`

export const isChromeProfile = (name: string): boolean => name === 'Default' || /^Profile \d+$/.test(name)

/** Where a Chrome profile keeps its cookies: the newer place, then the older. */
export const chromeCookieFiles = (profile: string): string[] => [`${profile}/Network/Cookies`, `${profile}/Cookies`]

/**
 * The sqlite3 command that reads `sql` from a database, read-only: as it stands, or `immutable`, which
 * reads past a lock the browser holds while it runs (and past what it has not yet written down).
 */
export const sqliteArgv = (path: string, sql: string, isImmutable: boolean): string[] => [
  'sqlite3',
  '-readonly',
  '-batch',
  '-noheader',
  isImmutable ? `file:${encodeURI(path).replace(/[?#]/g, encodeURIComponent)}?immutable=1` : path,
  sql,
]

const rowsOf = (stdout: string): string[][] =>
  stdout
    .split('\n')
    .map(row => row.trim())
    .filter(row => row !== '')
    .map(row => row.split('|'))

const textOfHex = (hex: string): string => new TextDecoder().decode(bytesOfHex(hex))

/** What Firefox answered: each session with its expiry, which newer versions keep in milliseconds. */
export const firefoxSessions = (stdout: string): FoundSession[] =>
  rowsOf(stdout).flatMap(([hex = '', expiry = '']) => {
    const value = cookieOf(textOfHex(hex))
    const at = Number(expiry)

    return value === '' ? [] : [{ value, expiresAt: at > 1e11 ? at : at * 1000 }]
  })

/** One row of what Chrome answered: the cookie as encrypted, or as plain text, and when it lapses. */
export type ChromeRow = { encrypted: Uint8Array; plain: string; expiresAt: number }

export const chromeRows = (stdout: string): ChromeRow[] =>
  rowsOf(stdout).map(([encrypted = '', plain = '', expires = '']) => ({
    encrypted: bytesOfHex(encrypted),
    plain: textOfHex(plain),
    expiresAt: Number(expires) > 0 ? Number(expires) / 1000 - CHROME_EPOCH_MS : Number.NaN,
  }))

/** True for a row whose cookie only Chrome's own key opens. */
export const isEncrypted = (row: ChromeRow): boolean => row.plain === '' && row.encrypted.length > 3

/**
 * The cookie a Chrome row holds, opened with the password macOS keeps for Chrome: AES-128-CBC under a
 * key PBKDF2 derives from it, after the three bytes `v10`. Newer stores lead the value with a 32-byte
 * hash of the host, which is taken off where what follows it is the cookie.
 */
export const chromeValue = (row: ChromeRow, password: string): string => {
  if (!isEncrypted(row)) {
    return cookieOf(row.plain)
  }

  const marker = new TextDecoder().decode(row.encrypted.subarray(0, 3))

  if (marker !== 'v10') {
    throw new Error(`Chrome keeps this cookie in a form (${marker.replace(/[^\w]/g, '?')}) this cannot open.`)
  }

  const encoder = new TextEncoder()
  const key = pbkdf2Sha1(encoder.encode(password), encoder.encode('saltysalt'), 1003, 16)
  const opened = aesCbcDecrypt(key, new Uint8Array(16).fill(0x20), row.encrypted.subarray(3))
  // Whole first: a value led by the hash is no cookie as it stands, its 32 bytes being any bytes at all.
  const candidates = [opened, opened.subarray(32)].map(bytes => cookieOf(new TextDecoder().decode(bytes)))

  return candidates.find(value => value !== '') ?? ''
}

/** Of the sessions found, the one that lapses last and has not lapsed yet. */
export const liveSession = (found: readonly FoundSession[], now: number): FoundSession | undefined =>
  found
    .filter(session => session.value !== '' && !(session.expiresAt <= now))
    .sort((a, b) => (Number.isNaN(b.expiresAt) ? 0 : b.expiresAt) - (Number.isNaN(a.expiresAt) ? 0 : a.expiresAt))[0]
