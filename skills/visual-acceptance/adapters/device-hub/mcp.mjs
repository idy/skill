import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Minimal newline-delimited MCP client; no shell or assumed remote tool names. */
export class StdioMCP {
  constructor(command = ['xcrun', 'mcpbridge'], { timeoutMs = 60000 } = {}) {
    if (!Array.isArray(command) || !command.length || command.some(v => typeof v !== 'string')) throw new Error('bridge command must be a nonempty argv array');
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    // Do not surface arbitrary bridge stderr (which may contain session secrets).
    this.child.stderr.resume();
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`Device Hub bridge exited (${code})`)));
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message || 'MCP error'));
      else item.resolve(message.result);
    });
  }
  fail(error) {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(error); }
    this.pending.clear();
  }
  request(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Device Hub ${method} timed out`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  async initialize() {
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'pi-visual-acceptance', version: '1.0' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools } = await this.request('tools/list');
    return tools;
  }
  async call(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) {
      let detail = (result.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').slice(0, 2000);
      for (const [key, value] of Object.entries(args || {})) {
        if (/key|token|secret/i.test(key) && typeof value === 'string' && value) detail = detail.replaceAll(value, '[redacted]');
      }
      throw new Error(`Device Hub ${name} failed: ${detail}`);
    }
    if (result.structuredContent) return result.structuredContent;
    for (const block of result.content || []) {
      if (block.type === 'text') { try { return JSON.parse(block.text); } catch {} }
    }
    throw new Error(`Device Hub ${name} returned no structured result`);
  }
  close() { this.fail(new Error('Device Hub bridge closed')); this.child.stdin.end(); this.child.kill(); }
}
