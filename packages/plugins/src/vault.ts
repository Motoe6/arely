import * as crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_DIGEST = "sha512";

export interface VaultEntry {
  id: string;
  type: "api-key" | "oauth2" | "password" | "custom";
  label: string;
  encrypted: string;
  iv: string;
  authTag: string;
  salt: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface VaultProvider {
  name: string;
  getSecret(key: string): Promise<string | null>;
  setSecret(key: string, value: string): Promise<void>;
  deleteSecret(key: string): Promise<void>;
  listSecrets(): Promise<string[]>;
}

export class EnvVaultProvider implements VaultProvider {
  name = "env";

  async getSecret(key: string): Promise<string | null> {
    return process.env[key] ?? null;
  }

  async setSecret(_key: string, _value: string): Promise<void> {
    throw new Error("EnvVaultProvider is read-only");
  }

  async deleteSecret(_key: string): Promise<void> {
    throw new Error("EnvVaultProvider is read-only");
  }

  async listSecrets(): Promise<string[]> {
    return Object.keys(process.env).filter((k) => k.startsWith("ARELY_") || k.startsWith("VAULT_"));
  }
}

export class CredentialVault {
  private masterKey: Buffer | null = null;
  private provider: VaultProvider;
  private entries = new Map<string, VaultEntry>();

  constructor(provider?: VaultProvider) {
    this.provider = provider ?? new EnvVaultProvider();
  }

  isInitialized(): boolean {
    return this.masterKey !== null;
  }

  initialize(masterKey?: string): void {
    if (masterKey) {
      this.masterKey = Buffer.from(masterKey, "utf-8").slice(0, KEY_LENGTH);
      if (this.masterKey.length < KEY_LENGTH) {
        const padded = Buffer.alloc(KEY_LENGTH, 0);
        this.masterKey.copy(padded);
        this.masterKey = padded;
      }
    } else {
      const envKey = process.env["ARELY_VAULT_KEY"];
      if (envKey) {
        this.masterKey = Buffer.from(envKey, "utf-8").slice(0, KEY_LENGTH);
        if (this.masterKey.length < KEY_LENGTH) {
          const padded = Buffer.alloc(KEY_LENGTH, 0);
          this.masterKey.copy(padded);
          this.masterKey = padded;
        }
      } else {
        this.masterKey = crypto.randomBytes(KEY_LENGTH);
      }
    }
  }

  deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
  }

  encrypt(plaintext: string, aad?: string): { encrypted: string; iv: string; authTag: string; salt: string } {
    if (!this.masterKey) throw new Error("Vault not initialized. Call initialize() first.");
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this.deriveKey(this.masterKey.toString("hex"), salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    if (aad) cipher.setAAD(Buffer.from(aad, "utf-8"));
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      encrypted: encrypted.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      salt: salt.toString("hex"),
    };
  }

  decrypt(data: { encrypted: string; iv: string; authTag: string; salt: string }, aad?: string): string {
    if (!this.masterKey) throw new Error("Vault not initialized. Call initialize() first.");
    const salt = Buffer.from(data.salt, "hex");
    const key = this.deriveKey(this.masterKey.toString("hex"), salt);
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(data.iv, "hex"),
      { authTagLength: AUTH_TAG_LENGTH },
    );
    decipher.setAuthTag(Buffer.from(data.authTag, "hex"));
    if (aad) decipher.setAAD(Buffer.from(aad, "utf-8"));
    return decipher.update(Buffer.from(data.encrypted, "hex")) + decipher.final("utf-8");
  }

  store(entry: Omit<VaultEntry, "encrypted" | "iv" | "authTag" | "salt" | "createdAt" | "updatedAt"> & { value: string }): VaultEntry {
    const encrypted = this.encrypt(entry.value, entry.id);
    const now = new Date().toISOString();
    const record: VaultEntry = {
      id: entry.id,
      type: entry.type,
      label: entry.label,
      encrypted: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      salt: encrypted.salt,
      metadata: entry.metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(entry.id, record);
    return record;
  }

  retrieve(id: string): string | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    try {
      return this.decrypt(
        { encrypted: entry.encrypted, iv: entry.iv, authTag: entry.authTag, salt: entry.salt },
        entry.id,
      );
    } catch {
      return null;
    }
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  list(): VaultEntry[] {
    return Array.from(this.entries.values());
  }

  async loadFromProvider(key: string): Promise<string | null> {
    return this.provider.getSecret(key);
  }

  importEntries(entries: VaultEntry[]): void {
    for (const e of entries) {
      this.entries.set(e.id, e);
    }
  }
}

export function createVault(): CredentialVault {
  const vault = new CredentialVault();
  vault.initialize();
  return vault;
}
