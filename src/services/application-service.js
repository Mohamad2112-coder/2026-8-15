const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { shell } = require('electron');
const execFileAsync = promisify(execFile);

const DEFINITIONS = {
  chrome: { aliases: ['chrome', 'google chrome'], executables: ['chrome.exe'], paths: [['ProgramFiles', 'Google', 'Chrome', 'Application', 'chrome.exe'], ['ProgramFiles(x86)', 'Google', 'Chrome', 'Application', 'chrome.exe']] },
  edge: { aliases: ['edge', 'microsoft edge'], executables: ['msedge.exe'], paths: [['ProgramFiles(x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe']] },
  vscode: { aliases: ['vs code', 'vscode', 'visual studio code', 'code'], executables: ['code.cmd', 'code.exe'], paths: [['LocalAppData', 'Programs', 'Microsoft VS Code', 'Code.exe']] },
  notepad: { aliases: ['notepad'], executables: ['notepad.exe'], paths: [] },
  explorer: { aliases: ['explorer', 'file explorer'], executables: ['explorer.exe'], paths: [] },
  terminal: { aliases: ['terminal', 'windows terminal'], executables: ['wt.exe'], paths: [] },
  powershell: { aliases: ['powershell', 'power shell'], executables: ['powershell.exe', 'pwsh.exe'], paths: [] },
  cmd: { aliases: ['cmd', 'command prompt'], executables: ['cmd.exe'], paths: [] },
  calculator: { aliases: ['calculator', 'calc'], executables: ['calc.exe'], paths: [] },
  discord: { aliases: ['discord'], executables: ['discord.exe'], paths: [['LocalAppData', 'Discord', 'Update.exe']] },
  spotify: { aliases: ['spotify'], executables: ['spotify.exe'], paths: [['AppData', 'Spotify', 'Spotify.exe']] }
};

class ApplicationService {
  async resolve(name) {
    const normalized = String(name).trim().toLowerCase();
    const entry = Object.entries(DEFINITIONS).find(([, def]) => def.aliases.includes(normalized));
    if (!entry) return null;
    const [id, definition] = entry;
    for (const executable of definition.executables) {
      try { const { stdout } = await execFileAsync('where.exe', [executable], { windowsHide: true }); const executablePath = stdout.split(/\r?\n/).find(Boolean); if (executablePath) return { id, label: definition.aliases[definition.aliases.length - 1], path: executablePath }; } catch { /* try known paths */ }
    }
    for (const parts of definition.paths) { const [variable, ...rest] = parts; const base = process.env[variable]; const candidate = base && path.join(base, ...rest); if (candidate && fs.existsSync(candidate)) return { id, label: definition.aliases[definition.aliases.length - 1], path: candidate }; }
    return null;
  }
  async launch(name) { const app = await this.resolve(name); if (!app) throw new Error(`I could not find ${name} on this PC.`); const error = await shell.openPath(app.path); if (error) throw new Error(error); return app; }
  async inventory() { const entries = await Promise.all(Object.keys(DEFINITIONS).map(async id => [id, await this.resolve(id)])); return Object.fromEntries(entries.filter(([, value]) => value)); }
}
module.exports = { ApplicationService };
