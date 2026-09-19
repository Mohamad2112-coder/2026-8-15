'use strict';

/**
 * PermissionManager — centralised permission gate for all JARVIS tool operations.
 *
 * Levels:
 *   SAFE      — Read-only, observational, reversible. Executed automatically.
 *   MODERATE  — Creates or modifies files, runs harmless commands. Executed automatically.
 *   DANGEROUS — Deletes files, runs PowerShell, mass changes. Requires user approval.
 *   CRITICAL  — Registry, disk format, security settings. NEVER silently executed.
 *
 * CRITICAL is a hard gate: even if the executor marks a step approved, the
 * manager will still surface an additional confirmation before proceeding.
 */

const LEVELS = Object.freeze({
  SAFE:      'SAFE',
  MODERATE:  'MODERATE',
  DANGEROUS: 'DANGEROUS',
  CRITICAL:  'CRITICAL',
});

/** Human-readable risk descriptions used in approval dialogs. */
const RISK_DESCRIPTIONS = Object.freeze({
  [LEVELS.SAFE]:      'This action is read-only and safe to run automatically.',
  [LEVELS.MODERATE]:  'This action creates or modifies files. It can be undone.',
  [LEVELS.DANGEROUS]: 'This action can delete or move files, run commands, or make bulk changes. Review carefully.',
  [LEVELS.CRITICAL]:  'CRITICAL: This action can cause irreversible system-level changes. It will NEVER be run without your explicit approval.',
});

class PermissionManager {
  constructor() {
    /** @type {Map<string, string>} toolId → LEVEL */
    this._levels = new Map([
      // SAFE — read, open, observe
      ['file.search',          LEVELS.SAFE],
      ['file.read',            LEVELS.SAFE],
      ['folder.open',          LEVELS.SAFE],
      ['application.launch',   LEVELS.SAFE],
      ['application.detect',   LEVELS.SAFE],
      ['screen.capture',       LEVELS.SAFE],
      ['screen.analyze',       LEVELS.SAFE],
      ['screen.clip',          LEVELS.SAFE],
      ['memory.save',          LEVELS.SAFE],
      ['memory.short-term',    LEVELS.SAFE],
      ['browser.read',         LEVELS.SAFE],
      ['browser.search',       LEVELS.SAFE],
      ['developer.detect',     LEVELS.SAFE],
      ['reminder.create',      LEVELS.SAFE],
      ['reminder.list',        LEVELS.SAFE],
      ['rag.search',           LEVELS.SAFE],
      ['rag.answer',           LEVELS.SAFE],

      // MODERATE — create, write, harmless run
      ['folder.create',        LEVELS.MODERATE],
      ['keyboard.type',        LEVELS.MODERATE],
      ['keyboard.press',       LEVELS.MODERATE],
      ['mouse.click',          LEVELS.MODERATE],
      ['computer.click_target',LEVELS.MODERATE],
      ['developer.run',        LEVELS.MODERATE],
      ['project.scaffold',     LEVELS.MODERATE],
      ['project.git_init',     LEVELS.MODERATE],

      // DANGEROUS — delete, bulk, external, PowerShell
      ['terminal.powershell',  LEVELS.DANGEROUS],
      ['browser.download',     LEVELS.DANGEROUS],
      ['browser.form',         LEVELS.DANGEROUS],
      ['file.batch',           LEVELS.DANGEROUS],
      ['file.delete',          LEVELS.DANGEROUS],
      ['file.recycle',         LEVELS.DANGEROUS],

      // CRITICAL — irreversible system operations
      ['system.registry',      LEVELS.CRITICAL],
      ['system.format',        LEVELS.CRITICAL],
      ['system.security',      LEVELS.CRITICAL],
      ['system.planned',       LEVELS.CRITICAL],
    ]);
  }

  // ---------------------------------------------------------------------------
  // Core API
  // ---------------------------------------------------------------------------

  /**
   * Return the permission level for a given tool ID.
   * Unknown tools default to DANGEROUS (fail-secure).
   * @param {string} toolId
   * @returns {string}
   */
  levelFor(toolId) {
    return this._levels.get(toolId) || LEVELS.DANGEROUS;
  }

  /**
   * Return a human-readable risk description for the given tool.
   * @param {string} toolId
   * @returns {string}
   */
  describeRisk(toolId) {
    return RISK_DESCRIPTIONS[this.levelFor(toolId)];
  }

  /**
   * Whether a tool requires explicit user approval before running.
   * DANGEROUS and CRITICAL both require approval.
   * @param {string} toolId
   * @returns {boolean}
   */
  requiresApproval(toolId) {
    const level = this.levelFor(toolId);
    return level === LEVELS.DANGEROUS || level === LEVELS.CRITICAL;
  }

  /**
   * Whether a tool is CRITICAL — hard gate, never silently executed.
   * @param {string} toolId
   * @returns {boolean}
   */
  isCritical(toolId) {
    return this.levelFor(toolId) === LEVELS.CRITICAL;
  }

  /**
   * Whether a tool can execute given its approval state.
   * CRITICAL tools require approved === true regardless of other factors.
   * @param {string} toolId
   * @param {boolean} [approved]
   * @returns {boolean}
   */
  canExecute(toolId, approved) {
    return !this.requiresApproval(toolId) || approved === true;
  }

  /**
   * Build a tailored approval message for a tool and its input.
   * @param {string} toolId
   * @param {object} [input]
   * @returns {string}
   */
  getApprovalMessage(toolId, input = {}) {
    const level = this.levelFor(toolId);
    const base = RISK_DESCRIPTIONS[level];

    switch (toolId) {
      case 'terminal.powershell':
        return `${base}\n\nCommand: ${input.command || '(not specified)'}`;
      case 'file.delete':
      case 'file.recycle':
        return `${base}\n\nTarget: ${input.path || input.paths?.join(', ') || '(not specified)'}`;
      case 'file.batch':
        return `${base}\n\nThis will affect ${input.count || 'multiple'} files.`;
      case 'browser.download':
        return `${base}\n\nURL: ${input.url || '(not specified)'}`;
      case 'browser.form':
        return `${base}\n\nThis will submit a form to: ${input.url || '(not specified)'}`;
      case 'system.registry':
        return `${base}\n\nKey: ${input.key || '(not specified)'}`;
      default:
        return base;
    }
  }

  /**
   * Register a custom tool permission level.
   * @param {string} toolId
   * @param {string} level — one of LEVELS values
   */
  register(toolId, level) {
    if (!Object.values(LEVELS).includes(level)) {
      throw new Error(`Invalid permission level: ${level}`);
    }
    this._levels.set(toolId, level);
  }
}

module.exports = { PermissionManager, LEVELS, RISK_DESCRIPTIONS };
