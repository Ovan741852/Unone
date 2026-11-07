// node scripts/net-relay.mjs [port]: rooms of sessions over WebSocket for api.network (docs/network.md).
// Each text frame is JSON. From a session: {t:"join",room}, {t:"send",data}. To it: {t:"open",peer},
// {t:"peer_join",peer}, {t:"peer_leave",peer}, {t:"message",peer,data}.
import http from 'node:http';
import crypto from 'node:crypto';
const port = Number(process.argv[2] ?? 8433);
const rooms = new Map();
let nextPeer = 1;
function frame(text) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x81, body.length])
    : body.length < 65536 ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
    : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(body.length); return b; })()]);
  return Buffer.concat([head, body]);
}
function send(session, value) { if (!session.socket.destroyed) session.socket.write(frame(JSON.stringify(value))); }
function leave(session) {
  const room = rooms.get(session.room);
  if (!room) return;
  room.delete(session);
  for (const other of room) send(other, {t: 'peer_leave', peer: session.peer});
  if (room.size === 0) rooms.delete(session.room);
  session.room = null;
}
function receive(session, text) {
  const message = JSON.parse(text);
  if (message.t === 'join' && !session.room && typeof message.room === 'string') {
    session.room = message.room;
    const room = rooms.get(message.room) ?? new Set();
    rooms.set(message.room, room);
    send(session, {t: 'open', peer: session.peer});
    for (const other of room) { send(other, {t: 'peer_join', peer: session.peer}); send(session, {t: 'peer_join', peer: other.peer}); }
    room.add(session);
  } else if (message.t === 'send' && session.room) {
    for (const other of rooms.get(session.room)) if (other !== session) send(other, {t: 'message', peer: session.peer, data: message.data});
  }
}
const server = http.createServer((_, res) => { res.writeHead(426); res.end('WebSocket only\n'); });
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const session = {socket, peer: nextPeer++, room: null};
  let pending = Buffer.alloc(0), parts = [];
  socket.on('data', data => {
    pending = Buffer.concat([pending, data]);
    for (;;) {
      if (pending.length < 2) return;
      const opcode = pending[0] & 15, final = pending[0] & 128;
      let length = pending[1] & 127, at = 2;
      if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); at = 4; }
      else if (length === 127) { if (pending.length < 10) return; length = Number(pending.readBigUInt64BE(2)); at = 10; }
      const masked = pending[1] & 128;
      if (pending.length < at + (masked ? 4 : 0) + length) return;
      const mask = masked ? pending.subarray(at, at + 4) : null;
      if (masked) at += 4;
      const body = Buffer.from(pending.subarray(at, at + length));
      if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
      pending = pending.subarray(at + length);
      if (opcode === 8) { socket.end(); return; }
      if (opcode === 9) { socket.write(Buffer.concat([Buffer.from([0x8A, body.length]), body])); continue; }
      if (opcode === 1 || opcode === 0) {
        parts.push(body);
        if (final) { const text = Buffer.concat(parts).toString(); parts = []; try { receive(session, text); } catch (error) { console.error(error.message); } }
      }
    }
  });
  socket.on('close', () => leave(session));
  socket.on('error', () => leave(session));
});
server.listen(port, () => console.log('net relay on', port));
