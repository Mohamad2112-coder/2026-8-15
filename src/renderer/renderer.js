'use strict';

// ── Utilities ─────────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

// ── Active executor plan state (for approval gates) ───────────────────────────
let _activePlan = null;
let _blockedStep = null;

// ── Conversation ─────────────────────────────────────────────────────────────
function addMessage(sender, text, extraClass = '') {
  const node = $('#message-template').content.firstElementChild.cloneNode(true);
  node.classList.add(sender === 'YOU' || sender === 'VOICE' ? 'user' : 'assistant', extraClass);
  node.querySelector('.sender').textContent = sender;
  node.querySelector('p').textContent = text;
  const conversation = $('#conversation');
  conversation.append(node);
  conversation.scrollTop = conversation.scrollHeight;
  return node;
}

function addFiles(result) {
  const node = addMessage('JARVIS', result.text);
  const list = document.createElement('div');
  list.className = 'files';
  result.files.forEach(file => {
    const button = document.createElement('button');
    button.textContent = file.name;
    button.title = file.path;
    button.onclick = () => submit(`Run PowerShell: Invoke-Item -LiteralPath '${file.path.replace(/'/g, "''")}'`);
    list.append(button);
  });
  node.append(list);
}

function renderResult(result) {
  if (result.kind === 'approval') {
    const node = addMessage('JARVIS', result.text, 'approval');
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = result.buttonLabel || 'Confirm';
    button.onclick = async () => {
      button.disabled = true;
      try { renderResult(await window.orion.approve(result.action)); }
      catch (error) { addMessage('JARVIS', error.message || 'The command failed.'); }
    };
    node.append(button);
  } else if (result.kind === 'files') {
    addFiles(result);
  } else if (result.kind === 'screen') {
    const node = addMessage('JARVIS', result.text);
    const img = document.createElement('img');
    img.className = 'screen-preview';
    img.style.cssText = 'display:block;width:min(100%,520px);max-height:260px;object-fit:contain;margin-top:12px;border:1px solid #4fdde7;background:#02070c';
    img.src = result.path;
    img.alt = 'Captured screen';
    node.append(img);
  } else {
    addMessage('JARVIS', result.text);
  }
}

// ── Agent state ───────────────────────────────────────────────────────────────
function setAgentState(state, detail) {
  const core = $('#core');
  core.className = `core ${state}`;
  $('#core-state').textContent = state.toUpperCase();
  $('#core-detail').textContent = detail;
}

// ── Mode badge ────────────────────────────────────────────────────────────────
function updateModeBadge(mode, color) {
  const label = $('#mode-label');
  const dot   = $('#mode-dot');
  const badge = $('#mode-badge');
  if (!label || !mode) return;
  label.textContent = `${mode} MODE`;
  const c = color || '#4fdde7';
  dot.style.background   = c;
  dot.style.boxShadow    = `0 0 8px ${c}`;
  badge.style.borderColor = c;
  badge.style.color       = c;
}

// ── Task plan UI ──────────────────────────────────────────────────────────────
const STEP_ICONS = { complete: '✓', active: '→', pending: '○', blocked: '⊘', skipped: '–', error: '✗' };
const LEVEL_COLORS = { SAFE: '#4fdde7', MODERATE: '#278cb7', DANGEROUS: '#ffd26b', CRITICAL: '#ef6a75' };

function renderPlan(plan) {
  if (!plan) return;
  _activePlan = plan;

  $('#task-name').textContent = plan.title;
  const stepsEl = $('#plan-steps');
  stepsEl.classList.remove('hidden');
  stepsEl.replaceChildren();

  plan.steps.forEach((step, i) => {
    const li = document.createElement('li');
    li.className = `plan-step ${step.status}`;
    li.dataset.index = i;

    const icon = document.createElement('span');
    icon.className = 'step-icon';
    icon.textContent = STEP_ICONS[step.status] || '○';

    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = step.label;

    const badge = document.createElement('span');
    badge.className = 'step-level';
    badge.textContent = step.level;
    badge.style.color = LEVEL_COLORS[step.level] || LEVEL_COLORS.SAFE;

    li.append(icon, label, badge);
    stepsEl.append(li);
  });

  // Update simple status line
  const active = plan.steps.find(s => s.status === 'active');
  const blocked = plan.steps.find(s => s.status === 'blocked');
  $('#task-status').textContent = blocked ? 'Awaiting your approval' : active ? `Running: ${active.label}` : 'Task complete';
}

// ── Executor approval banner ──────────────────────────────────────────────────
function showExecutorApproval(data) {
  _blockedStep = data;
  const banner = $('#executor-approval');
  $('#executor-approval-msg').textContent = data.message || `Step "${data.step?.label}" requires your approval.`;
  banner.classList.remove('hidden');
}

function hideExecutorApproval() {
  $('#executor-approval').classList.add('hidden');
  _blockedStep = null;
}

$('#executor-approve-btn')?.addEventListener('click', async () => {
  if (!_blockedStep || !_activePlan) return;
  $('#executor-approve-btn').disabled = true;
  try {
    await window.orion.approveStep({ planId: _blockedStep.planId, stepIndex: _blockedStep.index });
    hideExecutorApproval();
  } catch (e) {
    addMessage('JARVIS', e.message || 'Could not approve the step.');
  } finally {
    $('#executor-approve-btn').disabled = false;
  }
});

$('#executor-cancel-btn')?.addEventListener('click', async () => {
  if (!_activePlan) return;
  await window.orion.cancelExecution(_activePlan.id);
  hideExecutorApproval();
  addMessage('JARVIS', 'Task cancelled.');
  setAgentState('idle', 'Standing by for your instruction.');
});

// ── Submit command ────────────────────────────────────────────────────────────
async function submit(text) {
  if (!text.trim()) return;
  addMessage('YOU', text);
  $('#command').value = '';
  $('#status').textContent = 'Thinking…';
  setAgentState('thinking', 'Reasoning about the safest next action.');

  try {
    const result = await window.orion.submit(text);
    renderResult(result);
    if (result.mode) updateModeBadge(result.mode, result.modeColor);
    setAgentState('idle', 'Standing by for your instruction.');
  } catch (error) {
    addMessage('JARVIS', error.message || 'I could not complete that request.');
    setAgentState('error', 'An error needs your attention.');
  } finally {
    $('#status').textContent = 'System online';
  }
}

// ── Voice state ───────────────────────────────────────────────────────────────
function updateVoiceState(state) {
  $('#listening-toggle').classList.toggle('listening', state.listening);
  $('#listening-toggle').textContent = state.listening ? 'Disable local listening' : 'Enable local listening';
  $('#voice-status').textContent = state.captureMode ? 'Listening for command' : state.listening ? 'Wake word active' : 'Microphone off';
  $('#mic-dot').style.background = state.listening ? 'var(--green)' : '#667b85';
  setAgentState(
    state.listening ? 'listening' : 'idle',
    state.captureMode ? 'Listening for your command.' : state.listening ? 'Wake-word detector is active locally.' : 'Standing by for your instruction.'
  );
}

// ── Memory panel ──────────────────────────────────────────────────────────────
const CATEGORY_LABELS = { fact: 'Fact', preference: 'Preference', workflow: 'Workflow', task: 'Task' };
const CATEGORY_COLORS = { fact: '#4fdde7', preference: '#65e9a4', workflow: '#ffd26b', task: '#9b8cff' };

function buildMemoryItem(item, onDelete) {
  const el = document.createElement('article');
  el.className = 'memory';
  el.dataset.note = (item.note || '').toLowerCase();

  const topRow = document.createElement('div');
  topRow.className = 'memory-top';

  if (item.category) {
    const cat = document.createElement('span');
    cat.className = 'memory-cat';
    cat.textContent = CATEGORY_LABELS[item.category] || item.category;
    cat.style.color = CATEGORY_COLORS[item.category] || '#4fdde7';
    topRow.append(cat);
  }
  if (item.sensitive) {
    const flag = document.createElement('span');
    flag.className = 'memory-sensitive';
    flag.textContent = 'sensitive';
    topRow.append(flag);
  }

  const noteEl = document.createElement('p');
  noteEl.className = 'memory-note';
  noteEl.textContent = item.note;

  const bottomRow = document.createElement('div');
  bottomRow.className = 'memory-bottom';

  if (item.createdAt) {
    const date = document.createElement('span');
    date.className = 'memory-date';
    date.textContent = new Date(item.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
    bottomRow.append(date);
  }

  if (onDelete) {
    const del = document.createElement('button');
    del.className = 'memory-delete';
    del.textContent = 'Forget';
    del.onclick = onDelete;
    bottomRow.append(del);
  }

  el.append(topRow, noteEl, bottomRow);
  return el;
}

async function loadMemory() {
  // Short-term
  const session = await window.orion.listShortTermMemory();
  const shortEl = $('#short-term-list');
  shortEl.replaceChildren(
    ...(session.length
      ? session.map(x => buildMemoryItem({ ...x, category: 'task' }, null))
      : [Object.assign(document.createElement('p'), { className: 'memory-empty', textContent: 'No session memories yet.' })])
  );

  // Long-term
  const items = await window.orion.listMemory();
  renderMemoryList(items);
}

function renderMemoryList(items, filter = '') {
  const listEl = $('#memory-list');
  const filtered = filter
    ? items.filter(x => x.note.toLowerCase().includes(filter))
    : items;

  listEl.replaceChildren(
    ...(filtered.length
      ? filtered.map(x =>
          buildMemoryItem(x, async () => {
            await window.orion.removeMemory(x.id);
            loadMemory();
          })
        )
      : [Object.assign(document.createElement('p'), { className: 'memory-empty', textContent: filter ? 'No matching memories.' : 'No saved memories yet.' })])
  );
}

// Memory search
$('#memory-search')?.addEventListener('input', async e => {
  const q = e.target.value.trim().toLowerCase();
  const items = await window.orion.listMemory();
  renderMemoryList(items, q);
});

// Delete all
$('#clear-all-memory-btn')?.addEventListener('click', async () => {
  if (!confirm('Delete ALL saved memories? This cannot be undone.')) return;
  await window.orion.clearMemory();
  loadMemory();
});

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await window.orion.getSettings();
  $('#model').value = s.model;
  $('#base-url').value = s.baseUrl;
  $('#key-status').textContent = s.hasApiKey
    ? 'An optional model API key is securely configured.'
    : 'No model API key configured. Local commands remain available.';
  if ($('#cloud-memory')) $('#cloud-memory').checked = !!s.cloudMemory;
}

$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const cloudMemory = $('#cloud-memory')?.checked || false;
    const s = await window.orion.saveSettings({
      apiKey: $('#api-key').value,
      model:  $('#model').value,
      baseUrl: $('#base-url').value,
      cloudMemory,
    });
    $('#api-key').value = '';
    $('#key-status').textContent = s.hasApiKey ? 'Settings securely saved.' : 'Settings saved; no key configured.';
  } catch (err) {
    $('#key-status').textContent = err.message;
  }
});

// ── Panel navigation ──────────────────────────────────────────────────────────
document.querySelectorAll('.nav').forEach(button => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('.nav,.panel').forEach(x => x.classList.remove('active'));
    button.classList.add('active');
    $(`#${button.dataset.panel}`).classList.add('active');
    if (button.dataset.panel === 'settings') loadSettings();
    if (button.dataset.panel === 'memory')   loadMemory();
  });
});

window.orion.onNavigate?.(panel => {
  document.querySelectorAll('.nav,.panel').forEach(x => x.classList.remove('active'));
  const btn = document.querySelector(`.nav[data-panel="${panel}"]`);
  if (btn) btn.classList.add('active');
  const p = $(`#${panel}`);
  if (p) p.classList.add('active');
  if (panel === 'settings') loadSettings();
  if (panel === 'memory')   loadMemory();
});

// ── Command form ──────────────────────────────────────────────────────────────
$('#command-form').addEventListener('submit', event => {
  event.preventDefault();
  submit($('#command').value);
});
$('#command').addEventListener('input', event => {
  event.target.style.height = 'auto';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
});

// ── Listening toggle ──────────────────────────────────────────────────────────
$('#listening-toggle').addEventListener('click', async () => {
  const newState = await window.orion.setListening(!$('#listening-toggle').classList.contains('listening'));
  updateVoiceState(newState);
});

// ── IPC subscriptions ─────────────────────────────────────────────────────────
window.orion.onVoiceResult(({ text, result }) => {
  addMessage('VOICE', text);
  renderResult(result);
  if (result.mode) updateModeBadge(result.mode, result.modeColor);
  setAgentState('speaking', 'Delivering a concise response.');
  setTimeout(() => setAgentState('idle', 'Standing by for your instruction.'), 1100);
});
window.orion.onVoiceState(updateVoiceState);
window.orion.onVoiceError(message => {
  addMessage('JARVIS', `Voice service: ${message}`);
  updateVoiceState({ listening: false, captureMode: false });
  setAgentState('error', message);
});

window.orion.onToolActivity(activity => {
  const area = $('#tool-activity');
  if (area.classList.contains('activity-empty')) area.replaceChildren();
  area.classList.remove('activity-empty');
  const entry = document.createElement('div');
  entry.className = `activity-entry ${activity.phase === 'error' ? 'error' : ''}`;
  const title = document.createElement('strong');
  title.textContent = activity.tool;
  entry.append(title, document.createTextNode(activity.summary));
  area.prepend(entry);
  while (area.children.length > 3) area.lastElementChild.remove();
  if (activity.phase === 'running') setAgentState('executing', activity.summary);
});

window.orion.onTaskPlan(plan => {
  renderPlan(plan);
});

window.orion.onExecutorEvent(evt => {
  if (evt.type === 'approval-needed') {
    showExecutorApproval(evt);
    setAgentState('idle', 'Awaiting your approval to continue.');
  } else if (evt.type === 'step-start') {
    setAgentState('executing', `Running: ${evt.step?.label}`);
    if (_activePlan) {
      const li = $('#plan-steps')?.querySelector(`[data-index="${evt.index}"]`);
      if (li) { li.className = `plan-step active`; li.querySelector('.step-icon').textContent = '→'; }
    }
  } else if (evt.type === 'step-complete') {
    if (_activePlan) {
      const li = $('#plan-steps')?.querySelector(`[data-index="${evt.index}"]`);
      if (li) { li.className = `plan-step complete`; li.querySelector('.step-icon').textContent = '✓'; }
    }
  } else if (evt.type === 'step-error') {
    addMessage('JARVIS', `Step failed: ${evt.error}`);
    setAgentState('error', `Step failed: ${evt.step?.label}`);
  } else if (evt.type === 'done') {
    $('#task-status').textContent = 'Task complete';
    setAgentState('idle', 'Task completed successfully.');
    hideExecutorApproval();
  } else if (evt.type === 'cancelled') {
    $('#task-status').textContent = 'Task cancelled';
    setAgentState('idle', 'Task was cancelled.');
    hideExecutorApproval();
  }
});

window.orion.onModeChange(({ current, previous }) => {
  window.orion.getMode().then(({ mode, color }) => updateModeBadge(mode, color));
});

// ── System metrics ────────────────────────────────────────────────────────────
async function refreshSystem() {
  try {
    const s = await window.orion.getSystemSnapshot();
    $('#cpu').textContent     = `${s.cpu}%`;
    $('#ram').textContent     = `${s.ram}%`;
    $('#disk').textContent    = s.disk === null ? 'N/A' : `${s.disk}%`;
    $('#network').textContent = s.network;
  } catch { $('#network').textContent = 'N/A'; }
}

// ── Initialise ────────────────────────────────────────────────────────────────
window.orion.getVoiceState().then(updateVoiceState);
window.orion.getMode().then(({ mode, color }) => updateModeBadge(mode, color));
refreshSystem();
setInterval(refreshSystem, 5000);
loadSettings();
