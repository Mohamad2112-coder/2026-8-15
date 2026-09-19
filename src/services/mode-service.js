'use strict';

/**
 * ModeService — JARVIS operational mode management.
 *
 * Modes:
 *   NORMAL      — General personal assistant
 *   CODING      — Programming and development
 *   RESEARCH    — Web research and information gathering
 *   FILE        — Computer file management
 *   SYSTEM      — Windows and application control
 *   AUTOMATION  — Multi-step autonomous tasks
 *   VISION      — Screen understanding
 *   MEMORY      — Manage persistent memory
 *
 * Supports:
 *   • Auto-detection from user input text (detect())
 *   • Explicit switching via setMode() / "switch to X mode"
 *   • 'change' event emitted on mode transitions
 */

const { EventEmitter } = require('events');

const MODES = Object.freeze([
  'NORMAL',
  'CODING',
  'RESEARCH',
  'FILE',
  'SYSTEM',
  'AUTOMATION',
  'VISION',
  'MEMORY',
]);

const MODE_DESCRIPTIONS = Object.freeze({
  NORMAL:     'General personal assistant',
  CODING:     'Programming and development',
  RESEARCH:   'Web research and information gathering',
  FILE:       'Computer file management',
  SYSTEM:     'Windows and application control',
  AUTOMATION: 'Multi-step autonomous tasks',
  VISION:     'Screen understanding',
  MEMORY:     'Manage persistent memory',
});

/** Colours shown in the UI badge per mode. */
const MODE_COLORS = Object.freeze({
  NORMAL:     '#4fdde7', // cyan
  CODING:     '#65e9a4', // green
  RESEARCH:   '#278cb7', // blue
  FILE:       '#9b8cff', // purple
  SYSTEM:     '#ffd26b', // amber
  AUTOMATION: '#ff9f5a', // orange
  VISION:     '#e96fe6', // magenta
  MEMORY:     '#7ec8e3', // light blue
});

/** Regex patterns for auto-detection (evaluated in order — first match wins). */
const DETECT_RULES = [
  { mode: 'MEMORY',     pattern: /remember|forget|memory|what do you remember|recall|i told you/i },
  { mode: 'VISION',     pattern: /screen|looking at|what.?s (?:on )?(?:my |the )?screen|what am i looking at/i },
  { mode: 'AUTOMATION', pattern: /organize|multi.?step|automate|create.*project|set up|set me up|step by step/i },
  { mode: 'CODING',     pattern: /\bcode\b|website|python|npm|node|git|virtual ?env|venv|package|compile|debug|deploy|script/i },
  { mode: 'RESEARCH',   pattern: /search (?:the )?web|research|latest news|find (?:out|info)|read (?:the )?page|webpage|article/i },
  { mode: 'FILE',       pattern: /file|folder|pdf|download|duplicate|rename|move|copy|delete|find.*(?:file|doc)|clean up/i },
  { mode: 'SYSTEM',     pattern: /open |launch |start |run |application|terminal|powershell|system|settings|control/i },
];

/** Explicit mode-switch phrases, e.g. "switch to coding mode" */
const EXPLICIT_SWITCH_PATTERN = /(?:switch|change|enter|go into?|activate|enable|use)\s+(?:to\s+)?(\w+)\s+mode/i;

class ModeService extends EventEmitter {
  constructor() {
    super();
    this._current = 'NORMAL';
  }

  // ---------------------------------------------------------------------------
  // Auto-detection
  // ---------------------------------------------------------------------------

  /**
   * Detect the most appropriate mode for a given input string.
   * Does NOT change the active mode — caller decides whether to apply it.
   * @param {string} text
   * @returns {string} mode name
   */
  detect(text) {
    for (const { mode, pattern } of DETECT_RULES) {
      if (pattern.test(text)) return mode;
    }
    return 'NORMAL';
  }

  /**
   * If the text contains an explicit mode-switch command, return the target
   * mode name; otherwise return null.
   * @param {string} text
   * @returns {string|null}
   */
  parseExplicitSwitch(text) {
    const match = EXPLICIT_SWITCH_PATTERN.exec(text);
    if (!match) return null;
    const candidate = match[1].toUpperCase();
    return MODES.includes(candidate) ? candidate : null;
  }

  // ---------------------------------------------------------------------------
  // Active mode management
  // ---------------------------------------------------------------------------

  /** Return the current active mode. */
  getMode() {
    return this._current;
  }

  /**
   * Explicitly set the active mode.
   * Emits 'change' if the mode actually changed.
   * @param {string} mode
   * @returns {boolean} true if the mode was valid and set.
   */
  setMode(mode) {
    const upper = mode.toUpperCase();
    if (!MODES.includes(upper)) return false;
    const previous = this._current;
    this._current = upper;
    if (previous !== upper) this.emit('change', { previous, current: upper });
    return true;
  }

  /** Return description string for a mode. */
  describe(mode) {
    return MODE_DESCRIPTIONS[mode] || MODE_DESCRIPTIONS.NORMAL;
  }

  /** Return the UI badge colour for a mode. */
  color(mode) {
    return MODE_COLORS[mode] || MODE_COLORS.NORMAL;
  }
}

module.exports = { ModeService, MODES, MODE_DESCRIPTIONS, MODE_COLORS };
