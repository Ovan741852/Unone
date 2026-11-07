import {test} from 'node:test';import assert from 'node:assert/strict';
import {createNetworkHost} from './network-host.mjs';
class Socket{static last;sent=[];constructor(url){this.url=url;Socket.last=this;}send(t){this.sent.push(JSON.parse(t));}close(){this.closed=true;}}
const setup=search=>{const rows=[];const host=createNetworkHost({row:(...r)=>rows.push(r),location:{search:search??'',hostname:'example'},WebSocket:Socket});return{rows,host};};
test('the relay comes from the command, the page or its host',()=>{
 setup().host.sync({frame:1,network_commands:[{kind:'open',room:'a'}]});assert.equal(Socket.last.url,'ws://example:8433');
 setup('?relay=ws://r:1').host.sync({frame:1,network_commands:[{kind:'open',room:'a'}]});assert.equal(Socket.last.url,'ws://r:1');
 setup('?relay=ws://r:1').host.sync({frame:1,network_commands:[{kind:'open',room:'a',url:'ws://u:2'}]});assert.equal(Socket.last.url,'ws://u:2');
});
test('text waits for the socket, a tick is taken once, rows come back',()=>{
 const {rows,host}=setup();const open={frame:1,network_commands:[{kind:'open',room:'a'},{kind:'send',data:'x'}]};
 host.sync(open);host.sync(open);const s=Socket.last;assert.deepEqual(s.sent,[]);
 s.onopen();assert.deepEqual(s.sent,[{t:'join',room:'a'},{t:'send',data:'x'}]);
 host.sync({frame:2,network_commands:[{kind:'send',data:'y'}]});assert.deepEqual(s.sent.at(-1),{t:'send',data:'y'});
 s.onmessage({data:JSON.stringify({t:'open',peer:7})});s.onmessage({data:JSON.stringify({t:'message',peer:8,data:'z'})});
 assert.deepEqual(rows,[['open',7],['message',8,'z']]);
 host.sync({frame:3,network_commands:[{kind:'close'}]});assert.ok(s.closed);assert.deepEqual(rows.at(-1),['closed',0]);
});
test('a socket that drops says so',()=>{
 const {rows,host}=setup();host.sync({frame:1,network_commands:[{kind:'open',room:'a'}]});Socket.last.onclose();assert.deepEqual(rows,[['closed',0]]);
});
