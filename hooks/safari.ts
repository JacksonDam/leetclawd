/** One cookie as Safari keeps it in Cookies.binarycookies. */
export type SafariCookie = {
  domain: string
  name: string
  path: string
  value: string
  /** When it lapses, in milliseconds since the Unix epoch. */
  expiresAt: number
}

/** Safari counts seconds from 2001-01-01; this is that moment in Unix milliseconds. */
const MAC_EPOCH_MS = 978_307_200_000
const COOKIE_HEADER = 56

/** Where Safari keeps its cookies under a home folder: the app's container, then the place older versions used. */
export const cookieFiles = (home: string): string[] => [
  `${home}/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies`,
  `${home}/Library/Cookies/Cookies.binarycookies`,
]

/** The bytes a base64 text stands for. */
export const bytesOf = (base64: string): Uint8Array => Uint8Array.from(atob(base64), char => char.charCodeAt(0))

const textAt = (bytes: Uint8Array, start: number, limit: number): string => {
  let end = start

  while (end < limit && bytes[end] !== 0) {
    end += 1
  }

  return new TextDecoder().decode(bytes.subarray(start, end))
}

/**
 * Reads a Cookies.binarycookies file: the magic `cook`, a count of pages and their sizes (big-endian),
 * then each page's own table of cookie offsets and its cookies (little-endian). A page or a cookie
 * that runs past its bounds is left out, so a file cut short still gives what it holds.
 */
export const readCookies = (bytes: Uint8Array): SafariCookie[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (bytes.length < 8 || textAt(bytes, 0, 4) !== 'cook') {
    throw new Error('That is not a Safari cookie file.')
  }

  const pageCount = view.getUint32(4, false)
  const cookies: SafariCookie[] = []
  let pageStart = 8 + 4 * pageCount

  for (let page = 0; page < pageCount && 8 + 4 * page + 4 <= bytes.length; page += 1) {
    const pageEnd = pageStart + view.getUint32(8 + 4 * page, false)

    if (pageEnd > bytes.length || pageStart + 8 > pageEnd) {
      break
    }

    const count = view.getUint32(pageStart + 4, true)

    for (let index = 0; index < count && pageStart + 12 + 4 * index <= pageEnd; index += 1) {
      const at = pageStart + view.getUint32(pageStart + 8 + 4 * index, true)

      if (at + COOKIE_HEADER > pageEnd) {
        continue
      }

      const end = Math.min(pageEnd, at + view.getUint32(at, true))
      const field = (offset: number): string => {
        const start = at + view.getUint32(at + offset, true)

        return start >= at + COOKIE_HEADER && start < end ? textAt(bytes, start, end) : ''
      }

      cookies.push({
        domain: field(16),
        name: field(20),
        path: field(24),
        value: field(28),
        expiresAt: MAC_EPOCH_MS + view.getFloat64(at + 40, true) * 1000,
      })
    }

    pageStart = pageEnd
  }

  return cookies
}

/** The leetcode.com session among Safari's cookies that lapses last, or undefined when none is live. */
export const leetcodeSession = (cookies: readonly SafariCookie[], now: number): SafariCookie | undefined =>
  cookies
    .filter(
      cookie =>
        cookie.name === 'LEETCODE_SESSION' &&
        cookie.value !== '' &&
        /^\.?(www\.)?leetcode\.com$/.test(cookie.domain) &&
        !(cookie.expiresAt <= now),
    )
    .sort((a, b) => b.expiresAt - a.expiresAt)[0]
