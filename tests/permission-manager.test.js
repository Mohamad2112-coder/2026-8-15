'use strict';

/**
 * tests/permission-manager.test.js
 * Node.js built-in test runner (node --test)
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Stub electron before require
const Module = require('module');
const _orig = Module._load;
Module._load = function (id, ...rest) {
  if (id === 'electron') return {};
  return _orig.call(this, id, ...rest);
};

const { PermissionManager, LEVELS, RISK_DESCRIPTIONS } = require('../src/services/permission-manager');

describe('PermissionManager', () => {
  let pm;
  beforeEach(() => { pm = new PermissionManager(); });

  function fresh() { return new PermissionManager(); }

  test('LEVELS has four values', () => {
    assert.equal(Object.keys(LEVELS).length, 4);
    assert.ok(LEVELS.SAFE);
    assert.ok(LEVELS.MODERATE);
    assert.ok(LEVELS.DANGEROUS);
    assert.ok(LEVELS.CRITICAL);
  });

  test('RISK_DESCRIPTIONS has an entry for each level', () => {
    for (const level of Object.values(LEVELS)) {
      assert.ok(RISK_DESCRIPTIONS[level], `Missing description for ${level}`);
    }
  });

  // SAFE tools
  for (const toolId of ['file.search', 'folder.open', 'application.launch', 'memory.save', 'browser.read', 'developer.detect']) {
    test(`${toolId} is SAFE`, () => {
      assert.equal(fresh().levelFor(toolId), LEVELS.SAFE);
    });
  }

  // MODERATE tools
  for (const toolId of ['folder.create', 'keyboard.type', 'mouse.click', 'developer.run']) {
    test(`${toolId} is MODERATE`, () => {
      assert.equal(fresh().levelFor(toolId), LEVELS.MODERATE);
    });
  }

  // DANGEROUS tools
  for (const toolId of ['terminal.powershell', 'file.delete', 'file.batch', 'browser.download']) {
    test(`${toolId} is DANGEROUS`, () => {
      assert.equal(fresh().levelFor(toolId), LEVELS.DANGEROUS);
    });
  }

  // CRITICAL tools
  for (const toolId of ['system.registry', 'system.format', 'system.security']) {
    test(`${toolId} is CRITICAL`, () => {
      assert.equal(fresh().levelFor(toolId), LEVELS.CRITICAL);
    });
  }

  test('unknown tool defaults to DANGEROUS (fail-secure)', () => {
    assert.equal(fresh().levelFor('some.unknown.tool'), LEVELS.DANGEROUS);
  });

  test('requiresApproval() true for DANGEROUS tools', () => {
    assert.ok(fresh().requiresApproval('terminal.powershell'));
  });

  test('requiresApproval() true for CRITICAL tools', () => {
    assert.ok(fresh().requiresApproval('system.registry'));
  });

  test('requiresApproval() false for SAFE tools', () => {
    assert.equal(fresh().requiresApproval('file.search'), false);
  });

  test('requiresApproval() false for MODERATE tools', () => {
    assert.equal(fresh().requiresApproval('folder.create'), false);
  });

  test('isCritical() true only for CRITICAL tools', () => {
    const p = fresh();
    assert.ok(p.isCritical('system.registry'));
    assert.equal(p.isCritical('terminal.powershell'), false);
    assert.equal(p.isCritical('file.search'), false);
  });

  test('canExecute() true for SAFE without approval', () => {
    assert.ok(fresh().canExecute('file.search', false));
  });

  test('canExecute() false for DANGEROUS without approval', () => {
    assert.equal(fresh().canExecute('terminal.powershell', false), false);
  });

  test('canExecute() true for DANGEROUS with approved=true', () => {
    assert.ok(fresh().canExecute('terminal.powershell', true));
  });

  test('canExecute() true for CRITICAL with approved=true', () => {
    assert.ok(fresh().canExecute('system.registry', true));
  });

  test('getApprovalMessage() includes command for terminal.powershell', () => {
    const msg = fresh().getApprovalMessage('terminal.powershell', { command: 'Get-ChildItem' });
    assert.ok(msg.includes('Get-ChildItem'));
  });

  test('describeRisk() returns a non-empty string', () => {
    const desc = fresh().describeRisk('terminal.powershell');
    assert.ok(typeof desc === 'string' && desc.length > 0);
  });

  test('register() allows adding a custom tool with a valid level', () => {
    const p = fresh();
    p.register('custom.tool', LEVELS.SAFE);
    assert.equal(p.levelFor('custom.tool'), LEVELS.SAFE);
  });

  test('register() throws for an invalid level', () => {
    assert.throws(() => fresh().register('bad.tool', 'ULTRA'), /Invalid permission level/);
  });
});
