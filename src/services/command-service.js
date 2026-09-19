'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { shell } = require('electron');
const { ModeService } = require('./mode-service');
const execFileAsync = promisify(execFile);

const APPS = {
  notepad: 'notepad', calculator: 'calculator', explorer: 'explorer',
  terminal: 'terminal', chrome: 'chrome', edge: 'edge',
  'vs code': 'vscode', vscode: 'vscode', 'visual studio code': 'vscode',
  powershell: 'powershell',
};

/** Mode-aware system prompt fragments prepended to AI requests. */
const MODE_PROMPTS = {
  NORMAL:     'You are ORION, a calm, professional Windows desktop assistant. Be concise for simple requests, helpful and honest.',
  CODING:     'You are ORION in CODING MODE. Focus on programming, development, code quality, and technical precision. Provide code snippets when relevant.',
  RESEARCH:   'You are ORION in RESEARCH MODE. Prioritise finding accurate, well-sourced information. Summarise findings clearly.',
  FILE:       'You are ORION in FILE MODE. Focus on file management tasks: organising, finding, moving, and managing files safely.',
  SYSTEM:     'You are ORION in SYSTEM MODE. Focus on Windows system management, application control, and configuration.',
  AUTOMATION: 'You are ORION in AUTOMATION MODE. Break tasks into clear steps, execute SAFE and MODERATE steps automatically, and pause for approval on DANGEROUS operations.',
  VISION:     'You are ORION in VISION MODE. Help the user understand what is on their screen and take appropriate actions.',
  MEMORY:     'You are ORION in MEMORY MODE. Help the user manage their saved memories, preferences, and facts.',
};

const BASE_INSTRUCTIONS = 'You operate through explicit actions and must never claim an action happened unless its result was supplied. Do not invent file paths or results. Use light wit only when it fits.';

/** Detect what category of preference a "remember" note contains. */
function detectCategory(note) {
  if (/editor|browser|ide|terminal|shell|app|tool|use\b/i.test(note)) return 'preference';
  if (/workflow|process|steps?|always|never|prefer/i.test(note)) return 'workflow';
  if (/task|todo|remind/i.test(note)) return 'task';
  return 'fact';
}

/** Extract tags from a note. */
function extractTags(note) {
  const tags = [];
  if (/editor|ide/i.test(note)) tags.push('editor');
  if (/browser/i.test(note)) tags.push('browser');
  if (/project/i.test(note)) tags.push('project');
  if (/name|call(?:ed)?/i.test(note)) tags.push('identity');
  return tags;
}

/** Attempt to resolve a preference-based command like "open my editor". */
function tryResolvePreference(memory, text) {
  const kw = /my (\w+)/i.exec(text)?.[1];
  if (!kw) return null;
  const pref = memory.findPreference(kw);
  if (!pref) return null;
  // Extract app name from memory note, e.g. "my favorite editor is VS Code" → "vscode"
  const appMatch = /(?:is|use|prefer|like)\s+([\w\s]+?)(?:\.|$)/i.exec(pref.note);
  if (!appMatch) return null;
  const appName = appMatch[1].trim().toLowerCase();
  return APPS[appName] || appName;
}

class CommandService {
  constructor({ memory, providers, tools, files, modes, planner, permissionLog }) {
    this.memory = memory;
    this.providers = providers;
    this.tools = tools;
    this.files = files;
    this.modes = modes || new ModeService();
    this.planner = planner;
    this.permissionLog = permissionLog;
    this.pending = new Map();
  }

  async handle(text) {
    const lower = text.toLowerCase().trim();

    // -------------------------------------------------------------------------
    // Explicit mode switch: "Switch to Coding Mode"
    // -------------------------------------------------------------------------
    const switchTarget = this.modes.parseExplicitSwitch(text);
    if (switchTarget) {
      this.modes.setMode(switchTarget);
      return {
        kind: 'message',
        text: `Switched to ${switchTarget} MODE — ${this.modes.describe(switchTarget)}.`,
        mode: switchTarget,
        modeColor: this.modes.color(switchTarget),
      };
    }

    // -------------------------------------------------------------------------
    // MEMORY commands
    // -------------------------------------------------------------------------
    const remember = /^(?:jarvis,?\s*)?remember(?: that)?\s+/i.exec(text);
    if (remember) {
      const note = text.replace(/^(?:jarvis,?\s*)?remember(?: that)?\s+/i, '').trim();
      if (!note) return { kind: 'message', text: 'What would you like me to remember?' };
      const category = detectCategory(note);
      const tags = extractTags(note);
      await this.tools.execute('memory.save', { note, category, tags });
      const sensitiveWarning = this.memory.find(note).find(m => m.sensitive)
        ? ' (Flagged as sensitive — will not be synced to cloud.)'
        : '';
      return { kind: 'message', text: `Noted${category === 'preference' ? ' as a preference' : ''}: "${note}"${sensitiveWarning}` };
    }

    if (/what (?:do )?you remember|show (?:my )?memories/i.test(lower)) {
      const longTerm = this.memory.list();
      const shortTerm = this.memory.getShortTerm();
      let reply = '';
      if (shortTerm.length) {
        reply += `**Current session (${shortTerm.length}):**\n` + shortTerm.map(x => `• ${x.note}`).join('\n') + '\n\n';
      }
      if (longTerm.length) {
        reply += `**Saved memories (${longTerm.length}):**\n` + longTerm.map(x => `• [${x.category}] ${x.note}`).join('\n');
      }
      return { kind: 'message', text: reply || 'I do not have any saved memories yet.' };
    }

    // "Forget [topic]" — fuzzy delete
    const forget = /^(?:jarvis,?\s*)?forget\s+(?:that\s+)?(.+)$/i.exec(text);
    if (forget) {
      const topic = forget[1].trim();
      if (/^this$|^it$|^that$/.test(topic)) {
        return { kind: 'message', text: 'Tell me which memory you want to forget, or use the Memory panel to remove it.' };
      }
      const matches = this.memory.find(topic);
      if (!matches.length) return { kind: 'message', text: `I could not find a memory matching "${topic}".` };
      return this.requestApproval(
        `I found ${matches.length} memory entry${matches.length === 1 ? '' : ' entries'} matching "${topic}":\n${matches.map(m => `• ${m.note}`).join('\n')}\n\nRemove ${matches.length === 1 ? 'it' : 'them'}?`,
        'Forget',
        async () => {
          matches.forEach(m => this.memory.remove(m.id));
          return { kind: 'message', text: `Forgotten: "${topic}".` };
        }
      );
    }

    // -------------------------------------------------------------------------
    // REMINDER commands
    // -------------------------------------------------------------------------
    const remindMe = /^(?:jarvis,?\s*)?remind\s+(?:me\s+)?(?:to\s+)?(.+?)\s+(in\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|s|m|h))$/i.exec(text);
    if (remindMe) {
      const message = remindMe[1].trim();
      const timeText = remindMe[2].trim();
      const result = await this.tools.execute('reminder.create', { message, timeText });
      return { kind: 'message', text: result.summary };
    }

    const remindIn = /^(?:jarvis,?\s*)?remind\s+(?:me\s+)?(in\s+\d+(?:\.\d+)?\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|s|m|h))\s+(?:to\s+)?(.+)$/i.exec(text);
    if (remindIn) {
      const timeText = remindIn[1].trim();
      const message = remindIn[2].trim();
      const result = await this.tools.execute('reminder.create', { message, timeText });
      return { kind: 'message', text: result.summary };
    }

    if (/^(?:what are my reminders|list reminders|show reminders)/i.test(lower)) {
      const result = await this.tools.execute('reminder.list');
      if (!result.reminders || !result.reminders.length) {
        return { kind: 'message', text: 'You have no active reminders.' };
      }
      const list = result.reminders.map(r => `• "${r.message}" (due at ${new Date(r.dueAt).toLocaleTimeString()})`).join('\n');
      return { kind: 'message', text: `Active reminders:\n${list}` };
    }

    if (/^(?:delete|clear) all (?:my )?memories$/i.test(lower)) {
      return this.requestApproval(
        'This will permanently remove ALL locally stored memories. This cannot be undone.',
        'Delete all memories',
        async () => { this.memory.clear(); return { kind: 'message', text: 'All local memories have been deleted.' }; }
      );
    }

    // "What did you just do?" — show permission log
    if (/what did you (?:just )?do|show (?:recent )?actions|action log/i.test(lower)) {
      const summary = this.permissionLog.summarise(10);
      return { kind: 'message', text: summary };
    }

    // -------------------------------------------------------------------------
    // Preference resolution: "open my editor" → resolve from memory
    // -------------------------------------------------------------------------
    if (/open my \w+/i.test(lower)) {
      const resolvedApp = tryResolvePreference(this.memory, lower);
      if (resolvedApp) {
        return this.execute({ type: 'launch-app', app: resolvedApp, label: resolvedApp });
      }
    }

    // -------------------------------------------------------------------------
    // SYSTEM commands
    // -------------------------------------------------------------------------
    const folder = /open (?:my )?(downloads|documents|desktop|pictures|music|videos)(?: folder)?/i.exec(text);
    if (folder) return this.openFolder(folder[1]);

    const app = /^(?:jarvis,?\s*)?open (notepad|calculator|explorer|file explorer|terminal|chrome|edge|vs code|vscode|visual studio code|powershell)$/i.exec(text);
    if (app) return this.execute({ type: 'launch-app', app: APPS[app[1].toLowerCase()] || app[1].toLowerCase(), label: app[1] });

    const search = /^(?:search (?:the )?web for|google)\s+(.+)/i.exec(text);
    if (search) return this.execute({ type: 'web-search', query: search[1] });

    const readPage = /^(?:read|inspect) (https?:\/\/\S+)/i.exec(text);
    if (readPage) {
      const result = await this.tools.execute('browser.read', { url: readPage[1] });
      return { kind: 'message', text: `${result.summary}\n\n${result.page.text.slice(0, 2500)}` };
    }

    if (/^(?:check|detect) (?:my )?(?:developer|development) environment/i.test(lower)) {
      const result = await this.tools.execute('developer.detect');
      const status = Object.entries(result.tools).map(([name, tool]) => `• ${name}: ${tool.available ? tool.version : 'not found'}`).join('\n');
      return { kind: 'message', text: `Development environment:\n${status}` };
    }

    if (/create (?:a )?python virtual environment/i.test(lower)) {
      const environment = await this.tools.execute('developer.detect');
      if (!environment.tools.python?.available) return { kind: 'message', text: 'Python is not installed or is unavailable on PATH.' };
      return this.requestApproval('I will create a .venv folder in the current project directory using Python.', 'Create virtual environment', async () => {
        const result = await this.tools.execute('developer.run', { command: 'python.exe', args: ['-m', 'venv', '.venv'], cwd: process.cwd(), approved: true });
        return { kind: 'message', text: `Python virtual environment created.\n${result.output || ''}` };
      });
    }

    if (/^(?:take |capture )?(a )?screenshot/i.test(lower)) return this.execute({ type: 'screen-clip' });

    const findPdf = /find (?:the )?(?:pdf|file).*(?:downloaded )?(today|yesterday)?/i.test(lower);
    if (findPdf) return this.findFiles({ extension: '.pdf', directory: path.join(os.homedir(), 'Downloads'), yesterday: /yesterday/i.test(lower) });

    if (/what(?:'s| is) (?:on )?(?:my |the )?screen|what am i looking at|analyze.*(?:screen|display)|describe.*(?:screen|display)|read.*(?:screen|display)/i.test(lower)) {
      const capture = await this.tools.execute('screen.capture');
      const provider = this.providers && typeof this.providers.get === 'function' ? this.providers.get() : null;
      if (provider && typeof provider.analyzeImage === 'function') {
        try {
          const prompt = text.replace(/^(?:jarvis,?\s*)?(?:please\s*)?/i, '').trim();
          const analysis = await provider.analyzeImage(capture.path, prompt || 'Describe and analyze what is on this screen.');
          return { kind: 'screen', text: analysis, path: capture.path };
        } catch (err) {
          return { kind: 'screen', text: `Captured screen, but analysis encountered an error: ${err.message}`, path: capture.path };
        }
      }
      return { kind: 'screen', text: 'I captured the current screen. To interpret its contents with Gemini, configure your GEMINI_API_KEY in Settings or .env.', path: capture.path };
    }

    const makeFolder = /create (?:a )?folder (?:called |named )?(.+)/i.exec(text);
    if (makeFolder) {
      const folder = path.join(os.homedir(), 'Desktop', makeFolder[1].trim().replace(/[<>:"/\\|?*]/g, ''));
      await this.tools.execute('folder.create', { folder });
      return { kind: 'message', text: `Created the folder "${path.basename(folder)}" on your Desktop.` };
    }

    if (/find duplicate (?:files|images|photos)/i.test(lower)) return this.findDuplicates(path.join(os.homedir(), 'Downloads'));
    if (/move all pdfs? (?:into|to) (?:my )?documents/i.test(lower)) return this.planMovePdfs();

    const remove = /^delete (?:the )?(.+)/i.exec(text);
    if (remove) return this.planDelete(remove[1]);

    const ps = /^(?:run )?(?:powershell|power shell)\s*:\s*(.+)$/i.exec(text);
    if (ps) return this.requestApproval('This command can change your computer. Review it before I run it.', 'Run approved command', () => this.execute({ type: 'powershell', command: ps[1] }));

    // -------------------------------------------------------------------------
    // AI fallback — mode-aware
    // -------------------------------------------------------------------------
    
    // Visual Click shortcut
    const clickMatch = /^(?:jarvis,?\s*)?(?:click|press)(?:\s+the)?\s+(.+?)(?:\s+button)?(?:\s+on\s+screen)?$/i.exec(text);
    if (clickMatch) {
      return this.requestApproval('I will analyze your screen and click on "' + clickMatch[1] + '".', 'Click', async () => {
        try {
          const result = await this.tools.execute('computer.click_target', { targetDescription: clickMatch[1] });
          return { kind: 'message', text: result.summary };
        } catch (e) {
          return { kind: 'message', text: e.message };
        }
      });
    }

    // Scaffolding shortcut
    const scaffoldMatch = /^(?:jarvis,?\s*)?(?:create|generate|scaffold)\s+(?:a\s+)?(.+?)\s+project(?:\s+called\s+(.+?))?(?:\s+in\s+(.+?))?$/i.exec(text);
    if (scaffoldMatch) {
      const template = scaffoldMatch[1].trim();
      const name = scaffoldMatch[2] ? scaffoldMatch[2].trim() : 'my-project';
      const dest = scaffoldMatch[3] ? scaffoldMatch[3].trim() : undefined;
      return this.requestApproval(`Create project "${name}" (${template})${dest ? ' in ' + dest : ''}?`, 'Scaffold', async () => {
        try {
          const result = await this.tools.execute('project.scaffold', { name, template, destination: dest });
          if (result.readyToInstall) {
            return { kind: 'message', text: result.summary + '\n\nWould you like me to install dependencies?', action: { type: 'scaffold-install', projectDir: result.projectDir, template: result.template } };
          }
          return { kind: 'message', text: result.summary };
        } catch (e) {
          return { kind: 'message', text: e.message };
        }
      });
    }

    // RAG answer shortcut
    if (/^(?:jarvis,?\s*)?(?:search|check)\s+(?:my\s+)?(?:documents|files)\s+(?:for|about)\s+(.+)$/i.test(text)) {
      const q = text.match(/(?:for|about)\s+(.+)$/i)[1];
      try {
        const result = await this.tools.execute('rag.answer', { query: q });
        return { kind: 'message', text: result.answer };
      } catch (e) {
        return { kind: 'message', text: e.message };
      }
    }

    return this.askAI(text);
  }

  // ---------------------------------------------------------------------------
  // Approval / execution helpers
  // ---------------------------------------------------------------------------

  async executeApproved(action) {
    const pending = action?.id && this.pending.get(action.id);
    if (!pending) throw new Error('That approval has expired or is invalid.');
    this.pending.delete(action.id);
    return pending.execute();
  }

  async execute(action) {
    
    if (action.type === 'scaffold-install') {
      const srv = this.tools.scaffolding;
      if (!srv) throw new Error('Scaffolding service unavailable.');
      const res = await srv.runInstall({ projectDir: action.projectDir, template: action.template });
      return { kind: 'message', text: res.summary + '\n' + (res.output ? 'Output: ' + res.output : '') };
    }
    if (action.type === 'launch-app') { await this.tools.execute('application.launch', { app: action.app }); return { kind: 'message', text: `Certainly — opening ${action.label || action.app}.` }; }
    if (action.type === 'open-folder') { await this.tools.execute('folder.open', { folder: action.folder }); return { kind: 'message', text: `Certainly — opening ${action.label}.` }; }
    if (action.type === 'web-search') { await this.tools.execute('browser.search', { query: action.query }); return { kind: 'message', text: `Searching the web for "${action.query}".` }; }
    if (action.type === 'screen-clip') { await this.tools.execute('screen.clip'); return { kind: 'message', text: 'Screen capture is ready. Select the area you want to capture.' }; }
    if (action.type === 'powershell') {
      const result = await this.tools.execute('terminal.powershell', { command: action.command, approved: true });
      return { kind: 'message', text: `Command completed.${result.output ? `\n\n${result.output}` : ''}` };
    }
    throw new Error('Unknown action.');
  }

  async openFolder(name) {
    const canonical = name.toLowerCase();
    const folder = path.join(os.homedir(), canonical === 'desktop' ? 'Desktop' : canonical[0].toUpperCase() + canonical.slice(1));
    return this.execute({ type: 'open-folder', folder, label: `${canonical} folder` });
  }

  async findFiles({ extension, directory, yesterday }) {
    const matches = [];
    const start = yesterday ? new Date(Date.now() - 48 * 60 * 60 * 1000) : null;
    const end = yesterday ? new Date(Date.now() - 24 * 60 * 60 * 1000) : null;
    const visit = (dir, depth = 0) => {
      if (depth > 4 || matches.length >= 40) return;
      let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const item of entries) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) visit(full, depth + 1);
        else if (path.extname(item.name).toLowerCase() === extension) {
          const modified = fs.statSync(full).mtime;
          if (!yesterday || (modified >= start && modified < end)) matches.push({ name: item.name, path: full, modified });
        }
      }
    };
    visit(directory);
    matches.sort((a, b) => b.modified - a.modified);
    if (!matches.length) return { kind: 'message', text: `I could not find ${yesterday ? 'a PDF modified yesterday' : 'any PDFs'} in Downloads.` };
    return { kind: 'files', text: `I found ${matches.length} matching file${matches.length === 1 ? '' : 's'}.`, files: matches };
  }

  async findDuplicates(directory) {
    const groups = this.files.findDuplicates(directory);
    if (!groups.length) return { kind: 'message', text: 'I did not find duplicate files in Downloads.' };
    const redundant = groups.reduce((total, group) => total + group.length - 1, 0);
    return { kind: 'message', text: `I found ${groups.length} duplicate group${groups.length === 1 ? '' : 's'} (${redundant} redundant files). I have not deleted anything. Select a group in a future review workflow before removal.` };
  }

  async planMovePdfs() {
    const source = path.join(os.homedir(), 'Downloads');
    const target = path.join(os.homedir(), 'Documents');
    const files = await this.files.search({ root: source, extension: '.pdf' });
    const operations = files.map(file => ({ type: 'move', source: file.path, destination: path.join(target, file.name) })).filter(op => !fs.existsSync(op.destination));
    if (!operations.length) return { kind: 'message', text: 'There are no PDFs in Downloads that can be moved without overwriting a Documents file.' };
    return this.requestApproval(`I found ${operations.length} PDF file${operations.length === 1 ? '' : 's'} to move from Downloads to Documents. This is a mass file operation.`, 'Move files', async () => { this.files.apply(operations); return { kind: 'message', text: `Moved ${operations.length} PDF file${operations.length === 1 ? '' : 's'} to Documents.` }; });
  }

  async planDelete(name) {
    const matches = await this.files.search({ root: path.join(os.homedir(), 'Downloads'), query: name, limit: 10 });
    if (!matches.length) return { kind: 'message', text: `I could not find "${name}" in Downloads.` };
    return this.requestApproval(`I found ${matches.length} matching file${matches.length === 1 ? '' : 's'}. They will be moved to the Windows Recycle Bin, not permanently deleted.`, 'Move to Recycle Bin', async () => { await this.files.recycle(matches.map(file => file.path)); return { kind: 'message', text: `Moved ${matches.length} item${matches.length === 1 ? '' : 's'} to the Recycle Bin.` }; });
  }

  requestApproval(text, buttonLabel, execute) {
    const id = crypto.randomUUID();
    this.pending.set(id, { execute, createdAt: Date.now() });
    return { kind: 'approval', text, buttonLabel, action: { id } };
  }

  async askAI(text) {
    const mode = this.modes.getMode();
    const systemPrompt = `${MODE_PROMPTS[mode] || MODE_PROMPTS.NORMAL} ${BASE_INSTRUCTIONS}`;
    const relevantMemory = this.memory && typeof this.memory.find === 'function'
      ? this.memory.find(text).map(x => x.note)
      : [];
    const context = relevantMemory.length
      ? `Relevant saved memories:\n${relevantMemory.map(x => `- ${x}`).join('\n')}`
      : 'No relevant saved memories.';
    const provider = this.providers && typeof this.providers.get === 'function' ? this.providers.get() : null;
    if (!provider || typeof provider.complete !== 'function') {
      return { kind: 'message', text: 'Gemini AI is not configured. Please set GEMINI_API_KEY in your .env or Settings.' };
    }

    const toolDeclarations = (this.tools && typeof this.tools.getFunctionDeclarations === 'function')
      ? this.tools.getFunctionDeclarations()
      : null;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'system', content: context },
      { role: 'user', content: text },
    ];

    let maxTurns = 5;
    while (maxTurns-- > 0) {
      let response;
      try {
        response = await provider.complete(messages, { tools: toolDeclarations });
      } catch (err) {
        if (err.message && err.message.includes('403')) {
          return {
            kind: 'message',
            text: '⚠️ **Gemini API Access Denied (403)**:\nGoogle rejected this API key (`Your project has been denied access`). This usually happens when the key was created under a restricted school/organization account or an unverified Google Cloud project.\n\n**Quick Fix:**\n1. Open [Google AI Studio](https://aistudio.google.com/app/apikey) in your browser.\n2. Sign in with a personal Google/Gmail account.\n3. Click **"Create API key"** ➔ **"Create API key in new project"**.\n4. Copy the new key (it starts with `AIzaSy...`) and paste it into JARVIS Settings (or share it here).'
          };
        }
        return { kind: 'message', text: `Gemini Error: ${err.message}` };
      }

      if (typeof response === 'string') {
        return { kind: 'message', text: response };
      }

      if (response.type === 'text') {
        return { kind: 'message', text: response.text };
      }

      if (response.type === 'function_call') {
        const functionName = response.name;
        const toolId = this.tools.toToolId ? this.tools.toToolId(functionName) : functionName.replace(/_/g, '.');
        const args = response.args || {};

        messages.push({
          role: 'model',
          functionCall: { name: functionName, args },
        });

        try {
          const execResult = await this.tools.execute(toolId, args);

          if (execResult && execResult.requiresApproval) {
            return this.requestApproval(
              `JARVIS wants to run tool "${execResult.tool}": ${execResult.summary}`,
              'Approve operation',
              async () => {
                const approvedResult = await this.tools.execute(toolId, { ...args, approved: true });
                messages.push({
                  role: 'function',
                  name: functionName,
                  response: approvedResult,
                });
                const next = await provider.complete(messages, { tools: toolDeclarations });
                return { kind: 'message', text: typeof next === 'string' ? next : next.text || 'Action completed.' };
              }
            );
          }

          messages.push({
            role: 'function',
            name: functionName,
            response: execResult,
          });
        } catch (err) {
          messages.push({
            role: 'function',
            name: functionName,
            response: { error: err.message },
          });
        }
      }
    }

    return { kind: 'message', text: 'Task completed after multiple agent iterations.' };
  }
}

module.exports = { CommandService };
