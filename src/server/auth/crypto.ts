import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

/**
 * Token hashing and symmetric encryption for values that must be stored.
 *
 * Two distinct jobs, deliberately kept in one place because they are the two
 * halves of "how do I keep a credential":
 *
 *   - `hashToken` for values we *verify* (session cookies, API keys, OAuth
 *     state). A digest is enough because the input is 256 bits of entropy we
 *     generated, so there is nothing for an attacker to brute-force and a slow
 *     hash would only add latency to every authenticated request.
 *   - `encryptToken` for values we must be able to *use again* (Google OAuth
 *     access/refresh tokens). Those cannot be hashed, so they are encrypted with
 *     AES-256-GCM under a key that lives in the environment, not the database.
 */

const KEY_BYTES = 32
const IV_BYTES = 12
const ALGORITHM = 'aes-256-gcm'

/** 32 bytes of entropy, URL-safe. Session cookies, API keys, OAuth state. */
export function randomToken(bytes = KEY_BYTES): string {
  return randomBytes(bytes).toString('base64url')
}

/** SHA-256 of a token, hex encoded. Safe to store and to index. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Constant-time string comparison, for checking a presented secret against a
 * stored digest. `===` short-circuits and leaks how many leading characters
 * matched via response timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * The 32-byte encryption key.
 *
 * Read lazily, per call, so a process that never touches an OAuth token - the
 * public extraction path, most tests - does not require the variable to exist.
 *
 * The env var is documented as base64. A raw passphrase is also accepted by
 * hashing it, because silently treating a passphrase as base64 would give an
 * operator a key that is not the one they think it is.
 */
function encryptionKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY
  if (secret === undefined || secret.trim() === '') {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    )
  }

  const trimmed = secret.trim()
  const decoded = Buffer.from(trimmed, 'base64')
  if (decoded.length === KEY_BYTES) return decoded
  return createHash('sha256').update(trimmed, 'utf8').digest()
}

/**
 * Encrypts a token for storage as `v1.<iv>.<tag>.<ciphertext>`.
 *
 * GCM gives us integrity as well as confidentiality, so a modified ciphertext
 * fails to decrypt rather than yielding attacker-chosen plaintext.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * Decrypts a stored token, or returns null if it cannot be read.
 *
 * Null covers every "cannot be trusted" case: wrong key, truncated value, tampered
 * ciphertext, a future format version. The only correct response to any of them
 * is to treat the grant as absent and ask the user to connect Google again, which
 * is what every caller does.
 */
export function decryptToken(value: string | null | undefined): string | null {
  if (!value) return null

  const [version, iv, tag, data] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !data) return null

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      encryptionKey(),
      Buffer.from(iv, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
