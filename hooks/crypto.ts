// What reading Chrome's cookies takes, and the hooks environment does not have: AES-CBC, SHA-1 and
// PBKDF2, written out here and checked against OpenSSL.

const SBOX = new Uint8Array(256)
const INVERSE = new Uint8Array(256)

const rotl8 = (value: number, shift: number): number => ((value << shift) | (value >> (8 - shift))) & 0xff

// The AES S-box, computed as the standard defines it: the inverse in GF(2^8), then the affine map.
for (let p = 1, q = 1, isFirst = true; isFirst || p !== 1; isFirst = false) {
  p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff
  q ^= q << 1
  q ^= q << 2
  q ^= q << 4
  q &= 0xff
  q ^= q & 0x80 ? 0x09 : 0

  const mapped = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff

  SBOX[p] = mapped
  INVERSE[mapped] = p
}

SBOX[0] = 0x63
INVERSE[0x63] = 0

const at = (bytes: Uint8Array, index: number): number => bytes[index] ?? 0

/** Multiplication in GF(2^8), the field AES mixes columns in. */
const multiply = (a: number, b: number): number => {
  let product = 0

  for (let x = a, y = b; y > 0; y >>= 1) {
    product ^= y & 1 ? x : 0
    x = ((x << 1) ^ (x & 0x80 ? 0x11b : 0)) & 0xff
  }

  return product
}

/** The eleven round keys of AES-128, 176 bytes in all. */
const expandKey = (key: Uint8Array): Uint8Array => {
  const round = new Uint8Array(176)

  round.set(key.subarray(0, 16))

  for (let index = 16, rcon = 1; index < 176; index += 4) {
    let word = [at(round, index - 4), at(round, index - 3), at(round, index - 2), at(round, index - 1)]

    if (index % 16 === 0) {
      word = [at(SBOX, word[1] ?? 0) ^ rcon, at(SBOX, word[2] ?? 0), at(SBOX, word[3] ?? 0), at(SBOX, word[0] ?? 0)]
      rcon = multiply(rcon, 2)
    }

    word.forEach((byte, offset) => {
      round[index + offset] = at(round, index - 16 + offset) ^ byte
    })
  }

  return round
}

const decryptBlock = (round: Uint8Array, block: Uint8Array): Uint8Array => {
  let state = block.map((byte, index) => byte ^ at(round, 160 + index))

  for (let step = 9; step >= 0; step -= 1) {
    const shifted = new Uint8Array(16)

    // InvShiftRows and InvSubBytes: row r moves r columns to the right
    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        shifted[4 * ((column + row) % 4) + row] = at(INVERSE, at(state, 4 * column + row))
      }
    }

    state = shifted.map((byte, index) => byte ^ at(round, 16 * step + index))

    if (step > 0) {
      const mixed = new Uint8Array(16)

      for (let column = 0; column < 4; column += 1) {
        const [a, b, c, d] = [0, 1, 2, 3].map(row => at(state, 4 * column + row)) as [number, number, number, number]

        mixed[4 * column] = multiply(a, 14) ^ multiply(b, 11) ^ multiply(c, 13) ^ multiply(d, 9)
        mixed[4 * column + 1] = multiply(a, 9) ^ multiply(b, 14) ^ multiply(c, 11) ^ multiply(d, 13)
        mixed[4 * column + 2] = multiply(a, 13) ^ multiply(b, 9) ^ multiply(c, 14) ^ multiply(d, 11)
        mixed[4 * column + 3] = multiply(a, 11) ^ multiply(b, 13) ^ multiply(c, 9) ^ multiply(d, 14)
      }

      state = mixed
    }
  }

  return state
}

/** Decrypts AES-128-CBC and takes its PKCS#7 padding off; throws when key and data do not belong together. */
export const aesCbcDecrypt = (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array => {
  if (key.length !== 16 || iv.length !== 16 || data.length === 0 || data.length % 16 !== 0) {
    throw new Error('Not AES-128-CBC data.')
  }

  const round = expandKey(key)
  const out = new Uint8Array(data.length)

  for (let start = 0; start < data.length; start += 16) {
    const plain = decryptBlock(round, data.subarray(start, start + 16))

    plain.forEach((byte, index) => {
      out[start + index] = byte ^ (start === 0 ? at(iv, index) : at(data, start - 16 + index))
    })
  }

  const padding = at(out, out.length - 1)
  const isPadded = padding >= 1 && padding <= 16 && out.subarray(out.length - padding).every(byte => byte === padding)

  if (!isPadded) {
    throw new Error('The key does not open this data.')
  }

  return out.subarray(0, out.length - padding)
}

const join = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length)

  out.set(a)
  out.set(b, a.length)

  return out
}

/** SHA-1, as FIPS 180 gives it: here because PBKDF2 calls it some two thousand times, and at once. */
export const sha1 = (bytes: Uint8Array): Uint8Array => {
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6)
  const view = new DataView(padded.buffer)
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const words = new Int32Array(80)
  const rotl = (value: number, shift: number): number => (value << shift) | (value >>> (32 - shift))

  padded.set(bytes)
  padded[bytes.length] = 0x80
  view.setUint32(padded.length - 8, Math.floor(bytes.length / 0x20000000), false)
  view.setUint32(padded.length - 4, (bytes.length << 3) >>> 0, false)

  for (let start = 0; start < padded.length; start += 64) {
    let [a, b, c, d, e] = state as [number, number, number, number, number]

    for (let index = 0; index < 80; index += 1) {
      words[index] =
        index < 16
          ? view.getInt32(start + 4 * index, false)
          : rotl((words[index - 3] ?? 0) ^ (words[index - 8] ?? 0) ^ (words[index - 14] ?? 0) ^ (words[index - 16] ?? 0), 1)

      const [mixed, constant] =
        index < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : index < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : index < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6]
      const next = (rotl(a, 5) + mixed + e + constant + (words[index] ?? 0)) | 0

      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = next
    }

    ;[a, b, c, d, e].forEach((value, index) => {
      state[index] = ((state[index] ?? 0) + value) | 0
    })
  }

  const digest = new Uint8Array(20)

  state.forEach((value, index) => new DataView(digest.buffer).setInt32(4 * index, value, false))

  return digest
}

/** PBKDF2 with HMAC-SHA1, for a key of at most twenty bytes (one block of the function). */
export const pbkdf2Sha1 = (password: Uint8Array, salt: Uint8Array, iterations: number, length: number): Uint8Array => {
  const secret = password.length > 64 ? sha1(password) : password
  const inner = new Uint8Array(64).fill(0x36)
  const outer = new Uint8Array(64).fill(0x5c)

  secret.forEach((byte, index) => {
    inner[index] = byte ^ 0x36
    outer[index] = byte ^ 0x5c
  })

  const hmac = (message: Uint8Array) => sha1(join(outer, sha1(join(inner, message))))
  let block = hmac(join(salt, new Uint8Array([0, 0, 0, 1])))
  const key = block.slice()

  for (let round = 1; round < iterations; round += 1) {
    block = hmac(block)
    block.forEach((byte, index) => {
      key[index] = at(key, index) ^ byte
    })
  }

  return key.subarray(0, Math.min(length, key.length))
}

/** The bytes a text of hexadecimal digits stands for. */
export const bytesOfHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/[0-9a-fA-F]{2}/g) ?? [], pair => Number.parseInt(pair, 16))
