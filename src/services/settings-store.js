const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

class SettingsStore {
  constructor(directory) {
    this.file = path.join(directory, 'settings.json');
    fs.mkdirSync(directory, { recursive: true });
  }
  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; }
  }
  getKey() {
    const stored = this.read().encryptedApiKey;
    if (stored && safeStorage.isEncryptionAvailable()) {
      try { return safeStorage.decryptString(Buffer.from(stored, 'base64')); } catch { return null; }
    }
    return process.env.GEMINI_API_KEY || process.env.AI_API_KEY || null;
  }
  getPublic() {
    const settings = this.read();
    return {
      model: settings.model || 'gemini-3.6-flash',
      baseUrl: settings.baseUrl || 'https://generativelanguage.googleapis.com',
      hasApiKey: Boolean(this.getKey()),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }
  save(input = {}) {
    const current = this.read();
    const next = {
      model: String(input.model || current.model || 'Not configured').trim(),
      baseUrl: String(input.baseUrl || current.baseUrl || 'https://example.invalid').trim().replace(/\/$/, '')
    };
    if (input.apiKey && String(input.apiKey).trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is unavailable; use an environment variable instead.');
      next.encryptedApiKey = safeStorage.encryptString(String(input.apiKey).trim()).toString('base64');
    } else if (current.encryptedApiKey) next.encryptedApiKey = current.encryptedApiKey;
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
    return this.getPublic();
  }
}

module.exports = { SettingsStore };
