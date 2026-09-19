'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { shell } = (() => { try { return require('electron'); } catch { return { shell: null }; } })();

const TEMPLATES = {
  'node-express': {
    description: 'Node.js Express REST API',
    files: {
      'package.json': (name) => JSON.stringify({ name, version: '1.0.0', description: 'Express REST API', main: 'index.js', scripts: { start: 'node index.js', dev: 'nodemon index.js' }, dependencies: { express: '^4.18.2' }, devDependencies: { nodemon: '^3.0.1' } }, null, 2),
      'index.js': () => `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 3000;\napp.use(express.json());\napp.get('/', (req, res) => res.json({ message: 'API is running', status: 'ok' }));\napp.listen(PORT, () => console.log('Server running on port ' + PORT));\n`,
      '.gitignore': () => 'node_modules\n.env\n*.log\n',
      '.env': () => 'PORT=3000\n',
      'README.md': (name) => '# ' + name + '\n\nExpress REST API starter.\n\n## Start\n\n```bash\nnpm install\nnpm start\n```\n',
      'routes/index.js': () => `const { Router } = require('express');\nconst router = Router();\nrouter.get('/health', (req, res) => res.json({ status: 'healthy' }));\nmodule.exports = router;\n`,
    },
    install: 'npm.cmd',
    installArgs: ['install'],
  },
  'python-flask': {
    description: 'Python Flask web app',
    files: {
      'app.py': (name) => `from flask import Flask, jsonify\napp = Flask(__name__)\n\n@app.route('/')\ndef home():\n    return jsonify({'message': '${name} is running', 'status': 'ok'})\n\nif __name__ == '__main__':\n    app.run(debug=True, port=5000)\n`,
      'requirements.txt': () => 'flask>=3.0.0\n',
      '.gitignore': () => '__pycache__\n*.pyc\nvenv\n.env\n',
      'README.md': (name) => '# ' + name + '\n\nFlask web app starter.\n\n## Start\n\n```bash\npip install -r requirements.txt\npython app.py\n```\n',
    },
    install: null,
  },
  'react-tailwind': {
    description: 'React + Tailwind CSS starter',
    files: {
      'package.json': (name) => JSON.stringify({ name, version: '0.0.0', scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' }, dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' }, devDependencies: { '@vitejs/plugin-react': '^4.0.0', vite: '^5.0.0', tailwindcss: '^3.4.0', autoprefixer: '^10.4.16', postcss: '^8.4.32' } }, null, 2),
      'index.html': (name) => `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${name}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>\n</html>\n`,
      'src/main.jsx': () => `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\nimport './index.css';\nReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);\n`,
      'src/App.jsx': (name) => `export default function App() {\n  return (\n    <div className="min-h-screen bg-gray-900 flex items-center justify-center">\n      <h1 className="text-4xl font-bold text-white">${name}</h1>\n    </div>\n  );\n}\n`,
      'src/index.css': () => `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`,
      'tailwind.config.js': () => `/** @type {import('tailwindcss').Config} */\nexport default { content: ['./index.html','./src/**/*.{js,ts,jsx,tsx}'], theme: { extend: {} }, plugins: [] };\n`,
      'vite.config.js': () => `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n`,
      '.gitignore': () => 'node_modules\ndist\n.env\n',
    },
    install: 'npm.cmd',
    installArgs: ['install'],
  },
  'html-starter': {
    description: 'Plain HTML5 + CSS + JavaScript',
    files: {
      'index.html': (name) => `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>${name}</h1>\n  <script src="script.js"></script>\n</body>\n</html>\n`,
      'style.css': () => `* { box-sizing: border-box; margin: 0; padding: 0; }\nbody { font-family: system-ui, sans-serif; background: #f5f5f5; padding: 2rem; }\nh1 { color: #333; }\n`,
      'script.js': (name) => `console.log('Hello from ${name}');\n`,
      'README.md': (name) => '# ' + name + '\n\nHTML5 starter project.\n',
    },
    install: null,
  },
};

function detectTemplate(description) {
  const d = description.toLowerCase();
  if (/react|tailwind/.test(d)) return 'react-tailwind';
  if (/flask|python/.test(d)) return 'python-flask';
  if (/express|node|api|rest/.test(d)) return 'node-express';
  if (/html|webpage|website|landing/.test(d)) return 'html-starter';
  return 'node-express';
}

class ScaffoldingService {
  templates() {
    return Object.entries(TEMPLATES).map(([id, t]) => ({ id, description: t.description }));
  }

  async scaffold({ name, template, destination }) {
    const projectName = (name || 'my-project').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const templateKey = template ? detectTemplate(template) : detectTemplate(name || '');
    const tpl = TEMPLATES[templateKey];
    if (!tpl) throw new Error('Unknown project template: ' + templateKey);

    const baseDir = destination || path.join(os.homedir(), 'Desktop');
    const projectDir = path.join(baseDir, projectName);

    if (fs.existsSync(projectDir)) throw new Error('Directory already exists: ' + projectDir + '. Choose a different name.');
    fs.mkdirSync(projectDir, { recursive: true });

    for (const [relPath, generator] of Object.entries(tpl.files)) {
      const fullPath = path.join(projectDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, generator(projectName), 'utf8');
    }

    try {
      if (shell && shell.openPath) await shell.openPath(projectDir);
    } catch { /* headless context */ }

    return {
      summary: 'Created ' + tpl.description + ' project "' + projectName + '" at ' + projectDir,
      projectDir,
      template: templateKey,
      filesCreated: Object.keys(tpl.files).length,
      readyToInstall: !!tpl.install,
      installCommand: tpl.install ? tpl.install + ' ' + (tpl.installArgs || []).join(' ') : null,
    };
  }

  async runInstall({ projectDir, template }) {
    const templateKey = detectTemplate(template || '');
    const tpl = TEMPLATES[templateKey];
    if (!tpl || !tpl.install) return { summary: 'No install step needed for this project type.' };
    const { stdout, stderr } = await execFileAsync(tpl.install, tpl.installArgs || [], { cwd: projectDir, timeout: 120000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return { summary: 'Dependencies installed for ' + projectDir, output: (stdout + stderr).trim().slice(0, 500) };
  }
}

module.exports = { ScaffoldingService };
