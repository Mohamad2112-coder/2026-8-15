const fs = require('fs');
const { EventEmitter } = require('events');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { shell } = require('electron');
const execFileAsync = promisify(execFile);

class ToolManager extends EventEmitter {
  constructor({ memory, screen, computer, applications, developer, browser, permissions, providers, files, reminders, rag, scaffolding }) {
    super();
    this.memory = memory;
    this.screen = screen;
    this.computer = computer;
    this.applications = applications;
    this.developer = developer;
    this.browser = browser;
    this.permissions = permissions;
    this.providers = providers;
    this.files = files;
    this.reminders = reminders;
    this.rag = rag;
    this.scaffolding = scaffolding;
    this.tools = new Map();
    this.registerBuiltIns();
  }
  register(tool) { this.tools.set(tool.id, tool); }
  list() { return [...this.tools.values()].map(({ id, label, risk }) => ({ id, label, risk })); }
  async execute(id, input = {}) {
    const tool = this.tools.get(id);
    if (!tool) throw new Error(`Tool "${id}" is not available.`);
    if (!this.permissions.canExecute(id, input.approved)) return { requiresApproval: true, tool: id, level: this.permissions.levelFor(id), summary: tool.describe(input) };
    this.emit('activity', { phase: 'running', tool: tool.label, summary: tool.describe(input) });
    try { const result = await tool.execute(input); this.emit('activity', { phase: 'complete', tool: tool.label, summary: result.summary }); return result; }
    catch (error) { this.emit('activity', { phase: 'error', tool: tool.label, summary: error.message }); throw error; }
  }
  registerBuiltIns() {
    this.register({ id: 'folder.open', label: 'Folder Tool', risk: 'safe', describe: ({ folder }) => `Open ${folder}`, execute: async ({ folder }) => { await shell.openPath(folder); return { summary: `Opened ${folder}.` }; } });
    this.register({ id: 'folder.create', label: 'Folder Tool', risk: 'safe', describe: ({ folder }) => `Create ${folder}`, execute: async ({ folder }) => { fs.mkdirSync(folder, { recursive: true }); return { summary: `Created ${folder}.` }; } });
    this.register({ id: 'file.search', label: 'File Tool', risk: 'safe', describe: ({ root, query, extension }) => `Search ${extension || query || 'files'} in ${root || 'Downloads'}`, execute: async ({ root, query, extension, content, limit }) => {
      if (!this.files) return { summary: `File search completed (simulated).`, files: [] };
      const searchRoot = root || path.join(os.homedir(), 'Downloads');
      const files = await this.files.search({ root: searchRoot, query: query || '', extension, content, limit: limit || 50 });
      return { summary: `Found ${files.length} matching file${files.length === 1 ? '' : 's'}.`, files };
    } });
    this.register({ id: 'file.read', label: 'File Tool', risk: 'safe', describe: ({ path: targetPath }) => `Read file: ${targetPath}`, execute: async ({ path: targetPath }) => {
      if (!this.files || !targetPath) throw new Error('Specify path to read.');
      if (targetPath.toLowerCase().endsWith('.pdf')) {
        const text = await this.files.readPdf(targetPath);
        return { summary: `Read PDF "${path.basename(targetPath)}"`, content: text.slice(0, 10000) };
      }
      const text = this.files.readText(targetPath);
      return { summary: `Read file "${path.basename(targetPath)}"`, content: text.slice(0, 10000) };
    } });
    this.register({ id: 'application.launch', label: 'Application Tool', risk: 'safe', describe: ({ app }) => `Launch ${app}`, execute: async ({ app }) => { const launched = await this.applications.launch(app); return { summary: `Launched ${launched.label}.` }; } });
    this.register({ id: 'application.detect', label: 'Application Tool', risk: 'safe', describe: () => 'Detect installed supported applications', execute: async () => ({ summary: 'Application inventory refreshed.', applications: await this.applications.inventory() }) });
    this.register({ id: 'browser.search', label: 'Browser Tool', risk: 'safe', describe: ({ query }) => `Search web for ${query}`, execute: async ({ query }) => this.browser.search(query) });
    this.register({ id: 'browser.read', label: 'Browser Tool', risk: 'safe', describe: ({ url }) => `Read ${url}`, execute: async ({ url }) => { const page = await this.browser.read(url); return { summary: `Read ${page.title}.`, page }; } });
    this.register({ id: 'browser.download', label: 'Browser Tool', risk: 'approval', describe: ({ url }) => `Download ${url}`, execute: async () => { throw new Error('Downloads require a reviewed destination workflow.'); } });
    this.register({ id: 'browser.form', label: 'Browser Tool', risk: 'approval', describe: () => 'Submit a web form', execute: async () => { throw new Error('Form automation requires a domain-specific reviewed workflow.'); } });
    this.register({ id: 'developer.detect', label: 'Code Tool', risk: 'safe', describe: () => 'Detect development tools', execute: async () => ({ summary: 'Development environment checked.', tools: await this.developer.detect() }) });
    this.register({ id: 'developer.run', label: 'Code Tool', risk: 'approval', describe: ({ command }) => `Run development command: ${command}`, execute: async ({ command, args, cwd }) => this.developer.run(command, args, cwd) });
    this.register({ id: 'screen.clip', label: 'Screenshot Tool', risk: 'safe', describe: () => 'Open Windows screen capture', execute: async () => { await execFileAsync('explorer.exe', ['ms-screenclip:']); return { summary: 'Screen capture is ready.' }; } });
    this.register({ id: 'screen.capture', label: 'Screen Tool', risk: 'safe', describe: () => 'Capture the current screen', execute: async () => ({ summary: 'Captured the current screen.', path: await this.screen.capture() }) });
    this.register({ id: 'screen.analyze', label: 'Vision Tool', risk: 'safe', describe: ({ prompt }) => prompt ? `Analyze screen: ${prompt}` : 'Analyze screen contents', execute: async ({ prompt }) => {
      const provider = this.providers ? this.providers.get() : null;
      const res = await this.screen.analyze(prompt, provider);
      return { summary: 'Screen analyzed with Gemini Vision.', ...res };
    } });
    this.register({ id: 'memory.save', label: 'Memory Tool', risk: 'safe', describe: ({ note }) => 'Save a memory', execute: async ({ note, category, tags }) => { const m = this.memory.add(note, category, tags); return { summary: `Saved: ${m.note}` }; } });
    this.register({
      id: 'reminder.create',
      label: 'Reminder Tool',
      risk: 'safe',
      describe: ({ message, timeText }) => `Set reminder "${message}" ${timeText || ''}`,
      execute: async ({ message, delayMs, timeText }) => {
        if (!this.reminders) return { summary: 'Reminder service unavailable.' };
        let delay = delayMs;
        if (!delay && timeText) delay = this.reminders.parseDelay(timeText);
        if (!delay) throw new Error('Specify a valid delay (e.g. in 5 minutes, in 30 seconds).');
        return this.reminders.schedule(message, delay);
      }
    });
    this.register({
      id: 'reminder.list',
      label: 'Reminder Tool',
      risk: 'safe',
      describe: () => 'List active reminders',
      execute: async () => {
        if (!this.reminders) return { summary: 'Reminder service unavailable.', reminders: [] };
        const list = this.reminders.list();
        return { summary: `You have ${list.length} active reminder(s).`, reminders: list };
      }
    });
    this.register({ id: 'terminal.powershell', label: 'Terminal Tool', risk: 'approval', describe: () => 'Run a PowerShell command', execute: async ({ command }) => {
      const { stdout, stderr } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 });
      return { summary: 'PowerShell command completed.', output: `${stdout}${stderr}`.trim() };
    } });
    this.register({ id: 'computer.click_target', label: 'Computer Tool', risk: 'approval', describe: ({ targetDescription }) => `Click ${targetDescription} on screen`, execute: input => this.computer.clickTarget(input.targetDescription, this.screen, this.providers.get()) });
    this.register({ id: 'rag.search', label: 'RAG Tool', risk: 'safe', describe: ({ query }) => `Search local documents for: ${query}`, execute: input => ({ summary: 'Search completed.', results: this.rag.search(input.query) }) });
    this.register({ id: 'rag.answer', label: 'RAG Tool', risk: 'safe', describe: ({ query }) => `Answer using local documents: ${query}`, execute: input => this.rag.answer(input.query, this.providers.get()) });
    this.register({ id: 'project.scaffold', label: 'Scaffold Tool', risk: 'approval', describe: ({ name, template }) => `Scaffold project ${name} (${template || 'auto'})`, execute: input => this.scaffolding.scaffold(input) });
    this.register({ id: 'project.git_init', label: 'Git Tool', risk: 'approval', describe: ({ projectDir }) => `Init git repository in ${projectDir}`, execute: async input => {
      const { execFile } = require('child_process'); const { promisify } = require('util'); const execFileAsync = promisify(execFile);
      await execFileAsync('git', ['init'], { cwd: input.projectDir, windowsHide: true });
      await execFileAsync('git', ['add', '.'], { cwd: input.projectDir, windowsHide: true });
      await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: input.projectDir, windowsHide: true });
      return { summary: 'Initialized git repository and created initial commit.' };
    } });
    this.register({ id: 'keyboard.type', label: 'Keyboard Tool', risk: 'approval', describe: () => 'Type into the active application', execute: input => this.computer.type(input.text) });
    this.register({ id: 'keyboard.press', label: 'Keyboard Tool', risk: 'approval', describe: () => 'Send a keyboard shortcut to the active application', execute: input => this.computer.press(input.keys) });
    this.register({ id: 'mouse.click', label: 'Mouse Tool', risk: 'approval', describe: ({ x, y }) => `Click at screen coordinate ${x}, ${y}`, execute: input => this.computer.click(input.x, input.y, input.button, input.double) });
    ['code', 'clipboard', 'process', 'system'].forEach(id => this.register({ id: `${id}.planned`, label: `${id[0].toUpperCase() + id.slice(1)} Tool`, risk: 'approval', describe: () => `${id} operation`, execute: async () => { throw new Error(`${id} automation is not enabled yet.`); } }));
  }

  /**
   * Gemini function declarations schema for built-in tools.
   */
  getFunctionDeclarations() {
    return [
      {
        name: 'computer_click_target',
        description: 'Visually analyze the screen and click on a specific element described in natural language.',
        parameters: { type: 'OBJECT', properties: { targetDescription: { type: 'STRING', description: 'What to click, e.g. "the blue OK button" or "the search bar"' } }, required: ['targetDescription'] },
      },
      {
        name: 'rag_search',
        description: 'Search local documents (Desktop, Documents, Downloads) for semantic context.',
        parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'The search query or question.' } }, required: ['query'] },
      },
      {
        name: 'rag_answer',
        description: 'Answer a question using only information from local documents (Desktop, Documents, Downloads).',
        parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'The question to answer.' } }, required: ['query'] },
      },
      {
        name: 'project_scaffold',
        description: 'Generate a new full code project structure.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Project name.' },
            template: { type: 'STRING', description: 'Optional template (e.g. node-express, python-flask, react-tailwind, html-starter). If omitted, inferred from name/description.' },
            destination: { type: 'STRING', description: 'Absolute path to parent directory. Defaults to Desktop.' }
          },
          required: ['name']
        },
      },
      {
        name: 'project_git_init',
        description: 'Initialize a new git repository in a directory, add all files, and make an initial commit.',
        parameters: { type: 'OBJECT', properties: { projectDir: { type: 'STRING', description: 'Absolute path to the project directory.' } }, required: ['projectDir'] },
      },
      {
        name: 'file_search',
        description: 'Search files recursively by query, extension, or root directory.',
        parameters: {
          type: 'OBJECT',
          properties: {
            root: { type: 'STRING', description: 'Directory to search within (e.g. C:/Users/AMUN/Downloads or Desktop).' },
            extension: { type: 'STRING', description: 'Optional file extension filter, e.g. .pdf, .py, .js' },
            query: { type: 'STRING', description: 'Optional filename keyword to search for' },
          },
        },
      },
      {
        name: 'file_read',
        description: 'Read the contents of a local text or PDF file on disk.',
        parameters: {
          type: 'OBJECT',
          properties: {
            path: { type: 'STRING', description: 'Absolute or relative file path to read.' },
          },
          required: ['path'],
        },
      },
      {
        name: 'folder_open',
        description: 'Open a local folder in Windows File Explorer.',
        parameters: {
          type: 'OBJECT',
          properties: {
            folder: { type: 'STRING', description: 'Path to folder to open.' },
          },
          required: ['folder'],
        },
      },
      {
        name: 'folder_create',
        description: 'Create a directory on the filesystem.',
        parameters: {
          type: 'OBJECT',
          properties: {
            folder: { type: 'STRING', description: 'Path to folder to create.' },
          },
          required: ['folder'],
        },
      },
      {
        name: 'application_launch',
        description: 'Launch an installed application (e.g. notepad, chrome, vscode, calculator, spotify).',
        parameters: {
          type: 'OBJECT',
          properties: {
            app: { type: 'STRING', description: 'Application name or alias.' },
          },
          required: ['app'],
        },
      },
      {
        name: 'application_detect',
        description: 'List installed applications known to JARVIS on this PC.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'browser_search',
        description: 'Search the web using the default web browser.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Web search query.' },
          },
          required: ['query'],
        },
      },
      {
        name: 'browser_read',
        description: 'Fetch and extract textual markdown content from a public webpage URL.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Full HTTP or HTTPS web URL to read.' },
          },
          required: ['url'],
        },
      },
      {
        name: 'screen_capture',
        description: 'Take a screenshot of the user screen.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'screen_analyze',
        description: 'Capture the screen and visually analyze it with Gemini Vision.',
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: { type: 'STRING', description: 'What specific detail or error to look for on the screen.' },
          },
        },
      },
      {
        name: 'memory_save',
        description: 'Save an important user preference, fact, or workflow to persistent local memory.',
        parameters: {
          type: 'OBJECT',
          properties: {
            note: { type: 'STRING', description: 'The memory note to record.' },
            category: { type: 'STRING', description: 'Category: preference, workflow, task, or fact.' },
          },
          required: ['note'],
        },
      },
      {
        name: 'developer_detect',
        description: 'Detect availability and versions of development tools (Node, Python, Git, npm, PowerShell).',
        parameters: { type: 'OBJECT', properties: {} },
      },
      {
        name: 'developer_run',
        description: 'Run a developer command (e.g. python, node, git). Requires user approval.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: { type: 'STRING', description: 'The command binary to execute.' },
            args: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Arguments array.' },
            cwd: { type: 'STRING', description: 'Working directory.' },
          },
          required: ['command'],
        },
      },
      {
        name: 'terminal_powershell',
        description: 'Execute a PowerShell script or command. Requires user approval.',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: { type: 'STRING', description: 'The exact PowerShell command line to execute.' },
          },
          required: ['command'],
        },
      },
      {
        name: 'reminder_create',
        description: 'Set a timed reminder or alarm that notifies the user via Windows toast and voice.',
        parameters: {
          type: 'OBJECT',
          properties: {
            message: { type: 'STRING', description: 'What to remind the user about.' },
            timeText: { type: 'STRING', description: 'Relative time delay, e.g. "in 5 minutes", "in 30 seconds", "in 1 hour".' },
          },
          required: ['message', 'timeText'],
        },
      },
      {
        name: 'reminder_list',
        description: 'List all currently active scheduled reminders.',
        parameters: { type: 'OBJECT', properties: {} },
      },
    ];
  }

  /** Convert a Gemini function name (snake_case) to Tool ID (dot.case) */
  toToolId(functionName) {
    return functionName.replace(/_/g, '.');
  }

  /** Convert a Tool ID (dot.case) to Gemini function name (snake_case) */
  toFunctionName(toolId) {
    return toolId.replace(/\./g, '_');
  }
}

class SystemMonitor {
  constructor() { this.previousCpu = os.cpus(); }
  snapshot() {
    const current = os.cpus(); let idle = 0; let total = 0;
    current.forEach((cpu, index) => { const before = this.previousCpu[index]?.times || cpu.times; Object.keys(cpu.times).forEach(key => { total += cpu.times[key] - before[key]; }); idle += cpu.times.idle - before.idle; });
    this.previousCpu = current;
    const ramUsed = 1 - os.freemem() / os.totalmem();
    let disk = null;
    try { const stats = fs.statfsSync(path.parse(process.cwd()).root); disk = 1 - stats.bavail / stats.blocks; } catch { /* unavailable on an older Node runtime */ }
    return { cpu: total ? Math.round((1 - idle / total) * 100) : 0, ram: Math.round(ramUsed * 100), disk: disk === null ? null : Math.round(disk * 100), network: 'Ready' };
  }
}
module.exports = { ToolManager, SystemMonitor };
