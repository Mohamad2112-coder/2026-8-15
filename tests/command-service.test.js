const test = require('node:test');
const assert = require('node:assert/strict');
const { CommandService } = require('../src/services/command-service');
const { WindowsVoiceService } = require('../src/services/voice-service');

test('requests approval before PowerShell execution', async () => {
  const service = new CommandService({ memory: { find: () => [] }, providers: {}, tools: { execute: async () => ({}) }, files: {} });
  const result = await service.handle('Run PowerShell: Get-Date');
  assert.equal(result.kind, 'approval');
  assert.ok(result.action.id);
});
test('stores an explicit memory without calling a model', async () => {
  let saved = ''; const service = new CommandService({ memory: { add: x => { saved = x; return { note: x }; }, find: () => [] }, providers: {}, tools: { execute: async (_id, value) => { saved = value.note; } }, files: {} });
  const result = await service.handle('Remember that my project is Atlas');
  assert.equal(saved, 'my project is Atlas'); assert.match(result.text, /Noted/);
});
test('only routes continuous speech with the Jarvis wake word', () => {
  const voice = new WindowsVoiceService(); let command = null;
  voice.on('command', event => { command = event.text; });
  voice.handleLine(JSON.stringify({ type: 'transcript', text: 'hello there' }), 'continuous');
  assert.equal(command, null);
  voice.handleLine(JSON.stringify({ type: 'transcript', text: 'Jarvis, open Chrome' }), 'continuous');
  assert.equal(command, 'open Chrome');
});

test('routes screen analysis to vision provider when available', async () => {
  let analyzedPrompt = '';
  const mockProvider = {
    analyzeImage: async (_path, prompt) => {
      analyzedPrompt = prompt;
      return 'I see an open code editor with JavaScript files.';
    }
  };
  const service = new CommandService({
    memory: { find: () => [] },
    providers: { get: () => mockProvider },
    tools: { execute: async (id) => ({ path: 'C:/temp/test.png' }) },
    files: {},
  });

  const result = await service.handle('Jarvis, analyze what is on my screen');
  assert.equal(result.kind, 'screen');
  assert.equal(result.path, 'C:/temp/test.png');
  assert.match(result.text, /code editor/);
});

test('screen analysis informs user when Gemini is unconfigured', async () => {
  const service = new CommandService({
    memory: { find: () => [] },
    providers: { get: () => null },
    tools: { execute: async (id) => ({ path: 'C:/temp/test.png' }) },
    files: {},
  });

  const result = await service.handle('what is on my screen');
  assert.equal(result.kind, 'screen');
  assert.equal(result.path, 'C:/temp/test.png');
  assert.match(result.text, /GEMINI_API_KEY/);
});

test('GeminiProvider factory returns GeminiProvider when API key exists', () => {
  const { ProviderFactory, GeminiProvider } = require('../src/services/providers');
  const factory = new ProviderFactory({
    getKey: () => 'fake-key-12345',
    read: () => ({ model: 'gemini-1.5-flash' }),
  });
  const provider = factory.get();
  assert.ok(provider instanceof GeminiProvider);
  assert.equal(provider.apiKey, 'fake-key-12345');
  assert.equal(provider.model, 'gemini-1.5-flash');
});

