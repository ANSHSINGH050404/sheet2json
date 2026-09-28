import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'

/**
 * Encryption for Google OAuth tokens at rest.
 *
 * A refresh token is a standing, offline-capable grant to read someone's
 * spreadsheets. Storing one in plain text would mean a database leak - a stolen
 * backup, a leaked connection string, an over-broad SQL role - hands an attacker
 * ongoing read access to private data. Encrypting the column means the database
 * alone is not enough; the key lives in the environment.
 *
 * AES-256-GCM, because it authenticates as well as encrypts: a modified
 * ciphertext fails to decrypt instead of yielding attacker-chosen plaintext.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32
/** Bumped if the format ever changes, so old values fail loudly, not silently. */
const VERSION = 'v1'

class TokenEncryptionUnavailable extends Error {
  constructor() {
    super(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    )
    this.name = 'TokenEncryptionUnavailable'
  }
}

/**
 * The encryption key, read fresh each call.
 *
 * Read lazily rather than at module load so that a process which never touches
 * a Google token - tests, the public extraction path - does not require the
 * variable to be set at all.
 */
function getKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY
  if (!secret || secret.trim() === '') throw new TokenEncryptionUnavailable()

  // The env var is documented as base64, but a raw passphrase should not silently
  // produce a different key than the operator intended. Decoding base64 and
  // hashing whatever we get covers both, so a wrong format degrades to a weaker
  // but still deterministic key rather than a confusing one.
  const decoded = Buffer.from(secret.trim(), 'base64')
  if (decoded.length === KEY_BYTES) return decoded
  return createHash('sha256').update(secret, 'utf8').digest()
}

/** Encrypts a token for storage. Output is `v1.<iv>.<tag>.<ciphertext>`. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/**
 * Decrypts a stored token.
 *
 * Returns null for anything unreadable - a wrong key, a truncated value, a
 * tampered ciphertext. Callers treat that as "re-authenticate" rather than
 * crashing, because the only correct response to an undecryptable token is to
 * ask the user to connect Google again.
 */
export function decryptToken(value: string | null | undefined): string | null {
  if (!value) return null

  const parts = value.split('.')
  if (parts.length !== 4) return null
  const [version, ivPart, tagPart, dataPart] = parts as [
    string,
    string,
    string,
    string,
  ]
  if (version !== VERSION) return null

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivPart, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return null
  }
}
