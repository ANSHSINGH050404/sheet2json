import { describe, expect, it } from 'bun:test'

import {
  decryptToken,
  encryptToken,
  hashToken,
  randomToken,
  safeEqual,
} from '#server/auth/crypto'

const KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='

function withKey<T>(run: () => T): T {
  const previous = process.env.TOKEN_ENCRYPTION_KEY
  process.env.TOKEN_ENCRYPTION_KEY = KEY
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY
    else process.env.TOKEN_ENCRYPTION_KEY = previous
  }
}

describe('token hashing', () => {
  it('produces a stable digest for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })

  it('produces a different digest for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })

  it('never returns the input', () => {
    const token = randomToken()
    expect(hashToken(token)).not.toBe(token)
    expect(hashToken(token)).toHaveLength(64)
  })
})

describe('randomToken', () => {
  it('returns url-safe base64 of the requested size', () => {
    const token = randomToken(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    // 32 bytes of base64url, unpadded.
    expect(token.length).toBe(43)
  })

  it('does not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()))
    expect(tokens.size).toBe(200)
  })
})

describe('safeEqual', () => {
  it('matches identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects different strings', () => {
    expect(safeEqual('abc', 'abd')).toBe(false)
  })

  it('rejects a length mismatch without throwing', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('token encryption', () => {
  it('round-trips a value', () => {
    withKey(() => {
      const token = 'ya29.a0AfB_byC-secret-value'
      expect(decryptToken(encryptToken(token))).toBe(token)
    })
  })

  it('produces a different ciphertext each time', () => {
    withKey(() => {
      // A random IV per call. Identical plaintexts must not produce identical
      // ciphertexts, or the column would leak which users share a token.
      const a = encryptToken('same-value')
      const b = encryptToken('same-value')
      expect(a).not.toBe(b)
      expect(decryptToken(a)).toBe('same-value')
      expect(decryptToken(b)).toBe('same-value')
    })
  })

  it('returns null for a tampered ciphertext', () => {
    withKey(() => {
      const encrypted = encryptToken('secret')
      const [version, iv, tag, data] = encrypted.split('.') as [
        string,
        string,
        string,
        string,
      ]
      // Flip one character of the ciphertext. GCM authenticates, so this must
      // fail to decrypt rather than yield corrupted plaintext.
      const tampered = `${version}.${iv}.${tag}.${data.slice(0, -2)}${data.endsWith('A') ? 'B' : 'A'}`
      expect(decryptToken(tampered)).toBeNull()
    })
  })

  it('returns null for a tampered auth tag', () => {
    withKey(() => {
      const [version, iv, , data] = encryptToken('secret').split('.') as [
        string,
        string,
        string,
        string,
      ]
      // GCM authenticates, so a modified tag must fail rather than decrypt to
      // something wrong.
      expect(decryptToken(`${version}.${iv}.AAAA.${data}`)).toBeNull()
    })
  })

  it('returns null rather than throwing when the key has changed', () => {
    const encrypted = withKey(() => encryptToken('secret'))
    const previous = process.env.TOKEN_ENCRYPTION_KEY
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64')
    try {
      // Rotating the key must not crash a request; the caller's only sane
      // response is to treat the grant as gone and ask the user to reconnect.
      expect(decryptToken(encrypted)).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY
      else process.env.TOKEN_ENCRYPTION_KEY = previous
    }
  })

  it('returns null for null, undefined, empty and malformed values', () => {
    withKey(() => {
      expect(decryptToken(null)).toBeNull()
      expect(decryptToken(undefined)).toBeNull()
      expect(decryptToken('')).toBeNull()
      expect(decryptToken('not-a-token')).toBeNull()
      expect(decryptToken('v1.too.few')).toBeNull()
      expect(decryptToken('v9.aa.bb.cc')).toBeNull()
    })
  })

  it('does not contain the plaintext', () => {
    withKey(() => {
      const encrypted = encryptToken('ya29.super-secret')
      expect(encrypted).not.toContain('super-secret')
    })
  })

  it('throws a helpful error when the key is not configured', () => {
    const previous = process.env.TOKEN_ENCRYPTION_KEY
    delete process.env.TOKEN_ENCRYPTION_KEY
    try {
      expect(() => encryptToken('x')).toThrow(/TOKEN_ENCRYPTION_KEY/)
    } finally {
      if (previous !== undefined) process.env.TOKEN_ENCRYPTION_KEY = previous
    }
  })
})
