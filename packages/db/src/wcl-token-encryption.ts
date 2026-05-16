import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 'v1';
const IV_BYTE_LENGTH = 12;
const TOKEN_KEY_BYTE_LENGTH = 32;

export type WclTokenEnvelope = {
  keyVersion: typeof KEY_VERSION;
  algorithm: typeof ALGORITHM;
  iv: string;
  authTag: string;
  ciphertext: string;
};

export type WclTokenEncryptionErrorCode = 'invalid_key' | 'encrypt_failed' | 'decrypt_failed';

export class WclTokenEncryptionError extends Error {
  public readonly code: WclTokenEncryptionErrorCode;

  public constructor(code: WclTokenEncryptionErrorCode) {
    super(
      code === 'invalid_key'
        ? 'WCL token encryption key is invalid'
        : code === 'encrypt_failed'
          ? 'WCL token encryption failed'
          : 'WCL token decryption failed',
    );
    this.name = 'WclTokenEncryptionError';
    this.code = code;
  }
}

const withoutBase64Padding = (value: string): string => value.replace(/=+$/u, '');

export const parseWclTokenEncryptionKey = (value: string): Buffer => {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(trimmed)) {
    throw new WclTokenEncryptionError('invalid_key');
  }

  const key = Buffer.from(trimmed, 'base64');
  const canonical = key.toString('base64');
  if (
    key.length !== TOKEN_KEY_BYTE_LENGTH ||
    withoutBase64Padding(canonical) !== withoutBase64Padding(trimmed)
  ) {
    throw new WclTokenEncryptionError('invalid_key');
  }

  return key;
};

export const isValidWclTokenEncryptionKey = (value: string): boolean => {
  try {
    parseWclTokenEncryptionKey(value);
    return true;
  } catch {
    return false;
  }
};

const isEnvelopeString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

export const isWclTokenEnvelope = (value: unknown): value is WclTokenEnvelope => {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<Record<keyof WclTokenEnvelope, unknown>>;
  return (
    envelope.keyVersion === KEY_VERSION &&
    envelope.algorithm === ALGORITHM &&
    isEnvelopeString(envelope.iv) &&
    isEnvelopeString(envelope.authTag) &&
    isEnvelopeString(envelope.ciphertext)
  );
};

export const encryptWclToken = (plaintext: string, key: Buffer): WclTokenEnvelope => {
  try {
    const iv = crypto.randomBytes(IV_BYTE_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      keyVersion: KEY_VERSION,
      algorithm: ALGORITHM,
      iv: iv.toString('base64url'),
      authTag: authTag.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  } catch {
    throw new WclTokenEncryptionError('encrypt_failed');
  }
};

export const decryptWclToken = (envelope: unknown, key: Buffer): string => {
  if (!isWclTokenEnvelope(envelope)) {
    throw new WclTokenEncryptionError('decrypt_failed');
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  } catch {
    throw new WclTokenEncryptionError('decrypt_failed');
  }
};
