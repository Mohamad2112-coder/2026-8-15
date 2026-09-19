'use strict';

const path = require('path');
const { EventEmitter } = require('events');

class ReminderService extends EventEmitter {
  constructor({ speech, getWindow } = {}) {
    super();
    this.speech = speech;
    this.getWindow = getWindow;
    this.reminders = new Map();
    this.iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  }

  parseDelay(text) {
    if (!text || typeof text !== 'string') return null;
    const clean = text.toLowerCase();

    const hourMatch = /in\s+(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/.exec(clean);
    if (hourMatch) return Math.round(parseFloat(hourMatch[1]) * 3600 * 1000);

    const minMatch = /in\s+(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/.exec(clean);
    if (minMatch) return Math.round(parseFloat(minMatch[1]) * 60 * 1000);

    const secMatch = /in\s+(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/.exec(clean);
    if (secMatch) return Math.round(parseFloat(secMatch[1]) * 1000);

    return null;
  }

  schedule(message, delayMs) {
    if (!message) throw new Error('Reminder message is required.');
    if (!delayMs || delayMs <= 0) throw new Error('Delay must be greater than zero.');

    const id = `rem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const dueAt = Date.now() + delayMs;

    const timer = setTimeout(() => {
      this.fire(id, message);
    }, delayMs);

    const entry = { id, message, delayMs, dueAt, timer };
    this.reminders.set(id, entry);
    this.emit('scheduled', { id, message, dueAt });

    const seconds = Math.round(delayMs / 1000);
    const timeDesc = seconds >= 60 ? `${Math.round(seconds / 60)} minute(s)` : `${seconds} second(s)`;
    return {
      id,
      summary: `Reminder set for ${timeDesc} from now: "${message}"`,
      dueAt: new Date(dueAt).toISOString(),
    };
  }

  fire(id, message) {
    this.reminders.delete(id);
    this.emit('fired', { id, message });

    // Show native Windows toast notification
    try {
      let Notification = null;
      try { Notification = require('electron').Notification; } catch { /* tests/headless */ }

      if (Notification && Notification.isSupported && Notification.isSupported()) {
        const notif = new Notification({
          title: 'JARVIS Reminder',
          body: message,
          icon: this.iconPath,
          urgency: 'critical',
        });

        notif.on('click', () => {
          const win = this.getWindow ? this.getWindow() : null;
          if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
        });

        notif.show();
      }
    } catch {
      // Ignored if notifications not available
    }

    // Voice announcement
    if (this.speech && typeof this.speech.speak === 'function') {
      this.speech.speak(`Reminder: ${message}`).catch(() => {});
    }
  }

  cancel(id) {
    const entry = this.reminders.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.reminders.delete(id);
    this.emit('cancelled', { id });
    return true;
  }

  list() {
    return [...this.reminders.values()].map(({ id, message, dueAt }) => ({
      id,
      message,
      dueAt: new Date(dueAt).toISOString(),
    }));
  }
}

module.exports = { ReminderService };
