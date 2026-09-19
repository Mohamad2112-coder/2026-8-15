'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

class ComputerControlService {
  async type(text) { return this.run('[System.Windows.Forms.SendKeys]::SendWait($args[0])', text); }
  async press(keys) { return this.run('[System.Windows.Forms.SendKeys]::SendWait($args[0])', keys); }
  async click(x, y, button = 'left', double = false) {
    const code = `Add-Type @'\nusing System; using System.Runtime.InteropServices; public class Mouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,IntPtr e); }\n'@; [Mouse]::SetCursorPos([int]$args[0],[int]$args[1]); $down=2;$up=4; if($args[2] -eq 'right'){$down=8;$up=16}; [Mouse]::mouse_event($down,0,0,0,[IntPtr]::Zero); [Mouse]::mouse_event($up,0,0,0,[IntPtr]::Zero); if([bool]::Parse($args[3])){[Mouse]::mouse_event($down,0,0,0,[IntPtr]::Zero);[Mouse]::mouse_event($up,0,0,0,[IntPtr]::Zero)}`;
    return this.run(code, x, y, button, String(double));
  }

  /**
   * Capture screen → ask Gemini Vision to find element → click it.
   * @param {string} targetDescription  Natural language e.g. "the blue OK button"
   * @param {object} screen   ScreenService instance
   * @param {object} provider GeminiProvider instance
   */
  async clickTarget(targetDescription, screen, provider) {
    if (!screen || !provider) throw new Error('Screen service and AI provider are required for visual click.');

    const screenshotPath = await screen.capture();
    const prompt = `You are a computer vision assistant. Look at this screenshot and find: "${targetDescription}".
Reply with ONLY a JSON object on a single line: {"x": <number>, "y": <number>}
The numbers must be the pixel coordinates of the CENTER of the element on the screen.
If you cannot find it, reply: {"x": null, "y": null}`;

    const responseText = await provider.analyzeImage(screenshotPath, prompt);

    // Parse coordinates from response
    const match = /\{\s*"x"\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*"y"\s*:\s*(-?\d+(?:\.\d+)?)\s*\}/.exec(responseText);
    if (!match) {
      // Check for null response
      if (/null/.test(responseText)) {
        throw new Error(`Could not locate "${targetDescription}" on screen. Try describing it more specifically.`);
      }
      throw new Error(`AI did not return valid coordinates for "${targetDescription}". Response: ${responseText.slice(0, 100)}`);
    }

    const x = Math.round(parseFloat(match[1]));
    const y = Math.round(parseFloat(match[2]));
    await this.click(x, y);
    return { summary: `Clicked "${targetDescription}" at (${x}, ${y}).`, x, y };
  }

  async run(script, ...args) {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -AssemblyName System.Windows.Forms; ${script}`, ...args.map(String)], { windowsHide: true });
    return { summary: 'Computer control action completed.' };
  }
}
module.exports = { ComputerControlService };

