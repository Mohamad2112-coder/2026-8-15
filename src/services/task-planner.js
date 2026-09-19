'use strict';

/**
 * TaskPlanner — NLP-driven plan builder for multi-step JARVIS tasks.
 *
 * Converts a natural-language request + active mode into an ordered list of
 * steps, each with a permission level (SAFE / MODERATE / DANGEROUS / CRITICAL).
 *
 * Plan step shape:
 *   { label, status, level, toolId?, input?, description? }
 *
 * Statuses: 'pending' | 'active' | 'complete' | 'blocked' | 'skipped' | 'error'
 */

const { EventEmitter } = require('events');
const { LEVELS } = require('./permission-manager');

// ---------------------------------------------------------------------------
// Pattern-based plan templates
// ---------------------------------------------------------------------------

const TEMPLATES = [
  {
    pattern: /organiz(?:e|ing).*downloads?|downloads?.*organiz/i,
    title: req => 'Organising Downloads folder',
    steps: () => [
      { label: 'Inspect Downloads folder',   level: LEVELS.SAFE,      toolId: 'file.search' },
      { label: 'Categorise files by type',   level: LEVELS.SAFE      },
      { label: 'Identify duplicate files',   level: LEVELS.SAFE,      toolId: 'file.search' },
      { label: 'Create category folders',    level: LEVELS.MODERATE,  toolId: 'folder.create' },
      { label: 'Move files into folders',    level: LEVELS.DANGEROUS, toolId: 'file.batch', description: 'Files will be moved, not deleted.' },
      { label: 'Review duplicate files',     level: LEVELS.DANGEROUS, description: 'Duplicates will be shown for your review before any removal.' },
      { label: 'Report results',             level: LEVELS.SAFE      },
    ],
  },
  {
    pattern: /create.*python\s+project|python\s+project.*called/i,
    title: req => {
      const name = /called\s+([\w-]+)/i.exec(req)?.[1] || 'myproject';
      return `Create Python project "${name}"`;
    },
    steps: req => {
      const name = /called\s+([\w-]+)/i.exec(req)?.[1] || 'myproject';
      return [
        { label: 'Check Python environment',    level: LEVELS.SAFE,     toolId: 'developer.detect' },
        { label: `Create project folder "${name}"`, level: LEVELS.MODERATE, toolId: 'folder.create', input: { folder: name } },
        { label: 'Create virtual environment',  level: LEVELS.MODERATE, toolId: 'developer.run', input: { command: 'python.exe', args: ['-m', 'venv', '.venv'] } },
        { label: 'Write starter files',         level: LEVELS.MODERATE },
        { label: 'Install dependencies',        level: LEVELS.MODERATE, toolId: 'developer.run' },
        { label: 'Run the application',         level: LEVELS.DANGEROUS, toolId: 'developer.run', description: 'Running the application may execute arbitrary code.' },
      ];
    },
  },
  {
    pattern: /set up.*node|create.*node.*project|node.*project/i,
    title: req => {
      const name = /called\s+([\w-]+)/i.exec(req)?.[1] || 'myapp';
      return `Create Node.js project "${name}"`;
    },
    steps: req => {
      const name = /called\s+([\w-]+)/i.exec(req)?.[1] || 'myapp';
      return [
        { label: 'Detect Node.js environment',  level: LEVELS.SAFE,     toolId: 'developer.detect' },
        { label: `Create project folder "${name}"`, level: LEVELS.MODERATE, toolId: 'folder.create' },
        { label: 'Initialise package.json',     level: LEVELS.MODERATE, toolId: 'developer.run' },
        { label: 'Install dependencies',        level: LEVELS.MODERATE, toolId: 'developer.run' },
        { label: 'Write starter files',         level: LEVELS.MODERATE },
        { label: 'Run the application',         level: LEVELS.DANGEROUS, toolId: 'developer.run', description: 'Running the application executes project code.' },
      ];
    },
  },
  {
    pattern: /move all pdf|pdf.*to.*documents/i,
    title: () => 'Move PDFs to Documents',
    steps: () => [
      { label: 'Search Downloads for PDFs',    level: LEVELS.SAFE,     toolId: 'file.search' },
      { label: 'Preview files to be moved',    level: LEVELS.SAFE },
      { label: 'Move PDFs to Documents',       level: LEVELS.DANGEROUS, toolId: 'file.batch', description: 'Files will be moved from Downloads to Documents.' },
      { label: 'Report moved files',           level: LEVELS.SAFE },
    ],
  },
  {
    pattern: /find.*duplicate|duplicate.*files?/i,
    title: () => 'Find duplicate files',
    steps: () => [
      { label: 'Scan Downloads folder',        level: LEVELS.SAFE,     toolId: 'file.search' },
      { label: 'Compute file hashes',          level: LEVELS.SAFE },
      { label: 'Group duplicates',             level: LEVELS.SAFE },
      { label: 'Present duplicate report',     level: LEVELS.SAFE },
      { label: 'Remove selected duplicates',   level: LEVELS.DANGEROUS, toolId: 'file.recycle', description: 'Selected duplicates will be moved to the Recycle Bin.' },
    ],
  },
  {
    pattern: /research\s+.+|find (?:out|info).*about/i,
    title: req => `Research: ${req.replace(/^(?:research|find (?:out|info) about)\s+/i, '').trim()}`,
    steps: () => [
      { label: 'Formulate search queries',     level: LEVELS.SAFE },
      { label: 'Search the web',               level: LEVELS.SAFE,     toolId: 'browser.search' },
      { label: 'Read relevant pages',          level: LEVELS.SAFE,     toolId: 'browser.read' },
      { label: 'Synthesise findings',          level: LEVELS.SAFE },
      { label: 'Present summary',              level: LEVELS.SAFE },
    ],
  },
];

// ---------------------------------------------------------------------------
// General fallback plan (AUTOMATION mode or multi-step intent)
// ---------------------------------------------------------------------------

function buildFallbackPlan(request) {
  return [
    { label: 'Understand the request',        level: LEVELS.SAFE },
    { label: 'Create step-by-step plan',      level: LEVELS.SAFE },
    { label: 'Execute safe steps',            level: LEVELS.MODERATE },
    { label: 'Pause for approval if needed',  level: LEVELS.DANGEROUS, description: 'Any dangerous operations will stop here for your review.' },
    { label: 'Verify results',                level: LEVELS.SAFE },
    { label: 'Report outcome',                level: LEVELS.SAFE },
  ];
}

// ---------------------------------------------------------------------------
// TaskPlanner class
// ---------------------------------------------------------------------------

class TaskPlanner extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Build a plan from a natural-language request.
   * @param {string} request
   * @param {string} [mode] — current JARVIS mode
   * @returns {object} plan
   */
  create(request, mode = 'NORMAL') {
    const template = TEMPLATES.find(t => t.pattern.test(request));

    let title, rawSteps;
    if (template) {
      title = template.title(request);
      rawSteps = template.steps(request);
    } else {
      title = request.length > 60 ? request.slice(0, 57) + '…' : request;
      rawSteps = buildFallbackPlan(request);
    }

    const steps = rawSteps.map((s, i) => ({
      index: i,
      label: s.label,
      status: i === 0 ? 'active' : 'pending',
      level: s.level || LEVELS.SAFE,
      toolId: s.toolId || null,
      input: s.input || null,
      description: s.description || null,
    }));

    const plan = {
      id: crypto.randomUUID(),
      title,
      mode,
      steps,
      createdAt: new Date().toISOString(),
    };

    this.emit('update', plan);
    return plan;
  }

  /**
   * Advance a step to a new status and emit update.
   * @param {object} plan
   * @param {number} index
   * @param {string} status
   * @returns {object} updated plan
   */
  update(plan, index, status) {
    if (plan.steps[index]) plan.steps[index].status = status;
    this.emit('update', plan);
    return plan;
  }

  /**
   * Block execution at a step (e.g. awaiting user approval).
   * @param {object} plan
   * @param {number} index
   * @param {string} reason
   * @returns {object} updated plan
   */
  blockAt(plan, index, reason = '') {
    if (plan.steps[index]) {
      plan.steps[index].status = 'blocked';
      if (reason) plan.steps[index].blockReason = reason;
    }
    this.emit('update', plan);
    return plan;
  }
}

module.exports = { TaskPlanner, TEMPLATES };
