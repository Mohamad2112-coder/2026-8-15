const { EventEmitter } = require('events');
const path = require('path');
const { spawn } = require('child_process');

/** Local Windows Speech Recognition bridge. Audio never leaves the device. */
class WindowsVoiceService extends EventEmitter {
  constructor() { super(); this.script = path.join(__dirname, '..', 'windows', 'listen.ps1'); this.process = null; this.listening = false; this.captureMode = false; }
  start() { this.listening = true; this.captureMode = false; this.launch('continuous'); }
  stop() { this.listening = false; this.captureMode = false; this.stopProcess(); this.emit('state', { listening: false, captureMode: false }); }
  captureOne() { this.listening = true; this.captureMode = true; this.launch('command'); }
  launch(mode) {
    this.stopProcess();
    const child = this.process = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-Mode', mode], { windowsHide: true });
    let buffered = '';
    child.stdout.on('data', chunk => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/); buffered = lines.pop();
      for (const line of lines) this.handleLine(line, mode);
    });
    child.stderr.on('data', chunk => this.emit('error', new Error(chunk.toString().trim())));
    child.on('error', error => this.emit('error', error));
    child.on('close', () => {
      if (this.process === child) this.process = null;
      if (mode === 'command' && this.captureMode) { this.captureMode = false; if (this.listening) this.launch('continuous'); }
    });
    this.emit('state', { listening: true, captureMode: mode === 'command' });
  }
  handleLine(line, mode) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'error') return this.emit('error', new Error(event.message));
      if (event.type !== 'transcript') return;
      const text = String(event.text || '').trim();
      if (mode === 'continuous') {
        const match = /^jarvis[,.!]?\s*(.*)$/i.exec(text);
        if (match && match[1]) this.emit('command', { text: match[1], source: 'wake-word' });
      } else if (text) {
        this.captureMode = false;
        this.emit('command', { text, source: 'shortcut' });
        this.stopProcess();
        if (this.listening) setTimeout(() => this.launch('continuous'), 100);
      }
    } catch { /* Ignore non-protocol output from Windows speech services. */ }
  }
  stopProcess() { if (this.process) { this.process.kill(); this.process = null; } }
}
module.exports = { WindowsVoiceService };
