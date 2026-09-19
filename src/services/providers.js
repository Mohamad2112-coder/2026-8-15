'use strict';

const fs = require('fs');
const path = require('path');

class AIProvider {
  async complete(_messages) { throw new Error('Not implemented.'); }
  async analyzeImage(_imagePath, _prompt) { throw new Error('Not implemented.'); }
}

class UnconfiguredProvider extends AIProvider {
  async complete() {
    throw new Error('Gemini AI is not configured yet. Please provide a GEMINI_API_KEY in your .env file or via Settings.');
  }
  async analyzeImage() {
    throw new Error('Screen analysis requires Gemini. Please set GEMINI_API_KEY in your .env file or via Settings.');
  }
}

class GeminiProvider extends AIProvider {
  constructor({ apiKey, model = 'gemini-3.6-flash', baseUrl = 'https://generativelanguage.googleapis.com' } = {}) {
    super();
    if (!apiKey) throw new Error('GeminiProvider requires an API key.');
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Translates chat messages [{ role, content }] into Gemini format:
   * system messages -> systemInstruction
   * user/assistant messages -> contents [{ role: 'user' | 'model', parts: [{ text }] }]
   * function responses -> contents [{ role: 'function', parts: [{ functionResponse }] }]
   */
  async complete(messages = [], options = {}) {
    const systemParts = [];
    const contents = [];

    for (const msg of messages) {
      if (!msg) continue;

      if (msg.role === 'system') {
        if (msg.content) systemParts.push({ text: String(msg.content).trim() });
      } else if (msg.role === 'function') {
        contents.push({
          role: 'function',
          parts: [{
            functionResponse: {
              name: msg.name,
              response: { content: msg.response },
            },
          }],
        });
      } else if (msg.functionCall) {
        contents.push({
          role: 'model',
          parts: [{
            functionCall: {
              name: msg.functionCall.name,
              args: msg.functionCall.args || {},
            },
          }],
        });
      } else if (msg.content) {
        const content = String(msg.content).trim();
        if (!content) continue;
        const role = msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user';
        const last = contents[contents.length - 1];
        if (last && last.role === role && last.parts && last.parts[0]?.text) {
          last.parts.push({ text: content });
        } else {
          contents.push({ role, parts: [{ text: content }] });
        }
      }
    }

    if (!contents.length) {
      throw new Error('No user messages to complete.');
    }

    if (contents[0].role !== 'user') {
      contents.unshift({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    const body = { contents };
    if (systemParts.length > 0) {
      body.systemInstruction = { parts: systemParts };
    }

    if (Array.isArray(options.tools) && options.tools.length > 0) {
      body.tools = [{ functionDeclarations: options.tools }];
    }

    const endpoint = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errDetail = '';
      try {
        const errJson = await res.json();
        errDetail = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errDetail = await res.text();
      }
      throw new Error(`Gemini API error (${res.status}): ${errDetail}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const functionCallPart = candidate?.content?.parts?.find(p => p.functionCall);
    if (functionCallPart && functionCallPart.functionCall) {
      return {
        type: 'function_call',
        name: functionCallPart.functionCall.name,
        args: functionCallPart.functionCall.args || {},
      };
    }

    const reply = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
    if (!reply && !functionCallPart) {
      if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini response blocked: ${data.promptFeedback.blockReason}`);
      }
      return options.tools ? { type: 'text', text: 'I received an empty response from Gemini.' } : 'I received an empty response from Gemini.';
    }

    if (options.tools) {
      return { type: 'text', text: reply };
    }
    return reply;
  }

  /**
   * Multimodal vision analysis for an image file on disk.
   */
  async analyzeImage(imagePath, prompt = 'Describe what you see on this screen and provide any relevant advice or information.') {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const base64Data = imageBuffer.toString('base64');

    const body = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            {
              text: prompt || 'Analyze this screen capture in detail.',
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: 'You are ORION Vision, a desktop AI assistant examining the user\'s Windows screen. Be accurate, concise, helpful, and highlight key UI elements, errors, or documents visible.' }],
      },
    };

    const endpoint = `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let errDetail = '';
      try {
        const errJson = await res.json();
        errDetail = errJson.error?.message || JSON.stringify(errJson);
      } catch {
        errDetail = await res.text();
      }
      throw new Error(`Gemini Vision API error (${res.status}): ${errDetail}`);
    }

    const data = await res.json();
    const reply = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n') || '';
    if (!reply) {
      if (data.promptFeedback?.blockReason) {
        throw new Error(`Gemini vision blocked: ${data.promptFeedback.blockReason}`);
      }
      return 'I could not extract any details from the screen.';
    }
    return reply;
  }
}

class ProviderFactory {
  constructor(settings) {
    this.settings = settings;
  }

  get() {
    const key = (this.settings && typeof this.settings.getKey === 'function')
      ? this.settings.getKey()
      : (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || null);

    if (!key) {
      return new UnconfiguredProvider();
    }

    const config = (this.settings && typeof this.settings.read === 'function')
      ? this.settings.read()
      : {};

    const model = config.model && config.model !== 'Not configured' ? config.model : 'gemini-3.6-flash';
    const baseUrl = config.baseUrl && config.baseUrl !== 'https://example.invalid'
      ? config.baseUrl
      : 'https://generativelanguage.googleapis.com';

    return new GeminiProvider({ apiKey: key, model, baseUrl });
  }
}

module.exports = {
  AIProvider,
  ProviderFactory,
  GeminiProvider,
  OpenAIProvider: UnconfiguredProvider,
  ClaudeProvider: UnconfiguredProvider,
  LocalModelProvider: UnconfiguredProvider,
};
