'use strict';

/**
 * MemoryStore — encrypted persistent memory with short-term session layer.
 *
 * LONG-TERM memory:
 *   • Stored in an encrypted file using Electron safeStorage (Windows DPAPI).
 *   • Survives across sessions.
 *   • Holds up to 200 entries (oldest trimmed automatically).
 *   • Entries have: id, note, category, tags, createdAt, sensitive.
 *
 * SHORT-TERM memory:
 *   • In-memory only; cleared when JARVIS is closed.
 *   • Tracks the current conversation context and active task.
 *
 * Categories: 'fact' | 'preference' | 'workflow' | 'task'
 *
 * Sensitive detection: notes matching /password|secret|token|key…/ are flagged
 * as sensitive: true and excluded from any cloud sync attempt.
 */

const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { SENSITIVE_PATTERN } = require('./cloud-memory');

const MAX_LONG_TERM = 200;
const VALID_CATEGORIES = Object.freeze(['fact', 'preference', 'workflow', 'task']);

class MemoryStore {
  /** @param {string} directory — writable app data directory */
  constructor(directory) {
    this._file = path.join(directory, 'memory.json');
    fs.mkdirSync(directory, { recursive: true });

    // Short-term: in-memory only
    /** @type {Array<{id:string, note:string, createdAt:string}>} */
    this._session = [];
  }

  // ===========================================================================
  // Long-term memory
  // ===========================================================================

  /**
   * Read all long-term memories from the encrypted store.
   * @returns {Array<object>}
   */
  read() {
    try {
      const stored = JSON.parse(fs.readFileSync(this._file, 'utf8'));
      // v1 — legacy plain array migration
      if (Array.isArray(stored)) return stored;
      if (!stored.encrypted || !safeStorage.isEncryptionAvailable()) return [];
      const plain = safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64'));
      return JSON.parse(plain).memories || [];
    } catch {
      return [];
    }
  }

  /**
   * Persist an array of memories to the encrypted store.
   * @param {Array<object>} memories
   */
  write(memories) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Windows DPAPI encryption is unavailable; persistent memory is disabled to protect your information.'
      );
    }
    const encrypted = safeStorage
      .encryptString(JSON.stringify({ memories }))
      .toString('base64');
    fs.writeFileSync(
      this._file,
      JSON.stringify({ version: 2, encrypted }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
  }

  /**
   * Return all long-term memories.
   * @returns {Array<object>}
   */
  list() {
    return this.read();
  }

  /**
   * Add a new long-term memory.
   * @param {string} note
   * @param {string} [category] — 'fact' | 'preference' | 'workflow' | 'task'
   * @param {string[]} [tags]
   * @returns {object} The stored memory entry.
   */
  add(note, category = 'fact', tags = []) {
    const safeCategory = VALID_CATEGORIES.includes(category) ? category : 'fact';
    const sensitive = SENSITIVE_PATTERN.test(note);
    const memories = this.read();
    const memory = {
      id: crypto.randomUUID(),
      note,
      category: safeCategory,
      tags: Array.isArray(tags) ? tags : [],
      sensitive,
      createdAt: new Date().toISOString(),
    };
    memories.unshift(memory);
    this.write(memories.slice(0, MAX_LONG_TERM));
    return memory;
  }

  /**
   * Remove a memory by ID.
   * @param {string} id
   * @returns {boolean} Whether an entry was actually removed.
   */
  remove(id) {
    const memories = this.read();
    const next = memories.filter(item => item.id !== id);
    this.write(next);
    return next.length !== memories.length;
  }

  /**
   * Remove all long-term memories.
   */
  clear() {
    this.write([]);
  }

  /**
   * Fuzzy-search long-term memories by note text or tags.
   * @param {string} query
   * @param {number} [limit=8]
   * @returns {Array<object>}
   */
  find(query, limit = 8) {
    const words = query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.read()
      .filter(x =>
        words.some(
          w =>
            x.note.toLowerCase().includes(w) ||
            (x.tags || []).some(t => t.toLowerCase().includes(w))
        )
      )
      .slice(0, limit);
  }

  /**
   * Find long-term memories that match a preference-related query.
   * Used for resolving things like "open my editor" → VS Code.
   * @param {string} keyword — e.g. "editor", "browser"
   * @returns {object|null}
   */
  findPreference(keyword) {
    const kw = keyword.toLowerCase();
    return (
      this.read()
        .filter(m => m.category === 'preference')
        .find(m => m.note.toLowerCase().includes(kw)) || null
    );
  }

  // ===========================================================================
  // Short-term (session) memory
  // ===========================================================================

  /**
   * Add a note to the in-memory session store.
   * @param {string} note
   * @returns {object}
   */
  addShortTerm(note) {
    const entry = { id: crypto.randomUUID(), note, createdAt: new Date().toISOString() };
    this._session.unshift(entry);
    if (this._session.length > 50) this._session.length = 50;
    return entry;
  }

  /**
   * Return all current-session memories.
   * @returns {Array<object>}
   */
  getShortTerm() {
    return [...this._session];
  }

  /**
   * Clear all current-session memories.
   */
  clearShortTerm() {
    this._session = [];
  }
}

module.exports = { MemoryStore };
