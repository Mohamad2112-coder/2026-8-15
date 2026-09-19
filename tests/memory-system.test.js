'use strict';

/**
 * tests/memory-system.test.js
 * Node.js built-in test runner (node --test)
 *
 * These tests run outside Electron so we stub the electron / safeStorage APIs.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Stub Electron safeStorage ─────────────────────────────────────────────────
const crypto = require('crypto');
const SECRET = 'test-key-32-bytes-padded-0000000';

const mockSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET), iv);
    return Buffer.concat([iv, cipher.update(text, 'utf8'), cipher.final()]);
  },
  decryptString: (buf) => {
    const iv = buf.slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(SECRET), iv);
    return decipher.update(buf.slice(16)) + decipher.final('utf8');
  },
};

// Monkey-patch require before loading the module
const Module = require('module');
const _origLoad = Module._load;
Module._load = function (id, ...rest) {
  if (id === 'electron') return { safeStorage: mockSafeStorage };
  return _origLoad.call(this, id, ...rest);
};

// Now load the modules under test
const { MemoryStore } = require('../src/services/memory-store');
const { CloudMemoryProvider, SENSITIVE_PATTERN } = require('../src/services/cloud-memory');

// ── Helper ────────────────────────────────────────────────────────────────────
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-test-'));
  return dir;
}

// =============================================================================
describe('MemoryStore — long-term', () => {
  let store;
  beforeEach(() => { store = new MemoryStore(tempDir()); });

  test('starts empty', () => {
    assert.deepEqual(store.list(), []);
  });

  test('add() returns the stored entry', () => {
    const m = store.add('My favourite browser is Firefox', 'preference');
    assert.equal(m.note, 'My favourite browser is Firefox');
    assert.equal(m.category, 'preference');
    assert.ok(m.id);
    assert.ok(m.createdAt);
  });

  test('add() with unknown category defaults to "fact"', () => {
    const m = store.add('Some note', 'unknown-cat');
    assert.equal(m.category, 'fact');
  });

  test('list() returns added entries (newest first)', () => {
    store.add('alpha');
    store.add('beta');
    const list = store.list();
    assert.equal(list.length, 2);
    assert.equal(list[0].note, 'beta');
  });

  test('remove() deletes by id', () => {
    const m = store.add('to delete');
    assert.ok(store.remove(m.id));
    assert.equal(store.list().length, 0);
  });

  test('remove() returns false for unknown id', () => {
    store.add('exists');
    assert.equal(store.remove('non-existent-id'), false);
  });

  test('clear() empties the store', () => {
    store.add('a'); store.add('b');
    store.clear();
    assert.deepEqual(store.list(), []);
  });

  test('find() does fuzzy keyword matching', () => {
    store.add('My editor is VS Code', 'preference');
    store.add('Project name is Atlas', 'fact');
    const result = store.find('editor');
    assert.equal(result.length, 1);
    assert.ok(result[0].note.includes('VS Code'));
  });

  test('findPreference() resolves a preference keyword', () => {
    store.add('My editor is VS Code', 'preference');
    const pref = store.findPreference('editor');
    assert.ok(pref);
    assert.ok(pref.note.includes('VS Code'));
  });

  test('findPreference() returns null if no match', () => {
    assert.equal(store.findPreference('browser'), null);
  });

  test('sensitive notes are flagged', () => {
    const m = store.add('my api_key is abc123');
    assert.equal(m.sensitive, true);
  });

  test('normal notes are not flagged as sensitive', () => {
    const m = store.add('I like dark mode');
    assert.equal(m.sensitive, false);
  });

  test('persists across re-instantiation', () => {
    const dir = tempDir();
    const s1 = new MemoryStore(dir);
    s1.add('persistent note');
    const s2 = new MemoryStore(dir);
    const list = s2.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].note, 'persistent note');
  });
});

// =============================================================================
describe('MemoryStore — short-term (session)', () => {
  let store;
  beforeEach(() => { store = new MemoryStore(tempDir()); });

  test('getShortTerm() starts empty', () => {
    assert.deepEqual(store.getShortTerm(), []);
  });

  test('addShortTerm() stores a session entry', () => {
    const e = store.addShortTerm('session note');
    assert.equal(e.note, 'session note');
    assert.equal(store.getShortTerm().length, 1);
  });

  test('clearShortTerm() empties session memory without touching long-term', () => {
    store.add('long-term');
    store.addShortTerm('session');
    store.clearShortTerm();
    assert.equal(store.getShortTerm().length, 0);
    assert.equal(store.list().length, 1);
  });

  test('short-term memory is NOT persisted', () => {
    const dir = tempDir();
    const s1 = new MemoryStore(dir);
    s1.addShortTerm('vanishes');
    const s2 = new MemoryStore(dir);
    assert.equal(s2.getShortTerm().length, 0);
  });
});

// =============================================================================
describe('CloudMemoryProvider', () => {
  const mockSettings = { get: () => ({ cloudMemory: false }) };
  const enabledSettings = { get: () => ({ cloudMemory: true }) };

  test('isEnabled() returns false when cloudMemory is false', () => {
    const p = new CloudMemoryProvider(mockSettings);
    assert.equal(p.isEnabled(), false);
  });

  test('isEnabled() returns true when cloudMemory is true', () => {
    const p = new CloudMemoryProvider(enabledSettings);
    assert.equal(p.isEnabled(), true);
  });

  test('isSensitive() flags password notes', () => {
    const p = new CloudMemoryProvider(mockSettings);
    assert.equal(p.isSensitive('my password is secret123'), true);
  });

  test('isSensitive() flags api_key notes', () => {
    const p = new CloudMemoryProvider(mockSettings);
    assert.equal(p.isSensitive('api_key: sk-abc'), true);
  });

  test('isSensitive() does not flag normal notes', () => {
    const p = new CloudMemoryProvider(mockSettings);
    assert.equal(p.isSensitive('I like dark mode'), false);
  });

  test('upload() is a no-op when disabled', async () => {
    const p = new CloudMemoryProvider(mockSettings);
    const result = await p.upload([{ id: '1', note: 'hello', category: 'fact', createdAt: '' }]);
    assert.equal(result.uploaded, 0);
    assert.ok(result.reason.includes('disabled'));
  });

  test('upload() skips sensitive memories even when enabled', async () => {
    const p = new CloudMemoryProvider(enabledSettings);
    const result = await p.upload([
      { id: '1', note: 'my password is secret', category: 'fact', createdAt: '' },
    ]);
    // _remoteUpload is a no-op stub, so upload should report skipped=1
    assert.equal(result.skipped, 1);
  });
});
