const { shell } = require('electron');

class BrowserService {
  async open(url) { const target = /^https?:\/\//i.test(url) ? url : `https://${url}`; await shell.openExternal(target); return { summary: `Opened ${target}.` }; }
  async search(query) { return this.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`); }
  async read(url) {
    const response = await fetch(url, { headers: { 'User-Agent': 'JARVIS local assistant' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Website returned ${response.status}.`);
    const html = await response.text(); const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() || new URL(url).hostname;
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/gi, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
    return { title, text };
  }
}
module.exports = { BrowserService };
