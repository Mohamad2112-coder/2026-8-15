const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class FileSystemService {
  async search({ root = path.join(os.homedir(), 'Downloads'), query = '', extension, after, before, content, limit = 250 }) {
    const results = []; const lowered = query.toLowerCase(); const from = after ? new Date(after) : null; const to = before ? new Date(before) : null;
    const visit = dir => {
      if (results.length >= limit) return;
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= limit) return;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!['node_modules', '$Recycle.Bin'].includes(entry.name)) visit(fullPath); continue; }
        let stat; try { stat = fs.statSync(fullPath); } catch { continue; }
        if (extension && path.extname(entry.name).toLowerCase() !== extension.toLowerCase()) continue;
        if (lowered && !entry.name.toLowerCase().includes(lowered)) continue;
        if (from && stat.mtime < from || to && stat.mtime > to) continue;
        if (content && !this.matchesContent(fullPath, content)) continue;
        results.push({ name: entry.name, path: fullPath, modified: stat.mtime.toISOString(), size: stat.size });
      }
    };
    visit(root); return results;
  }
  matchesContent(file, phrase) {
    const ext = path.extname(file).toLowerCase(); if (!['.txt', '.md', '.csv', '.json', '.js', '.ts', '.py', '.html', '.css'].includes(ext)) return false;
    try { return fs.readFileSync(file, 'utf8').slice(0, 2_000_000).toLowerCase().includes(phrase.toLowerCase()); } catch { return false; }
  }
  readText(file) { const max = 2_000_000; return fs.readFileSync(file, 'utf8').slice(0, max); }
  async readPdf(file) {
    try { const { stdout } = await execFileAsync('pdftotext', [file, '-'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }); return stdout; }
    catch { throw new Error('PDF text extraction is unavailable. Install Poppler (pdftotext) to read PDFs locally.'); }
  }
  findDuplicates(root) {
    const files = []; const bySize = new Map();
    const visit = dir => { let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const entry of entries) { const full = path.join(dir, entry.name); if (entry.isDirectory()) visit(full); else { try { const size = fs.statSync(full).size; if (size) { const same = bySize.get(size) || []; same.push(full); bySize.set(size, same); } } catch {} } } };
    visit(root);
    for (const matches of bySize.values()) if (matches.length > 1) { const hashes = new Map(); for (const file of matches) { const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); const same = hashes.get(hash) || []; same.push(file); hashes.set(hash, same); } for (const same of hashes.values()) if (same.length > 1) files.push(same); }
    return files;
  }
  createFolder(folder) { fs.mkdirSync(folder, { recursive: true }); }
  apply(operations) {
    for (const op of operations) {
      if (op.type === 'move') { fs.mkdirSync(path.dirname(op.destination), { recursive: true }); fs.renameSync(op.source, op.destination); }
      else if (op.type === 'copy') { fs.mkdirSync(path.dirname(op.destination), { recursive: true }); fs.copyFileSync(op.source, op.destination, fs.constants.COPYFILE_EXCL); }
      else if (op.type === 'rename') fs.renameSync(op.source, op.destination);
      else if (op.type === 'write') fs.writeFileSync(op.path, op.content, 'utf8');
      else throw new Error(`Unsupported file operation: ${op.type}`);
    }
  }
  async recycle(paths) {
    for (const item of paths) await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($args[0], 'OnlyErrorDialogs', 'SendToRecycleBin')` , item], { windowsHide: true });
  }
}
module.exports = { FileSystemService };
