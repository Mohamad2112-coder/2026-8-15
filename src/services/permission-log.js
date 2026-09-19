'use strict';

/**
 * PermissionLog — in-memory session log of every permission decision.
 *
 * Records every time a tool is approved or denied, along with the timestamp,
 * tool ID, permission level, and the user's original request text.
 *
 * This log is intentionally session-only (not persisted to disk) so that
 * it is automatically cleared when JARVIS is closed.
 *
 * Query via: "Jarvis, what did you just do?" or from the permission log IPC.
 */

const MAX_LOG_ENTRIES = 500;

/** @typedef {'approved'|'denied'|'auto'} DecisionKind */

class PermissionLog {
  constructor() {
    /** @type {Array<{id:string, toolId:string, level:string, decision:DecisionKind, label:string, summary:string, requestText:string, timestamp:string}>} */
    this._entries = [];
  }

  /**
   * Record a permission decision.
   * @param {{toolId:string, level:string, decision:DecisionKind, label:string, summary:string, requestText?:string}} opts
   * @returns {object} The recorded entry.
   */
  record({ toolId, level, decision, label, summary, requestText = '' }) {
    const entry = {
      id: crypto.randomUUID(),
      toolId,
      level,
      decision,
      label,
      summary,
      requestText,
      timestamp: new Date().toISOString(),
    };
    this._entries.unshift(entry);
    if (this._entries.length > MAX_LOG_ENTRIES) {
      this._entries.length = MAX_LOG_ENTRIES;
    }
    return entry;
  }

  /** Return all log entries (newest first). */
  list() {
    return [...this._entries];
  }

  /**
   * Return a human-readable summary of recent actions, suitable for display.
   * @param {number} [limit=10]
   * @returns {string}
   */
  summarise(limit = 10) {
    const recent = this._entries.slice(0, limit);
    if (!recent.length) return 'No actions have been taken in this session.';
    return recent
      .map(e => {
        const icon = e.decision === 'approved' ? '✓' : e.decision === 'auto' ? '→' : '✗';
        const time = new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${icon} [${time}] ${e.label} — ${e.summary} (${e.level})`;
      })
      .join('\n');
  }

  /** Clear all log entries (e.g. if user requests it). */
  clear() {
    this._entries = [];
  }
}

module.exports = { PermissionLog };
