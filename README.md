# ORION — Windows desktop AI assistant (Phase 1)

JARVIS is a local-first Windows 10 desktop assistant foundation. It is not a browser tab: it runs in its own Electron desktop window and delegates system actions through a constrained main-process action layer.

## Included in Phase 1

- Original desktop interface with command history and action confirmation.
- Provider abstraction: `AIProvider` and placeholders for OpenAI, Claude, Gemini, and local models.
- Provider abstraction ready for a future model integration.
- Encrypted API-key storage using Electron `safeStorage` (Windows DPAPI) when a future provider is added.
- Natural-language local command router for folders, applications, web search, file search, memory, screenshots, and approved PowerShell commands.
- Local long-term memory stored under the app’s Windows user-data directory.
- Explicit confirmation before commands capable of executing arbitrary PowerShell.
- Content Security Policy, context isolation, sandboxed renderer, and a minimal IPC allowlist.

## Included in Phase 2

- Global Windows shortcut: `Ctrl + Numpad 4` focuses JARVIS and captures one spoken command.
- Explicit local listening mode: continuous commands execute only after the spoken wake word “Jarvis”.
- On-device speech recognition and speech synthesis using Windows `System.Speech`; microphone audio is not sent to a cloud provider by this feature.
- `TextToSpeechProvider` abstraction with a calm original Windows voice configuration. No actor voice is copied or imitated.

## Included in Phase 3

- A responsive, original “command center” interface with an animated agent core. It reflects idle, listening, thinking, executing, speaking, and error states.
- Throttled (5-second) CPU, RAM, disk, and network status display, plus microphone, voice engine, current-task, memory, and tool-activity visibility.
- `ToolManager` registry with concrete Folder, File, Application, Browser, Screenshot, Memory, and Terminal tools. Terminal commands remain approval-gated; mouse, keyboard, process, clipboard, code, and system control are reserved behind disabled approval-gated tool entries until their safe workflows are implemented.

## Included in Phase 4

- Recursive local file search by filename, extension, modified date, and (for supported text formats) content; local PDF text extraction when Poppler's `pdftotext` is installed.
- File operations plan before mutation. Bulk moves and deletions require an explicit approval; deletions go to the Windows Recycle Bin instead of permanent removal.
- SHA-256 duplicate-file discovery, safe folder creation, and sample natural-language routes for PDFs, folders, duplicate searches, bulk PDF moves, and deletion review.
- On-demand screenshot capture only. The image is shown in the command center; automatic screen interpretation intentionally awaits a configured vision provider.
- Approval-gated mouse click and keyboard type/shortcut tool implementations for future controlled automation flows.

## Included in Phase 5

- Installed application resolution uses Windows PATH discovery first and verified known per-user/per-machine locations second; aliases include Chrome, Edge, VS Code, File Explorer, Terminal, PowerShell, Notepad, Calculator, Discord, and Spotify.
- Development environment detection for Node.js, npm, Python, Git, and PowerShell. Development commands, including virtual-environment creation, require confirmation.
- Local browser tools can open/search the web and fetch/read public pages. Downloads and form submission are approval-gated and intentionally require a reviewed workflow before activation.

## Prerequisites

- Windows 10 (64-bit)
- Node.js 20 LTS or newer

## Run

```powershell
npm install
npm start
```

No cloud model key is required for local Windows tools. A future provider can be configured through **Settings**.

## Useful commands

- “Open my Downloads folder”
- “Open Notepad”
- “Find the PDF I downloaded yesterday”
- “Search the web for Windows 10 accessibility settings”
- “Remember that my project is called Atlas”
- “What do you remember about my project?”
- “Take a screenshot”
- “Run PowerShell: Get-ChildItem $env:USERPROFILE\\Downloads” (confirmation required)

## Architecture

`renderer` → narrow `preload` bridge → `main process` → `CommandService` / `AIProvider` / Windows action adapters.

The renderer never receives the API key and cannot call Node.js APIs directly. Adding a provider means implementing `AIProvider.complete()` and registering it in `ProviderFactory`.

## Phase 1 boundaries

Voice input uses the operating system’s embedded Chromium speech capability when available; it degrades gracefully to typed commands. Fully autonomous visual computer control, application-specific automation, and code-project orchestration belong to the next phase, where each needs a robust approval, planning, and recovery workflow.
