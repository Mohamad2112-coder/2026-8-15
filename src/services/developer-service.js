const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class DeveloperService {
  async detect() {
    const probes = { node: ['node', '--version'], npm: ['npm.cmd', '--version'], python: ['python.exe', '--version'], git: ['git.exe', '--version'], powershell: ['powershell.exe', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] };
    const results = {};
    await Promise.all(Object.entries(probes).map(async ([name, [exe, arg]]) => { try { const { stdout, stderr } = await execFileAsync(exe, [arg], { windowsHide: true, timeout: 8000 }); results[name] = { available: true, version: (stdout || stderr).trim() }; } catch { results[name] = { available: false }; } }));
    return results;
  }
  async run(command, args, cwd) { const { stdout, stderr } = await execFileAsync(command, args, { cwd, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 }); return { output: `${stdout}${stderr}`.trim() }; }
}
module.exports = { DeveloperService };
