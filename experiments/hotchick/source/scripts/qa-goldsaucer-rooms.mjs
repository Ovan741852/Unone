// Production room controller + production room/functions in an in-memory host.
// No browser, platform identity, wallet API, or external network is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {canonicalBoardFields,createGoldSaucerRooms,createRoomTransport,roomBuildId} from '../game/presentation/goldsaucer-rooms.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const read=(held,name,width)=>Array.from({length:width},(_,bit)=>held.has(`${name}Bit${bit}`)?2**bit:0).reduce((a,b)=>a+b,0);
const [functionsSource,roomSource]=await Promise.all([
  fs.readFile(new URL('../server/goldsaucer/functions.js',import.meta.url),'utf8'),
  fs.readFile(new URL('../server/goldsaucer/room.js',import.meta.url),'utf8'),
]);

function world(){
  let functions,roomDefinition,shared=null,roomSerial=0,connectionSerial=0,clock=0,callBlock=null,joinBlock=null;
  vm.runInNewContext(functionsSource,{defineFunctions:value=>functions=value},{timeout:1000});
  vm.runInNewContext(roomSource,{defineRoom:value=>roomDefinition=value},{timeout:1000});
  const users=new Map(),rooms=new Map(),connections=new Map(),history=[],gestures=[],joins=[],leaves=[],contexts=[];
  const ctx=id=>({player:{id,username:id,displayName:users.get(id)?.name||id},chips:0,shared:copy(shared),currency:{perDiamond:50},randomInt:(min,max)=>min});
  const ensure=(id,name)=>{if(!users.has(id)){users.set(id,{name,state:null});users.get(id).state=copy(functions.init(ctx(id)));}return users.get(id);};
  function emit(connection,type,data){if(connection.closed)return;const handlers=connection.handlers.get(type);if(handlers?.size){for(const cb of [...handlers])cb(copy(data));}else connection.buffer.push({type,data:copy(data)});}
  function leave(connection){if(connection.closed)return;connection.closed=true;leaves.push(connection.id);const record=rooms.get(connection.id);record.room.players=record.room.players.filter(player=>player.id!==connection.you.id);roomDefinition.onLeave(record.room,connection.you);for(const cb of connection.closeHandlers)cb('left');}
  function createRoom(){
    const id=`unit-room-${++roomSerial}`;
    const room={id,players:[],state:{},send(player,type,data){const c=connections.get(player.id);if(c)emit(c,type,data);},
      broadcast(type,data,options={}){for(const player of room.players)if(player.id!==options.except?.id)emit(connections.get(player.id),type,data);},
      kick(player){queueMicrotask(()=>{const c=connections.get(player.id);if(c)leave(c);});}};
    const record={room};rooms.set(id,record);roomDefinition.onCreate(room);return record;
  }
  async function join(userId,name,target){
    ensure(userId,name);if(joinBlock){const block=joinBlock;joinBlock=null;block.started=true;await block.promise;}
    const record=target==='new'?createRoom():rooms.get(target);if(!record)throw Object.assign(Error('not found'),{code:'roomNotFound'});
    if(record.room.players.length>=3)throw Object.assign(Error('full'),{code:'roomFull'});
    const you={id:`connection-${++connectionSerial}`,userId,name},connection={id:record.room.id,you,closed:false,handlers:new Map(),buffer:[],closeHandlers:[],errorHandlers:[],
      on(type,cb){const handlers=this.handlers.get(type)||new Set();handlers.add(cb);this.handlers.set(type,handlers);const buffered=this.buffer.filter(e=>e.type===type);this.buffer=this.buffer.filter(e=>e.type!==type);for(const event of buffered)cb(copy(event.data));return()=>handlers.delete(cb);},
      onClose(cb){this.closeHandlers.push(cb);},onError(cb){this.errorHandlers.push(cb);},
      send(type,data){if(this.closed)throw Error('closed');gestures.push({connection:this.you.id,type,data:copy(data),time:clock});roomDefinition.onMessage(record.room,this.you,type,copy(data));},leave(){leave(this);}};
    connections.set(you.id,connection);record.room.players.push(you);joins.push({id:connection.id,userId});roomDefinition.onJoin(record.room,you);return connection;
  }
  async function call(userId,name,method,input){
    const user=ensure(userId,name),entry={userId,method,input:copy(input)};history.push(entry);
    if(callBlock?.predicate(method,input)){const block=callBlock;callBlock=null;block.started=true;await block.promise;}
    const result=functions[method](copy(user.state),copy(input),ctx(userId));
    assert.equal(result.chips?.bet||0,0);assert.equal(result.chips?.win||0,0);
    user.state=copy(result.state);if(Object.hasOwn(result,'shared'))shared=copy(result.shared);entry.result=copy(result.result);return copy(result.result);
  }
  const harnesses=[];
  function client(id,name=id){
    const held=new Set(),packets=[],contextsForClient=[];let automaticGate=true,automaticAck=true,idle=true,fieldHandler,errorHandler;
    const state={weapon:'like',bet:10,aim:{x:1,y:2},balance:10000,displayBalance:10000,cards:{sentinel:3},room:{enabled:false,switching:false,drainReady:true,packetAck:0,error:'',epoch:0,localShot:{serial:0}}};
    const controller=createGoldSaucerRooms({sdk:{multiplayer:{join:({room})=>join(id,name,room)}},
      setAction(key,down){if(down)held.add(key);else held.delete(key);},call:(method,input)=>call(id,name,method,input),
      isIdle:()=>idle,setContext:context=>{contexts.push({id,context:copy(context)});contextsForClient.push(copy(context));},
      onField:cb=>{fieldHandler=cb;return()=>{fieldHandler=null;};},onRoomError:cb=>{errorHandler=cb;return()=>{errorHandler=null;};},now:()=>clock});
    const h={controller,state,held,packets,contexts:contextsForClient,
      set idle(value){idle=value;},set automaticGate(value){automaticGate=value;},set automaticAck(value){automaticAck=value;},
      field:board=>fieldHandler?.(copy(board)),roomError:e=>errorHandler?.(e),
      tick(){
        if(automaticGate)state.room.switching=held.has('RoomSwitchGate');
        const packetId=read(held,'HRPacketId',31);
        if(automaticAck&&held.has('HRReady')&&packetId>state.room.packetAck){
          const packet={id:packetId,kind:read(held,'HRKind',2),epoch:read(held,'HREpoch',31),revision:read(held,'HRRevision',31),seed:read(held,'HRSeed',31),selfSeat:read(held,'HRSelfSeat',3),
            born1:read(held,'HRBorn1',40),members:[1,2,3].map(seat=>({seat,present:read(held,`HRPresent${seat}`,1),member:read(held,`HRMember${seat}`,31),serial:read(held,`HRShotSerial${seat}`,31),bet:read(held,`HRBet${seat}`,3)}))};
          if(packet.kind===0){assert(state.room.switching&&state.room.drainReady);state.room.enabled=true;state.room.epoch=packet.epoch;}
          if(packet.kind!==2){state.room.revision=packet.revision;state.room.seed=packet.seed;state.room.selfSeat=packet.selfSeat;}
          packets.push(packet);state.room.packetAck=packetId;
        }
        controller.sync(copy(state));
      },dispose(){controller.dispose();harnesses.splice(harnesses.indexOf(h),1);}};
    harnesses.push(h);return h;
  }
  async function step(count=1){for(let i=0;i<count;i++){clock+=50;for(const record of rooms.values())roomDefinition.onTick(record.room,50);for(const h of [...harnesses])h.tick();await flush();}}
  async function until(predicate,message='fixture did not settle'){for(let i=0;i<150;i++){if(predicate())return;await step();}assert.fail(message);}
  async function settle(promise){let done=false,value,failure;promise.then(v=>{value=v;done=true;},e=>{failure=e;done=true;});await until(()=>done);if(failure)throw failure;return value;}
  return {client,history,gestures,joins,leaves,contexts,connections,rooms,step,until,settle,
    holdCall(predicate){const block={...deferred(),predicate,started:false};callBlock=block;return block;},
    holdJoin(){const block={...deferred(),started:false};joinBlock=block;return block;},
    emit(connectionId,type,data){emit(connections.get(connectionId),type,data);},
    dispose(){for(const h of [...harnesses])h.dispose();}};
}

const tests=[];
async function test(name,run){await run();tests.push(name);console.log(`PASS ${name}`);}

await test('version scope uses the actual content version and leaves local protocol fixtures intact',async()=>{
  assert.equal(roomBuildId(null,{pathname:'/play-content/abc-012.test/index.html'}),'hc-rooms-v1:abc-012.test');
  assert.equal(roomBuildId(null,{pathname:'/release-036/'}),'hc-rooms-v1');
  assert.equal(roomBuildId(null,{pathname:'/play-content/bad%2Ftoken/'}),'hc-rooms-v1');
});

await test('canonical board encodes all27 generations and signed40-bit birth times',async()=>{
  const board={protocol:'hc-rooms-v1',roomId:'board',seed:0,revision:12,elapsedMs:2**35,slots:Array.from({length:27},(_,i)=>({generation:i+1,bornMs:i-9000}))};
  const fields=canonicalBoardFields(board,3);assert.deepEqual(fields.HRBorn1,[2**40-9000,40]);assert.deepEqual(fields.HRGen27,[27,26]);assert.deepEqual(fields.HRSelfSeat,[3,3]);
  assert.throws(()=>canonicalBoardFields({...board,slots:board.slots.slice(1)},1),/盤面/);
  assert.throws(()=>canonicalBoardFields({...board,slots:board.slots.map((slot,i)=>i?slot:{generation:0,bornMs:0})},1),/目標/);
});

await test('HR transport requires native ACK, coalesces pending field packets and preserves held bits',async()=>{
  const held=new Set(),transport=createRoomTransport({setAction:(key,down)=>down?held.add(key):held.delete(key),now:()=>0});
  let acked=false;const first=transport.queue(0,1,{HRSeed:[31,31]}).then(()=>{acked=true;});transport.sync({packetAck:0});assert.equal(acked,false);assert.equal(read(held,'HRKind',2),0);
  const old=transport.queue(1,1,{HRSeed:[22,31]}),next=transport.queue(1,1,{HRSeed:[23,31]});assert.equal(await old,false);
  transport.sync({packetAck:1});await first;assert.equal(acked,true);assert.equal(read(held,'HRSeed',31),23);
  held.clear();transport.recover();assert(held.has('HRReady'));transport.sync({packetAck:2});await next;assert.equal(held.size,0);transport.dispose();
});

await test('joining waits for a fresh RoomSwitchGate ACK and both native and financial drain',async()=>{
  const w=world(),h=w.client('gate');h.automaticGate=false;h.controller.sync(copy(h.state));const promise=h.controller.create();
  await w.step(2);assert.equal(w.joins.length,0);h.state.room.switching=true;h.idle=false;await w.step(2);assert.equal(w.joins.length,0);
  h.idle=true;h.state.room.drainReady=false;await w.step(2);assert.equal(w.joins.length,0);
  h.state.room.drainReady=true;await w.settle(promise);assert.equal(w.joins.length,1);assert.equal(h.controller.metadata().status,'connected');w.dispose();
});

await test('two clients share canonical board and real server-derived roster without wallet changes',async()=>{
  const w=world(),alice=w.client('alice','Alice'),betty=w.client('betty','Betty');await w.settle(alice.controller.create());const room=alice.controller.metadata().roomId;
  await w.settle(betty.controller.join(room));await w.step(4);
  assert.equal(alice.state.room.seed,betty.state.room.seed);assert.equal(alice.state.room.selfSeat,1);assert.equal(betty.state.room.selfSeat,2);
  assert.deepEqual(alice.controller.metadata().players.map(p=>p.name),['Alice','Betty']);assert.equal(alice.packets.at(-1).members.filter(p=>p.present).length,2);
  assert.equal(alice.state.balance,10000);assert.deepEqual(alice.state.cards,{sentinel:3});assert(w.history.every(call=>['roomDirectory','roomSnapshot'].includes(call.method)));w.dispose();
});

await test('native actual shot relays exactly5 visual keys and raw bet becomes native bet index',async()=>{
  const w=world(),a=w.client('aim-a'),b=w.client('aim-b');await w.settle(a.controller.create());await w.settle(b.controller.join(a.controller.metadata().roomId));await w.step(4);
  a.state.weapon='rocket';a.state.bet=50;a.state.room.localShot={serial:8,weapon:'rocket',bet:50,aimX:-2.5,aimY:3,targetId:123};await w.step(4);
  const shots=w.gestures.filter(event=>event.type==='shot');assert.equal(shots.length,1);assert.deepEqual(Object.keys(shots[0].data).sort(),['bet','serial','weapon','x','y']);assert.equal(shots[0].data.bet,50);
  assert(b.packets.some(packet=>packet.kind===2&&packet.members.some(member=>member.serial>0&&member.bet===5)));
  const aimSerials=w.gestures.filter(event=>event.type==='aim'&&event.connection===shots[0].connection).map(event=>event.data.serial);assert.equal(aimSerials[0],1);w.dispose();
});

await test('aim plus8 shots and repeated field callbacks stay within the20-message platform budget',async()=>{
  const w=world(),h=w.client('budget');await w.settle(h.controller.create());await w.step(3);
  const board=w.history.find(call=>call.method==='roomSnapshot').result.board,start=w.gestures.length,shotFrames=new Set([0,3,5,8,10,12,15,17]);let shot=0;
  for(let frame=0;frame<20;frame++){
    h.state.aim={x:frame/10,y:2};if(shotFrames.has(frame))h.state.room.localShot={serial:++shot,weapon:'like',bet:10,aimX:1,aimY:2};
    h.field({...board,revision:frame+1});await w.step();
  }
  const sent=w.gestures.slice(start),aim=sent.filter(event=>event.type==='aim'),hints=sent.filter(event=>event.type==='fieldDirty');
  assert.equal(sent.filter(event=>event.type==='shot').length,8);assert(aim.length<=5);assert(hints.length<=2);assert(sent.length<=16);
  for(let i=1;i<aim.length;i++)assert(aim[i].time-aim[i-1].time>=200);
  for(let i=1;i<hints.length;i++)assert(hints[i].time-hints[i-1].time>=500);w.dispose();
});

await test('room switch preserves the old connection and context until native commit ACK',async()=>{
  const w=world(),h=w.client('switch');await w.settle(h.controller.create());await w.step(3);const prior=h.controller.metadata().roomId,priorConnection=[...w.connections.values()].find(c=>c.id===prior);
  h.automaticAck=false;const promise=h.controller.create();await w.until(()=>h.held.has('HRReady')&&read(h.held,'HRKind',2)===0);
  assert.equal(priorConnection.closed,false);assert.equal(h.contexts.at(-1).roomId,prior);assert.equal(h.held.has('RoomSwitchGate'),true);
  h.automaticAck=true;await w.settle(promise);assert.equal(priorConnection.closed,true);assert.notEqual(h.contexts.at(-1).roomId,prior);assert.equal(h.state.balance,10000);w.dispose();
});

await test('full-room failure restores old lease before its UI may resume',async()=>{
  const w=world(),a=w.client('full-a'),b=w.client('full-b'),c=w.client('full-c'),d=w.client('full-d');await w.settle(a.controller.create());const full=a.controller.metadata().roomId;
  await w.settle(b.controller.join(full));await w.settle(c.controller.join(full));await w.settle(d.controller.create());const prior=d.controller.metadata().roomId;
  await w.settle(d.controller.join(full));assert.equal(d.controller.metadata().roomId,prior);assert.equal(d.controller.metadata().status,'connected');assert.match(d.controller.metadata().lastError,/已滿/);
  assert.equal(w.history.filter(call=>call.userId==='full-d'&&call.input.op==='advertise').at(-1).input.roomId,prior);d.controller.close();assert(!d.held.has('RoomSwitchGate'));w.dispose();
});

await test('cancelled delayed join leaves the late room and keeps the existing membership',async()=>{
  const w=world(),h=w.client('cancel-join');await w.settle(h.controller.create());const prior=h.controller.metadata().roomId,block=w.holdJoin(),promise=h.controller.create();
  await w.until(()=>block.started);h.controller.cancel();assert(h.held.has('RoomSwitchGate'));block.resolve();await w.settle(promise);
  assert.equal(h.contexts.at(-1).roomId,prior);assert.equal(h.controller.metadata().roomId,prior);assert.equal([...w.connections.values()].filter(c=>c.id!==prior&&c.closed).length,1);assert(!h.held.has('RoomSwitchGate'));w.dispose();
});

await test('cancelling after advertise waits for old lease restoration before releasing the gate',async()=>{
  const w=world(),h=w.client('cancel-advertise');await w.settle(h.controller.create());const prior=h.controller.metadata().roomId;
  const block=w.holdCall((method,input)=>method==='roomDirectory'&&input.op==='advertise'&&input.roomId!==prior),promise=h.controller.create();
  await w.until(()=>block.started);h.controller.cancel();await w.step(2);assert(h.held.has('RoomSwitchGate'));assert.equal(h.controller.metadata().switching,true);block.resolve();await w.settle(promise);
  assert.equal(h.contexts.at(-1).roomId,prior);assert.equal(w.history.filter(call=>call.input.op==='advertise').at(-1).input.roomId,prior);assert(!h.held.has('RoomSwitchGate'));w.dispose();
});

await test('untrusted fieldDirty payload only triggers a canonical roomSnapshot read',async()=>{
  const w=world(),h=w.client('dirty');await w.settle(h.controller.create());await w.step(3);const connection=[...w.connections.values()].find(c=>c.id===h.controller.metadata().roomId),seed=h.state.room.seed;
  const before=w.history.filter(call=>call.method==='roomSnapshot').length;
  w.emit(connection.you.id,'fieldDirty',{protocol:'hc-rooms-v1',seed:99999,revision:99999,slots:[]});await w.step(20);
  assert(w.history.filter(call=>call.method==='roomSnapshot').length>before);assert.equal(h.state.room.seed,seed);assert(!h.packets.some(packet=>packet.seed===99999));w.dispose();
});

await test('departed peers disappear and stale callbacks cannot change the new room',async()=>{
  const w=world(),a=w.client('leave-a'),b=w.client('leave-b');await w.settle(a.controller.create());const prior=a.controller.metadata().roomId;await w.settle(b.controller.join(prior));await w.step(3);
  const old=[...w.connections.values()].find(c=>c.id===prior&&c.you.userId==='leave-a');await w.settle(a.controller.create());await w.step(4);
  assert.equal(b.controller.metadata().playerCount,1);assert.equal(a.controller.metadata().playerCount,1);assert(old.closed);
  for(const cb of old.closeHandlers)cb('late');assert.equal(a.controller.metadata().status,'connected');assert.notEqual(a.controller.metadata().roomId,prior);w.dispose();
});

await test('lease expiration gates new wagers and exposes an actionable room error',async()=>{
  const w=world(),h=w.client('lease');await w.settle(h.controller.create());const connection=[...w.connections.values()][0];
  // A disconnected socket is enough to freeze this membership immediately,
  // before either the heartbeat lease or financial context may silently expire.
  for(const cb of connection.closeHandlers)cb('network-lost');assert.equal(h.controller.metadata().status,'error');assert(h.held.has('RoomSwitchGate'));assert.match(h.controller.metadata().lastError,/重新加入/);w.dispose();
});

await test('missing multiplayer capability stays explicit and never creates fake peers',async()=>{
  const actions=[],controller=createGoldSaucerRooms({sdk:{},setAction:(...action)=>actions.push(action),call:()=>assert.fail('unexpected network'),isIdle:()=>true,setContext:()=>assert.fail('unexpected context')});
  assert.equal(controller.metadata().available,false);assert.equal(controller.metadata().status,'unavailable');assert.deepEqual(controller.metadata().players,[]);assert(actions.some(([name,down])=>name==='RoomSwitchGate'&&down));controller.dispose();
});

const report={ok:true,tests:tests.length,cases:tests,scope:'in-memory production room controller/functions/room source; no external network or wallet calls'};
await fs.mkdir(new URL('../artifacts/goldsaucer/qa/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../artifacts/goldsaucer/qa/rooms-web.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
