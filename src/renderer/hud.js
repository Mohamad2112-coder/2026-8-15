'use strict';

// ── Utilities ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

let _isThinking = false;

// ── Tool activity feed ────────────────────────────────────────────────────────
window.orion?.onToolActivity?.((activity) => {
  if (activity.phase === 'running') {
    showToolLabel(`⚙ ${activity.tool}: ${activity.summary}`);
  }
});

function showToolLabel(text) {
  const label = $('hud-tool-label');
  label.textContent = text;
  label.classList.remove('hidden');
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submit() {
  const input = $('hud-input');
  const text  = input.value.trim();
  if (!text || _isThinking) return;

  _isThinking = true;
  $('hud-spinner').classList.remove('hidden');
  $('hud-send').classList.add('hidden');
  $('hud-tool-label').classList.add('hidden');

  // Show result area immediately with a thinking indicator
  showResult('Thinking…');

  try {
    const result = await window.orion.submit(text);
    const reply  = result?.text || result?.kind || 'Done.';
    showResult(reply, result?.kind === 'approval' || result?.kind === 'files');
  } catch (err) {
    showResult(`⚠ ${err.message || 'Something went wrong.'}`);
  } finally {
    _isThinking = false;
    $('hud-spinner').classList.add('hidden');
    $('hud-send').classList.remove('hidden');
    $('hud-tool-label').classList.add('hidden');
    input.value = '';
    input.focus();
  }
}

function showResult(text, showOpenBtn = false) {
  $('hud-text').textContent = text;
  $('hud-result').classList.remove('hidden');
  $('hud-open-btn').classList.toggle('hidden', !showOpenBtn);
  // Notify main process that the window should expand
  window.orion?.hudExpand?.();
}

function hideHUD() {
  window.orion?.hudHide?.();
  // Clear state so next open is fresh
  $('hud-result').classList.add('hidden');
  $('hud-tool-label').classList.add('hidden');
  $('hud-input').value = '';
}

// ── Event listeners ───────────────────────────────────────────────────────────
$('hud-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  if (e.key === 'Escape') hideHUD();
});

$('hud-send').addEventListener('click', submit);
$('hud-close-btn').addEventListener('click', hideHUD);
$('hud-open-btn').addEventListener('click', () => window.orion?.hudOpenMain?.());

// ── Reset on re-open (Ctrl+Alt+Space) ────────────────────────────────────────
window.orion?.onHudReset?.(() => {
  $('hud-input').value = '';
  $('hud-result').classList.add('hidden');
  $('hud-tool-label').classList.add('hidden');
  _isThinking = false;
  $('hud-spinner').classList.add('hidden');
  $('hud-send').classList.remove('hidden');
  $('hud-input').focus();
});

// ── Focus input on load ───────────────────────────────────────────────────────
window.addEventListener('focus', () => $('hud-input').focus());
$('hud-input').focus();
