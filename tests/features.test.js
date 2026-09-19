const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { RagService } = require('../src/services/rag-service');
const { ScaffoldingService } = require('../src/services/scaffolding-service');
const { ComputerControlService } = require('../src/services/computer-control-service');
const { CommandService } = require('../src/services/command-service');
const { ToolManager } = require('../src/services/tool-manager');
const { PermissionManager } = require('../src/services/permission-manager');

test('RagService splits text into chunks and searches via TF-IDF', () => {
  const rag = new RagService();
  const text = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
  const chunks = rag._chunk(text);
  assert.ok(chunks.length > 0);
  rag.chunks = [{ text: 'contract warranty period is 12 months', source: 'contract.txt', chunkIndex: 0 }, { text: 'the weather outside is sunny', source: 'weather.txt', chunkIndex: 0 }];
  rag.vectors = rag.chunks.map(c => rag._tfidf(c.text));
  const results = rag.search('warranty period');
  assert.equal(results.length, 1);
  assert.equal(results[0].source, 'contract.txt');
});

test('ScaffoldingService detects template correctly', async () => {
  const service = new ScaffoldingService();
  let scaffolded = false;
  const originalMkdir = fs.mkdirSync;
  const originalWrite = fs.writeFileSync;
  try {
    fs.mkdirSync = () => {};
    fs.writeFileSync = () => { scaffolded = true; };
    const res = await service.scaffold({ name: 'my-react-app', template: 'react-tailwind', destination: 'C:\\fake' });
    assert.equal(res.template, 'react-tailwind');
    assert.ok(scaffolded);
  } finally {
    fs.mkdirSync = originalMkdir;
    fs.writeFileSync = originalWrite;
  }
});

test('ComputerControlService clickTarget extracts coordinates and clicks', async () => {
  let clicked = false;
  const computer = new ComputerControlService();
  computer.click = async (x, y) => { assert.equal(x, 150); assert.equal(y, 251); clicked = true; };
  const screen = { capture: async () => 'fake.png' };
  const provider = { analyzeImage: async () => 'Found it here: {"x": 150, "y": 250.5}' };
  const res = await computer.clickTarget('the button', screen, provider);
  assert.equal(res.x, 150);
  assert.equal(res.y, 251);
  assert.ok(clicked);
});

test('CommandService routes scaffold command correctly', async () => {
  const tools = new ToolManager({ memory: {}, screen: {}, computer: {}, applications: {}, developer: {}, browser: {}, permissions: new PermissionManager(), providers: {}, files: {}, reminders: {}, rag: {}, scaffolding: {} });
  let scaffoldCalled = false;
  tools.execute = async (id, params) => {
    if (id === 'project.scaffold') {
      scaffoldCalled = true;
      assert.equal(params.name, 'my-app');
      return { summary: 'scaffolded', readyToInstall: false };
    }
  };
  const service = new CommandService({ tools, modes: { getMode: () => 'NORMAL', parseExplicitSwitch: () => null }, permissions: tools.permissions });
  const res = await service.handle('create a react-tailwind project called my-app in C:\\fake');
  assert.equal(res.kind, 'approval');
  const actionRes = await service.executeApproved(res.action);
  assert.ok(scaffoldCalled);
});
