'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orion', {
  // ── Core assistant ──────────────────────────────────────────────────────────
  submit:  (text)     => ipcRenderer.invoke('assistant:submit', text),
  approve: (action)   => ipcRenderer.invoke('assistant:approve', action),

  // ── Settings ────────────────────────────────────────────────────────────────
  getSettings:  ()         => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // ── Long-term memory ────────────────────────────────────────────────────────
  listMemory:   ()   => ipcRenderer.invoke('memory:list'),
  removeMemory: (id) => ipcRenderer.invoke('memory:remove', id),
  clearMemory:  ()   => ipcRenderer.invoke('memory:clear'),

  // ── Short-term (session) memory ─────────────────────────────────────────────
  addShortTermMemory:   (note) => ipcRenderer.invoke('memory:add-short-term', note),
  listShortTermMemory:  ()     => ipcRenderer.invoke('memory:list-short-term'),
  clearShortTermMemory: ()     => ipcRenderer.invoke('memory:clear-short-term'),

  // ── Executor ─────────────────────────────────────────────────────────────────
  approveStep:     ({ planId, stepIndex }) => ipcRenderer.invoke('executor:approve-step', { planId, stepIndex }),
  cancelExecution: (planId)                => ipcRenderer.invoke('executor:cancel', planId),
  onExecutorEvent: (callback)              => ipcRenderer.on('executor:event', (_event, value) => callback(value)),

  // ── Modes ─────────────────────────────────────────────────────────────────────
  setMode: (mode) => ipcRenderer.invoke('mode:set', mode),
  getMode: ()     => ipcRenderer.invoke('mode:get'),
  onModeChange: (callback) => ipcRenderer.on('mode:change', (_event, value) => callback(value)),

  // ── Permission log ────────────────────────────────────────────────────────────
  getPermissionLog: () => ipcRenderer.invoke('permission:log'),

  // ── System ───────────────────────────────────────────────────────────────────
  chooseDirectory:   ()    => ipcRenderer.invoke('dialog:choose-directory'),
  openExternal:      (url) => ipcRenderer.invoke('shell:open-external', url),
  getSystemSnapshot: ()    => ipcRenderer.invoke('system:snapshot'),
  listTools:         ()    => ipcRenderer.invoke('tools:list'),

  // ── Voice ─────────────────────────────────────────────────────────────────────
  setListening:   (enabled)  => ipcRenderer.invoke('voice:set-listening', enabled),
  getVoiceState:  ()         => ipcRenderer.invoke('voice:get-state'),
  onVoiceResult:  (callback) => ipcRenderer.on('voice:result',   (_event, value) => callback(value)),
  onVoiceState:   (callback) => ipcRenderer.on('voice:state',    (_event, value) => callback(value)),
  onVoiceError:   (callback) => ipcRenderer.on('voice:error',    (_event, value) => callback(value)),
  onToolActivity: (callback) => ipcRenderer.on('tool:activity',  (_event, value) => callback(value)),
  onTaskPlan:     (callback) => ipcRenderer.on('task:plan',      (_event, value) => callback(value)),
  onNavigate:     (callback) => ipcRenderer.on('navigation:go',  (_event, value) => callback(value)),

  // ── Spotlight HUD ─────────────────────────────────────────────────────────────
  spotlightClose:   ()         => ipcRenderer.invoke('spotlight:close'),
  spotlightExpand:  (height)   => ipcRenderer.invoke('spotlight:expand', height),
  onSpotlightFocus: (callback) => ipcRenderer.on('spotlight:focus', (_event) => callback()),
});
