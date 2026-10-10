/** A cookie to write into a Cookies.binarycookies file made for a test. */
export type Baked = { domain: string; name: string; value: string; expiresAt: number; path?: string }

const MAC_EPOCH_MS = 978_307_200_000

const cookieBytes = (cookie: Baked): Uint8Array => {
  const encoder = new TextEncoder()
  const texts = [cookie.domain, cookie.name, cookie.path ?? '/', cookie.value].map(text => encoder.encode(`${text}\0`))
  const size = 56 + texts.reduce((total, text) => total + text.length, 0)
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  let at = 56

  view.setUint32(0, size, true)
  view.setUint32(8, 5, true)
  texts.forEach((text, index) => {
    view.setUint32(16 + 4 * index, at, true)
    bytes.set(text, at)
    at += text.length
  })
  view.setFloat64(40, (cookie.expiresAt - MAC_EPOCH_MS) / 1000, true)
  view.setFloat64(48, 0, true)

  return bytes
}

const pageBytes = (cookies: readonly Baked[]): Uint8Array => {
  const records = cookies.map(cookieBytes)
  const header = 8 + 4 * records.length + 4
  const bytes = new Uint8Array(header + records.reduce((total, record) => total + record.length, 0))
  const view = new DataView(bytes.buffer)
  let at = header

  view.setUint32(0, 0x00000100, false)
  view.setUint32(4, records.length, true)
  records.forEach((record, index) => {
    view.setUint32(8 + 4 * index, at, true)
    bytes.set(record, at)
    at += record.length
  })

  return bytes
}

/** A Cookies.binarycookies file as Safari writes one, a page for each list of cookies. */
export const cookieFile = (pages: readonly (readonly Baked[])[]): Uint8Array => {
  const built = pages.map(pageBytes)
  const bytes = new Uint8Array(8 + 4 * built.length + built.reduce((total, page) => total + page.length, 0) + 8)
  const view = new DataView(bytes.buffer)
  let at = 8 + 4 * built.length

  bytes.set(new TextEncoder().encode('cook'), 0)
  view.setUint32(4, built.length, false)
  built.forEach((page, index) => {
    view.setUint32(8 + 4 * index, page.length, false)
    bytes.set(page, at)
    at += page.length
  })

  return bytes
}

export const base64Of = (bytes: Uint8Array): string => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
