const fs = require('fs');
const path = require('path');
const { app, desktopCapturer } = require('electron');

class ScreenService {
  async capture() {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources.length) throw new Error('No display is available for capture.');
    const output = path.join(app.getPath('temp'), `jarvis-screen-${Date.now()}.png`);
    fs.writeFileSync(output, sources[0].thumbnail.toPNG());
    return output;
  }

  async analyze(prompt, provider) {
    const screenshotPath = await this.capture();
    if (!provider || typeof provider.analyzeImage !== 'function') {
      throw new Error('No AI vision provider is available to analyze the screen.');
    }
    const analysis = await provider.analyzeImage(screenshotPath, prompt);
    return {
      screenshotPath,
      analysis,
    };
  }
}
module.exports = { ScreenService };
