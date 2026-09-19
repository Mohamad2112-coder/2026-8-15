'use strict';

/**
 * TaskExecutor — autonomous multi-step task execution engine.
 *
 * Consumes a TaskPlanner plan and executes each step in sequence:
 *   • SAFE / MODERATE steps  → executed automatically without pausing.
 *   • DANGEROUS steps        → paused; emits 'approval-needed'; resumes after user approves.
 *   • CRITICAL steps         → always paused; never silently executed.
 *
 * Emits:
 *   'step-start'       ({ planId, index, step })
 *   'step-complete'    ({ planId, index, step, result })
 *   'step-error'       ({ planId, index, step, error })
 *   'approval-needed'  ({ planId, index, step, level, message })
 *   'done'             ({ planId, plan })
 *   'cancelled'        ({ planId })
 */

const { EventEmitter } = require('events');
const { LEVELS } = require('./permission-manager');

const AUTO_LEVELS = new Set([LEVELS.SAFE, LEVELS.MODERATE]);

class TaskExecutor extends EventEmitter {
  constructor({ planner, tools, permissions, permissionLog }) {
    super();
    this._planner = planner;
    this._tools = tools;
    this._permissions = permissions;
    this._log = permissionLog;

    /** @type {Map<string, {plan: object, index: number, resolve: Function, reject: Function, cancelled: boolean}>} */
    this._active = new Map();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Start executing a plan.
   * @param {object} plan — from TaskPlanner.create()
   * @param {string} [requestText] — original user text for logging
   * @returns {Promise<object>} — resolves when execution is complete or cancelled
   */
  async run(plan, requestText = '') {
    return new Promise((resolve, reject) => {
      const state = { plan, index: 0, resolve, reject, cancelled: false, requestText };
      this._active.set(plan.id, state);
      this._advance(plan.id).catch(reject);
    });
  }

  /**
   * Approve a paused step and continue execution.
   * @param {string} planId
   * @param {number} stepIndex
   */
  approveStep(planId, stepIndex) {
    const state = this._active.get(planId);
    if (!state) return;
    if (state.index !== stepIndex) return;

    const step = state.plan.steps[stepIndex];
    this._log.record({
      toolId: step.toolId || 'task.step',
      level: step.level,
      decision: 'approved',
      label: step.label,
      summary: step.label,
      requestText: state.requestText,
    });

    // Mark approved and continue
    step._approved = true;
    this._advance(planId).catch(err => {
      this.emit('step-error', { planId, index: stepIndex, step, error: err.message });
      state.reject(err);
      this._active.delete(planId);
    });
  }

  /**
   * Cancel a running plan.
   * @param {string} planId
   */
  cancel(planId) {
    const state = this._active.get(planId);
    if (!state) return;
    state.cancelled = true;
    this._active.delete(planId);
    this.emit('cancelled', { planId });
    state.resolve({ cancelled: true, planId });
  }

  /** Return whether a plan is currently running or paused. */
  isActive(planId) {
    return this._active.has(planId);
  }

  // ---------------------------------------------------------------------------
  // Internal execution loop
  // ---------------------------------------------------------------------------

  async _advance(planId) {
    const state = this._active.get(planId);
    if (!state || state.cancelled) return;

    const { plan } = state;

    while (state.index < plan.steps.length) {
      if (state.cancelled) return;

      const index = state.index;
      const step = plan.steps[index];

      // Skip already-complete steps
      if (step.status === 'complete' || step.status === 'skipped') {
        state.index++;
        continue;
      }

      const level = (step.level || LEVELS.SAFE).toUpperCase();
      const needsApproval = !AUTO_LEVELS.has(level) && !step._approved;

      if (needsApproval) {
        // Block and wait for external approveStep() call
        this._planner.update(plan, index, 'blocked');
        const message = this._buildApprovalMessage(step, level);
        this.emit('approval-needed', { planId, index, step, level, message });
        return; // paused — _advance will be called again from approveStep()
      }

      // Mark running
      this._planner.update(plan, index, 'active');
      this.emit('step-start', { planId, index, step });

      // Log auto-executions
      if (AUTO_LEVELS.has(level)) {
        this._log.record({
          toolId: step.toolId || 'task.step',
          level,
          decision: 'auto',
          label: step.label,
          summary: step.label,
          requestText: state.requestText,
        });
      }

      try {
        const result = await this._executeStep(step);
        this._planner.update(plan, index, 'complete');
        this.emit('step-complete', { planId, index, step, result });
      } catch (error) {
        this._planner.update(plan, index, 'error');
        this.emit('step-error', { planId, index, step, error: error.message });
        this._active.delete(planId);
        state.reject(error);
        return;
      }

      state.index++;
    }

    // All steps done
    this._active.delete(planId);
    this.emit('done', { planId, plan });
    state.resolve({ done: true, plan });
  }

  /**
   * Dispatch a single step to the appropriate tool.
   * Steps declare their tool via `step.toolId`. If no toolId, the step is
   * treated as informational and resolves immediately.
   */
  async _executeStep(step) {
    if (!step.toolId) return { summary: step.label };
    return this._tools.execute(step.toolId, { ...(step.input || {}), approved: true });
  }

  _buildApprovalMessage(step, level) {
    const prefix = level === LEVELS.CRITICAL
      ? '⚠️  CRITICAL operation — this can cause irreversible system changes.'
      : '⚠️  DANGEROUS operation — this requires your explicit approval.';
    return `${prefix}\n\nStep: ${step.label}${step.description ? `\n${step.description}` : ''}`;
  }
}

module.exports = { TaskExecutor };
