import { describe, it, expect, beforeEach } from "vitest"
import { encrypt, decrypt, hasEncryptionKey, resetKey } from "@arelyos/engine/compiler/secrets-crypto.js"

describe("SecretCrypto", () => {
  beforeEach(() => {
    resetKey()
    delete process.env.FLOW_SECRET_KEY
  })

  it("encrypts and decrypts with a key set", () => {
    process.env.FLOW_SECRET_KEY = "test-master-key-12345"
    resetKey()

    const payload = encrypt("my-api-key-abc123")
    expect(payload).toBeTruthy()

    const parsed = JSON.parse(payload)
    expect(parsed.v).toBe(1)
    expect(parsed.iv).toBeTruthy()
    expect(parsed.t).toBeTruthy()
    expect(parsed.c).toBeTruthy()

    const decrypted = decrypt(payload)
    expect(decrypted).toBe("my-api-key-abc123")
  })

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    process.env.FLOW_SECRET_KEY = "test-master-key-12345"
    resetKey()

    const a = encrypt("same-value")
    const b = encrypt("same-value")
    const parsedA = JSON.parse(a)
    const parsedB = JSON.parse(b)
    expect(parsedA.iv).not.toBe(parsedB.iv)
    expect(parsedA.c).not.toBe(parsedB.c)
  })

  it("stores plain base64 when no key is set (v0)", () => {
    const payload = encrypt("no-key-test")
    const parsed = JSON.parse(payload)
    expect(parsed.v).toBe(0)
    expect(parsed.iv).toBeUndefined()
    expect(parsed.t).toBeUndefined()
    expect(parsed.c).toBeTruthy()

    const decrypted = decrypt(payload)
    expect(decrypted).toBe("no-key-test")
  })

  it("throws on decrypt of v1 secret without key", () => {
    process.env.FLOW_SECRET_KEY = "temp-key"
    resetKey()
    const payload = encrypt("will-fail-without-key")
    resetKey()
    delete process.env.FLOW_SECRET_KEY

    expect(() => decrypt(payload)).toThrow("FLOW_SECRET_KEY is required")
  })

  it("throws on unsupported version", () => {
    const bad = JSON.stringify({ v: 99, c: "dGVzdA==" })
    expect(() => decrypt(bad)).toThrow("Unsupported secret version: 99")
  })

  it("roundtrips special characters", () => {
    process.env.FLOW_SECRET_KEY = "test-key"
    resetKey()

    const specials = "hello\nworld\t\r\0\u0001!@#$%^&*()_+{}[]|\\:;\"'<>,.?/~`"
    const encrypted = encrypt(specials)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(specials)
  })

  it("hasEncryptionKey returns correct state", () => {
    expect(hasEncryptionKey()).toBe(false)
    process.env.FLOW_SECRET_KEY = "key"
    resetKey()
    expect(hasEncryptionKey()).toBe(true)
  })
})
