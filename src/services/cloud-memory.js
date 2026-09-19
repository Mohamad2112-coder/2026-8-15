'use strict';

/**
 * CloudMemoryProvider — optional cloud synchronisation for long-term memory.
 *
 * Privacy-first design:
 *  • Cloud sync is DISABLED by default.
 *  • Sensitive memories (password, secret, token, etc.) are NEVER uploaded.
 *  • All data is encrypted client-side before any upload using the same
 *    Electron safeStorage key used for local persistence.
 *  • The user can disable cloud sync at any time from Settings.
 *
 * This file intentionally ships as a stub with a no-op remote transport.
 * A real provider (e.g., your own encrypted endpoint) can be wired in by
 * implementing _remoteUpload() and _remoteDownload().
 */

const { safeStorage } = require('electron');

/** Patterns that flag a memory as sensitive — never upload these. */
const SENSITIVE_PATTERN = /password|secret|api[_\s-]?key|token|ssn|credit\s*card|cvv|pin\b|private[_\s-]?key/i;

class CloudMemoryProvider {
  /**
   * @param {object} settings — instance of SettingsStore (or any object with .get())
   */
  constructor(settings) {
    this._settings = settings;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns true only when the user has explicitly enabled cloud sync. */
  isEnabled() {
    try {
      const s = this._settings.get ? this._settings.get() : {};
      return s.cloudMemory === true;
    } catch {
      return false;
    }
  }

  /**
   * Classify whether a memory note is sensitive.
   * Sensitive memories must never be uploaded to any remote service.
   * @param {string} note
   * @returns {boolean}
   */
  isSensitive(note) {
    return SENSITIVE_PATTERN.test(note);
  }

  /**
   * Upload non-sensitive long-term memories to the cloud.
   * No-op when cloud sync is disabled or when there is nothing safe to upload.
   * @param {Array<{id:string, note:string, category:string, createdAt:string}>} memories
   * @returns {Promise<{uploaded: number, skipped: number, reason?: string}>}
   */
  async upload(memories) {
    if (!this.isEnabled()) {
      return { uploaded: 0, skipped: memories.length, reason: 'Cloud sync is disabled.' };
    }

    const safe = memories.filter(m => !this.isSensitive(m.note));
    const skipped = memories.length - safe.length;

    if (safe.length === 0) {
      return { uploaded: 0, skipped: memories.length, reason: 'All memories are sensitive and will not be uploaded.' };
    }

    // Encrypt client-side before any transport.
    const payload = this._encrypt(JSON.stringify({ version: 1, memories: safe }));

    await this._remoteUpload(payload);
    return { uploaded: safe.length, skipped };
  }

  /**
   * Download memories from the cloud and merge with local store.
   * No-op when cloud sync is disabled.
   * @returns {Promise<Array>} — decrypted remote memories (may be empty)
   */
  async download() {
    if (!this.isEnabled()) return [];
    try {
      const payload = await this._remoteDownload();
      if (!payload) return [];
      const raw = this._decrypt(payload);
      const parsed = JSON.parse(raw);
      return parsed.memories || [];
    } catch {
      return [];
    }
  }

  // ---------------------------------------------------------------------------
  // Remote transport stubs — replace with real HTTP calls if desired
  // ---------------------------------------------------------------------------

  /**
   * @param {string} encryptedBase64
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async _remoteUpload(encryptedBase64) {
    // TODO: implement with your own secure endpoint, e.g.:
    // await fetch('https://your-endpoint/memory', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    //   body: JSON.stringify({ data: encryptedBase64 })
    // });
  }

  /**
   * @returns {Promise<string|null>} — encrypted base-64 payload, or null if empty
   */
  async _remoteDownload() {
    // TODO: implement with your own secure endpoint.
    return null;
  }

  // ---------------------------------------------------------------------------
  // Client-side encryption helpers
  // ---------------------------------------------------------------------------

  _encrypt(plaintext) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable; cloud sync disabled.');
    return safeStorage.encryptString(plaintext).toString('base64');
  }

  _decrypt(base64) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Encryption unavailable; cannot decrypt cloud data.');
    return safeStorage.decryptString(Buffer.from(base64, 'base64'));
  }
}

module.exports = { CloudMemoryProvider, SENSITIVE_PATTERN };
