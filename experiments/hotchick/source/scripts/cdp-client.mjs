export class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.serial = 0;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', event => {
      const value = JSON.parse(String(event.data));
      if (value.id) {
        const request = this.pending.get(value.id);
        if (!request) return;
        this.pending.delete(value.id);
        clearTimeout(request.timer);
        value.error ? request.reject(new Error(JSON.stringify(value.error))) : request.resolve(value.result);
      } else for (const listener of this.listeners) listener(value);
    });
    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('CDP closed')); }
      this.pending.clear();
    });
  }
  static async connect(port = 9237) {
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true}); });
    const client = new CdpClient(socket);
    client.version = version;
    return client;
  }
  send(method, params = {}, sessionId, timeout = 120000) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, {resolve, reject, timer});
      this.socket.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  async evaluate(sessionId, expression, timeout = 120000) {
    const value = await this.send('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}, sessionId, timeout);
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result?.value;
  }
  close() { this.socket.close(); }
}
