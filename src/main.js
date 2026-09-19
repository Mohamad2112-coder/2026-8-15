'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut, Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { SettingsStore }         = require('./services/settings-store');
const { MemoryStore }           = require('./services/memory-store');
const { CommandService }        = require('./services/command-service');
const { ProviderFactory }       = require('./services/providers');
const { WindowsVoiceService }   = require('./services/voice-service');
const { WindowsSpeechProvider } = require('./services/text-to-speech');
const { ToolManager, SystemMonitor } = require('./services/tool-manager');
const { FileSystemService }     = require('./services/filesystem-service');
const { ScreenService }         = require('./services/screen-service');
const { ComputerControlService } = require('./services/computer-control-service');
const { ApplicationService }    = require('./services/application-service');
const { DeveloperService }      = require('./services/developer-service');
const { BrowserService }        = require('./services/browser-service');
const { PermissionManager }     = require('./services/permission-manager');
const { PermissionLog }         = require('./services/permission-log');
const { ModeService }           = require('./services/mode-service');
const { TaskPlanner }           = require('./services/task-planner');
const { RagService }            = require('./services/rag-service');
const { ScaffoldingService }    = require('./services/scaffolding-service');
const { TaskExecutor }          = require('./services/executor');
const { CloudMemoryProvider }   = require('./services/cloud-memory');
const { ReminderService }       = require('./services/reminder-service');

let mainWindow;
let spotlightWindow = null;
let services;
let tray = null;
let isQuitting = false;

// Deliberately small .env reader so the development fallback needs no extra dependency.
function loadDevelopmentEnvironment() {
  const file = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
loadDevelopmentEnvironment();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#071019',
    title: 'JARVIS Assistant',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

function createSpotlightWindow() {
  spotlightWindow = new BrowserWindow({
    width: 680,
    height: 64,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  spotlightWindow.loadFile(path.join(__dirname, 'renderer', 'spotlight.html'));

  spotlightWindow.on('blur', () => {
    spotlightWindow?.hide();
  });
}

app.whenReady().then(() => {
  const dataDirectory    = path.join(app.getPath('userData'), 'data');
  const settings         = new SettingsStore(dataDirectory);
  const memory           = new MemoryStore(dataDirectory);
  const providers        = new ProviderFactory(settings);
  const screen           = new ScreenService();
  const computer         = new ComputerControlService();
  const applications     = new ApplicationService();
  const developer        = new DeveloperService();
  const browser          = new BrowserService();
  const permissions      = new PermissionManager();
  const permissionLog    = new PermissionLog();
  const cloudMemory      = new CloudMemoryProvider(settings);
  const modes            = new ModeService();
  const planner          = new TaskPlanner();
  const files            = new FileSystemService();
  const speech           = new WindowsSpeechProvider();
  const reminders        = new ReminderService({ speech, getWindow: () => mainWindow });
  const rag              = new RagService();
  const scaffolding      = new ScaffoldingService();
  const tools            = new ToolManager({ memory, screen, computer, applications, developer, browser, permissions, providers, files, reminders, rag, scaffolding });
  const executor         = new TaskExecutor({ planner, tools, permissions, permissionLog });
  const monitor          = new SystemMonitor();
  const voice            = new WindowsVoiceService();

  services = {
    settings, memory, tools, monitor, files, screen, computer, applications,
    developer, browser, permissions, permissionLog, cloudMemory,
    modes, planner, executor, reminders,
    command: new CommandService({ memory, providers, tools, files, modes, planner, permissionLog }),
    voice, speech,
  };

  createWindow();
  createSpotlightWindow();
  createTray();

  // ── Voice pipeline ──────────────────────────────────────────────────────────
  voice.on('command', async ({ text, source }) => {
    try {
      const explicitMode = services.modes.parseExplicitSwitch(text);
      if (explicitMode) services.modes.setMode(explicitMode);
      else {
        const detected = services.modes.detect(text);
        services.modes.setMode(detected);
      }

      const mode = services.modes.getMode();
      const isMultiStep = mode === 'AUTOMATION' || /create.*python project|organiz.*downloads?/i.test(text);
      let plan = null;
      if (isMultiStep) {
        plan = services.planner.create(text, mode);
        services.executor.run(plan, text).catch(() => {});
      }

      const result = { ...(await services.command.handle(text)), mode, modeColor: services.modes.color(mode) };
      mainWindow?.webContents.send('voice:result', { text, source, result });
      const response = result.kind === 'approval' ? 'I need your approval before running that command.' : result.text;
      speech.speak(response).catch(() => {});
    } catch (error) {
      mainWindow?.webContents.send('voice:error', error.message || 'Voice command failed.');
      speech.speak('I could not complete that request.').catch(() => {});
    }
  });

  voice.on('state', state => mainWindow?.webContents.send('voice:state', state));
  voice.on('error', error => mainWindow?.webContents.send('voice:error', error.message || 'Voice recognition is unavailable.'));
  tools.on('activity', activity => mainWindow?.webContents.send('tool:activity', activity));
  planner.on('update', plan => mainWindow?.webContents.send('task:plan', plan));

  // ── Executor events → renderer ───────────────────────────────────────────────
  executor.on('step-start',      data => mainWindow?.webContents.send('executor:event', { type: 'step-start', ...data }));
  executor.on('step-complete',   data => mainWindow?.webContents.send('executor:event', { type: 'step-complete', ...data }));
  executor.on('step-error',      data => mainWindow?.webContents.send('executor:event', { type: 'step-error', ...data }));
  executor.on('approval-needed', data => mainWindow?.webContents.send('executor:event', { type: 'approval-needed', ...data }));
  executor.on('done',            data => mainWindow?.webContents.send('executor:event', { type: 'done', ...data }));
  executor.on('cancelled',       data => mainWindow?.webContents.send('executor:event', { type: 'cancelled', ...data }));

  // ── Mode change → renderer ───────────────────────────────────────────────────
  modes.on('change', change => mainWindow?.webContents.send('mode:change', change));

  // ── Global shortcut ───────────────────────────────────────────────────────────
  globalShortcut.register('Control+Num4', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    voice.captureOne();
  });

  globalShortcut.register('Alt+Space', () => {
    if (!spotlightWindow || spotlightWindow.isDestroyed()) createSpotlightWindow();
    if (spotlightWindow.isVisible()) {
      spotlightWindow.hide();
    } else {
      spotlightWindow.show();
      spotlightWindow.focus();
      spotlightWindow.webContents.send('spotlight:focus');
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('ORION JARVIS Assistant (Running in background)');

  function updateMenu() {
    const isListening = services?.voice?.listening || false;
    const isVisible = mainWindow && mainWindow.isVisible();
    const contextMenu = Menu.buildFromTemplate([
      {
        label: isVisible ? 'Hide ORION' : 'Open ORION',
        click: () => {
          if (isVisible) {
            mainWindow?.hide();
          } else {
            mainWindow?.show();
            mainWindow?.focus();
          }
        },
      },
      {
        label: isListening ? 'Disable Voice Listening' : 'Enable Voice Listening',
        click: () => {
          if (isListening) {
            services?.voice.stop();
          } else {
            services?.voice.start();
          }
          updateMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'Settings',
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
          mainWindow?.webContents.send('navigation:go', 'settings');
        },
      },
      { type: 'separator' },
      {
        label: 'Quit ORION',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  }

  updateMenu();

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
    updateMenu();
  });

  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    updateMenu();
  });
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  services?.voice.stop();
  services?.speech.stop();
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') app.quit();
});

// ── IPC: core assistant ───────────────────────────────────────────────────────
ipcMain.handle('assistant:submit', async (_event, text) => {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error('Enter a request first.');
  const request = text.trim();

  // Mode resolution
  const explicitMode = services.modes.parseExplicitSwitch(request);
  if (explicitMode) services.modes.setMode(explicitMode);
  else services.modes.setMode(services.modes.detect(request));

  const mode = services.modes.getMode();

  // Auto-plan for multi-step tasks
  const isMultiStep = mode === 'AUTOMATION' || /create.*python project|organiz.*downloads?/i.test(request);
  if (isMultiStep) {
    const plan = services.planner.create(request, mode);
    services.executor.run(plan, request).catch(() => {});
  }

  return {
    ...(await services.command.handle(request)),
    mode,
    modeColor: services.modes.color(mode),
  };
});

ipcMain.handle('assistant:approve', async (_event, action) => services.command.executeApproved(action));

// ── IPC: settings ─────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => services.settings.getPublic());
ipcMain.handle('settings:save', (_event, s) => services.settings.save(s));

// ── IPC: long-term memory ────────────────────────────────────────────────────
ipcMain.handle('memory:list',   () => services.memory.list());
ipcMain.handle('memory:remove', (_event, id) => services.memory.remove(id));
ipcMain.handle('memory:clear',  () => services.memory.clear());

// ── IPC: short-term memory ────────────────────────────────────────────────────
ipcMain.handle('memory:add-short-term',  (_event, note) => services.memory.addShortTerm(note));
ipcMain.handle('memory:list-short-term', () => services.memory.getShortTerm());
ipcMain.handle('memory:clear-short-term', () => { services.memory.clearShortTerm(); return true; });

// ── IPC: executor ─────────────────────────────────────────────────────────────
ipcMain.handle('executor:approve-step', (_event, { planId, stepIndex }) => {
  services.executor.approveStep(planId, stepIndex);
  return { ok: true };
});
ipcMain.handle('executor:cancel', (_event, planId) => {
  services.executor.cancel(planId);
  return { ok: true };
});

// ── IPC: modes ────────────────────────────────────────────────────────────────
ipcMain.handle('mode:set', (_event, mode) => {
  const ok = services.modes.setMode(mode);
  return ok ? { mode: services.modes.getMode(), color: services.modes.color(mode) } : { error: 'Unknown mode.' };
});
ipcMain.handle('mode:get', () => ({
  mode:  services.modes.getMode(),
  color: services.modes.color(services.modes.getMode()),
}));

// ── IPC: permission log ───────────────────────────────────────────────────────
ipcMain.handle('permission:log', () => services.permissionLog.list());

// ── IPC: misc ─────────────────────────────────────────────────────────────────
ipcMain.handle('dialog:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('shell:open-external', async (_event, url) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only HTTP(S) links may be opened.');
  await shell.openExternal(url);
});
ipcMain.handle('voice:set-listening', (_event, enabled) => {
  if (enabled) services.voice.start(); else services.voice.stop();
  return { listening: Boolean(enabled), captureMode: false };
});
ipcMain.handle('voice:get-state', () => ({ listening: services.voice.listening, captureMode: services.voice.captureMode }));
ipcMain.handle('system:snapshot', () => services.monitor.snapshot());
ipcMain.handle('tools:list', () => services.tools.list());

// ── IPC: Spotlight HUD ────────────────────────────────────────────────────────
ipcMain.handle('spotlight:close', () => {
  spotlightWindow?.hide();
  return { ok: true };
});
ipcMain.handle('spotlight:expand', (_event, height) => {
  if (spotlightWindow && typeof height === 'number') {
    spotlightWindow.setSize(680, Math.min(450, Math.max(64, height)));
  }
  return { ok: true };
});
