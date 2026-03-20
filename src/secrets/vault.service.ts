import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/database';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { hkdfSync } from 'crypto';

@Injectable()
export class VaultService {
  private readonly logger = new Logger(VaultService.name);
  private readonly masterKey: Buffer;

  constructor(private readonly prisma: PrismaService) {
    const hexKey = process.env['SECRET_ENCRYPTION_KEY'];
    if (!hexKey || hexKey.length !== 64) {
      throw new Error('SECRET_ENCRYPTION_KEY must be 32 bytes hex (64 chars)');
    }
    this.masterKey = Buffer.from(hexKey, 'hex');
  }

  /**
   * Derives a unique encryption key per user using HKDF.
   * Each user gets a different key derived from master + derivationId (Telegram ID).
   */
  private deriveUserKey(derivationId: string): Buffer {
    return Buffer.from(
      hkdfSync('sha256', this.masterKey, derivationId, 'elena-vault-v1', 32)
    );
  }

  /**
   * Encrypts a value for a specific user.
   * CRITICAL: Fresh 12-byte IV on every call — never reuse.
   */
  encrypt(value: string, derivationId: string): { encrypted: string; iv: string } {
    const userKey = this.deriveUserKey(derivationId);
    const iv = randomBytes(12); // 96-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', userKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(), // 16-byte auth tag appended
    ]);

    return {
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  /**
   * Decrypts a value for a specific user.
   * Also adds plaintext to decryptedSecretsSet for sanitizer Layer 1.
   */
  decrypt(
    encryptedBase64: string,
    ivBase64: string,
    derivationId: string,
    decryptedSecretsSet?: Set<string>,
  ): string {
    const userKey = this.deriveUserKey(derivationId);
    const iv = Buffer.from(ivBase64, 'base64');
    const encryptedWithTag = Buffer.from(encryptedBase64, 'base64');
    
    // Last 16 bytes are the auth tag
    const authTag = encryptedWithTag.slice(-16);
    const encrypted = encryptedWithTag.slice(0, -16);
    
    const decipher = createDecipheriv('aes-256-gcm', userKey, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');

    if (decryptedSecretsSet) {
      decryptedSecretsSet.add(decrypted);
    }

    return decrypted;
  }

  /**
   * Store a new secret for a user.
   * Upsert: if label exists, rotates (INSERT new row + DELETE old) in transaction.
   * NEVER updates encryptedValue in place — prevents IV reuse.
   */
  async storeSecret(
    userId: string,
    derivationId: string,
    label: string,
    value: string,
    expiresAt?: Date,
  ): Promise<void> {
    const { encrypted, iv } = this.encrypt(value, derivationId);

    await this.prisma.$transaction(async (tx) => {
      // Delete existing if present (rotation)
      await tx.secret.deleteMany({
        where: { ownerUserId: userId, label },
      });

      // Insert fresh row with new IV
      await tx.secret.create({
        data: {
          ownerUserId: userId,
          label,
          encryptedValue: encrypted,
          iv,
          expiresAt: expiresAt ?? null,
        },
      });
    });

    this.logger.log(`Secret stored for user ${userId}, label: ${label}`);
  }

  /**
   * Retrieve and decrypt a secret for a user.
   * Returns null if not found or expired.
   */
  async getSecret(
    userId: string,
    derivationId: string,
    label: string,
    decryptedSecretsSet?: Set<string>,
  ): Promise<string | null> {
    const secret = await this.prisma.secret.findUnique({
      where: { ownerUserId_label: { ownerUserId: userId, label } },
    });

    if (!secret) return null;

    if (secret.expiresAt && secret.expiresAt < new Date()) {
      this.logger.warn(`Secret ${label} for user ${userId} has expired`);
      return null;
    }

    return this.decrypt(secret.encryptedValue, secret.iv, derivationId, decryptedSecretsSet);
  }

  /**
   * List secret labels (NOT values) for a user.
   */
  async listSecrets(userId: string): Promise<{ label: string; expiresAt: Date | null }[]> {
    const secrets = await this.prisma.secret.findMany({
      where: { ownerUserId: userId },
      select: { label: true, expiresAt: true },
    });
    return secrets;
  }

  /**
   * Delete a specific secret.
   */
  async deleteSecret(userId: string, label: string): Promise<void> {
    await this.prisma.secret.deleteMany({
      where: { ownerUserId: userId, label },
    });
    this.logger.log(`Secret deleted for user ${userId}, label: ${label}`);
  }
}
