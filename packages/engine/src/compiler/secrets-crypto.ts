import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16
const TAG_LENGTH = 16
const CURRENT_VERSION = 1

let _key: Buffer | null = null

function getKey(): Buffer | null {
  if (_key) return _key
  const raw = process.env.FLOW_SECRET_KEY
  if (!raw) return null
  _key = createHash("sha256").update(raw).digest()
  return _key
}

export function resetKey(): void {
  _key = null
}

export interface EncryptedPayload {
  v: number
  iv: string
  t: string
  c: string
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  if (!key) {
    return JSON.stringify({ v: 0, c: Buffer.from(plaintext, "utf-8").toString("base64") })
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
  const tag = cipher.getAuthTag()

  const payload: EncryptedPayload = {
    v: CURRENT_VERSION,
    iv: iv.toString("base64"),
    t: tag.toString("base64"),
    c: encrypted.toString("base64"),
  }
  return JSON.stringify(payload)
}

export function decrypt(payload: string): string {
  const parsed: EncryptedPayload = JSON.parse(payload)

  if (parsed.v === 0) {
    return Buffer.from(parsed.c, "base64").toString("utf-8")
  }

  if (parsed.v !== CURRENT_VERSION) {
    throw new Error(`Unsupported secret version: ${parsed.v}`)
  }

  const key = getKey()
  if (!key) {
    throw new Error("FLOW_SECRET_KEY is required to decrypt secrets")
  }

  const iv = Buffer.from(parsed.iv, "base64")
  const tag = Buffer.from(parsed.t, "base64")
  const encrypted = Buffer.from(parsed.c, "base64")

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(encrypted) + decipher.final("utf-8")
}

export function hasEncryptionKey(): boolean {
  return getKey() !== null
}
