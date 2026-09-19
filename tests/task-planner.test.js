'use strict';

/**
 * tests/task-planner.test.js
 * Node.js built-in test runner (node --test)
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

// Stub electron
const Module = require('module');
const _orig = Module._load;
Module._load = function (id, ...rest) {
  if (id === 'electron') return {};
  return _orig.call(this, id, ...rest);
};

const { TaskPlanner } = require('../src/services/task-planner');
const { LEVELS }      = require('../src/services/permission-manager');

function fresh() { return new TaskPlanner(); }

describe('TaskPlanner — plan creation', () => {

  test('create() returns a plan with an id, title, steps, and createdAt', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    assert.ok(plan.id);
    assert.ok(plan.title);
    assert.ok(Array.isArray(plan.steps));
    assert.ok(plan.createdAt);
  });

  test('Downloads organiser template fires on matching input', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    assert.ok(plan.title.toLowerCase().includes('download'));
    assert.ok(plan.steps.length >= 5);
  });

  test('Python project template fires on matching input', () => {
    const p = fresh();
    const plan = p.create('Create a Python project called testapp and run it');
    assert.ok(plan.title.toLowerCase().includes('testapp'));
    assert.ok(plan.steps.some(s => s.label.toLowerCase().includes('virtual')));
  });

  test('Node.js project template fires', () => {
    const p = fresh();
    const plan = p.create('Set up a Node project called myapi');
    assert.ok(plan.steps.some(s => s.label.toLowerCase().includes('node')));
  });

  test('PDF mover template fires', () => {
    const p = fresh();
    const plan = p.create('Move all PDFs to my Documents folder');
    assert.ok(plan.steps.some(s => s.label.toLowerCase().includes('pdf')));
  });

  test('Duplicate finder template fires', () => {
    const p = fresh();
    const plan = p.create('Find duplicate files in Downloads');
    assert.ok(plan.steps.some(s => s.label.toLowerCase().includes('hash') || s.label.toLowerCase().includes('duplicate')));
  });

  test('Research template fires for research requests', () => {
    const p = fresh();
    const plan = p.create('Research the latest Windows 11 update');
    assert.ok(plan.steps.some(s => s.label.toLowerCase().includes('search')));
  });

  test('General fallback plan fires for unknown requests', () => {
    const p = fresh();
    const plan = p.create('Do something unusual that has no template');
    assert.ok(plan.steps.length >= 4);
    assert.ok(plan.steps.some(s => s.label.toLowerCase().includes('understand')));
  });

  test('First step starts as "active"', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    assert.equal(plan.steps[0].status, 'active');
  });

  test('Subsequent steps start as "pending"', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    for (const step of plan.steps.slice(1)) {
      assert.equal(step.status, 'pending');
    }
  });

  test('All steps have a valid permission level', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    const validLevels = new Set(Object.values(LEVELS));
    for (const step of plan.steps) {
      assert.ok(validLevels.has(step.level), `Invalid level "${step.level}" on step "${step.label}"`);
    }
  });

  test('Dangerous operations exist in the Downloads plan', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    assert.ok(plan.steps.some(s => s.level === LEVELS.DANGEROUS));
  });
});

describe('TaskPlanner — update and blockAt', () => {
  test('update() changes a step status and emits update event', () => {
    const p = fresh();
    const plan = p.create('Find duplicate files');
    let emitted = null;
    p.on('update', updated => { emitted = updated; });
    p.update(plan, 0, 'complete');
    assert.equal(plan.steps[0].status, 'complete');
    assert.ok(emitted);
  });

  test('blockAt() sets status to "blocked" and optionally sets blockReason', () => {
    const p = fresh();
    const plan = p.create('Organise my Downloads folder');
    p.blockAt(plan, 3, 'User must approve file moves.');
    assert.equal(plan.steps[3].status, 'blocked');
    assert.equal(plan.steps[3].blockReason, 'User must approve file moves.');
  });
});
