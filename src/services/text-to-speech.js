const path = require('path');
const { spawn } = require('child_process');

class TextToSpeechProvider {
  async speak(_text) { throw new Error('Not implemented.'); }
}

class WindowsSpeechProvider extends TextToSpeechProvider {
  constructor() { super(); this.script = path.join(__dirname, '..', 'windows', 'speak.ps1'); this.current = null; }
  speak(text) {
    const spoken = String(text).replace(/\s+/g, ' ').trim().slice(0, 650);
    if (!spoken) return Promise.resolve();
    if (this.current) this.current.kill();
    return new Promise((resolve, reject) => {
      const process = this.current = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script], { windowsHide: true });
      let error = '';
      process.stderr.on('data', chunk => { error += chunk; });
      process.on('error', reject);
      process.on('close', code => { if (this.current === process) this.current = null; code === 0 ? resolve() : reject(new Error(error.trim() || 'Windows text-to-speech failed.')); });
      process.stdin.end(spoken, 'utf8');
    });
  }
  stop() { if (this.current) this.current.kill(); }
}
module.exports = { TextToSpeechProvider, WindowsSpeechProvider };
