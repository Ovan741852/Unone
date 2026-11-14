// Synthetic localhost SDK transport for the official-player multiplayer QA.
// It executes production room/functions source and has no real platform access.
import http from 'node:http';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const copy=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>{if(value&&typeof value==='object'){Object.freeze(value);for(const v of Object.values(value))frozen(v);}return value;};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function startRoomsFixture({latencyMs=35}={}) {
  const [functionsSource,roomSource]=await Promise.all([
    fs.readFile(new URL('../server/goldsaucer/functions.js',import.meta.url),'utf8'),
    fs.readFile(new URL('../server/goldsaucer/room.js',import.meta.url),'utf8'),
  ]);
  let functions;
  vm.runInNewContext(functionsSource,{defineFunctions:def=>functions=def},{filename:'functions.js',timeout:1000});
  const users=new Map(),rooms=new Map(),connections=new Map();
  let shared=null,callTail=Promise.resolve(),roomSerial=0,connectionSerial=0,closed=false;
  const activeRPC=new Map(),maxActiveRPC={},history=[],joins=[],leaves=[],errors=[];
  const context=id=>({player:{id,username:id,displayName:users.get(id)?.name||id},
    chips:0,currency:{name:'心動幣',perDiamond:50},shared:frozen(copy(shared)),
    randomInt:(minimum,maximum)=>{if(!Number.isSafeInteger(minimum)||maximum<minimum)throw Error('invalid fixture RNG range');return minimum;}});
  function ensureUser(id,name) {
    if(typeof id!=='string'||!/^[A-Za-z0-9_.:-]{1,64}$/.test(id))throw Object.assign(Error('A synthetic user ID is required'),{code:'invalidUser'});
    if(!users.has(id))users.set(id,{name:typeof name==='string'?name.slice(0,40):id,state:null});
    const user=users.get(id);if(!user.state)user.state=functions.init(context(id));return user;
  }
  function event(connection,type,data) {
    if(connection.closed)return;
    const value={type,data:copy(data)};
    if(connection.stream&&!connection.stream.destroyed)connection.stream.write(`data: ${JSON.stringify(value)}\n\n`);
    else{connection.buffer.push(value);if(connection.buffer.length>256)connection.buffer.shift();}
  }
  function leave(connection,reason='left') {
    if(!connection||connection.closed)return;
    const record=rooms.get(connection.roomId);connection.closed=true;
    leaves.push({userId:connection.userId,connectionId:connection.id,roomId:connection.roomId,reason});
    if(record){record.room.players=record.room.players.filter(p=>p.id!==connection.id);record.def.onLeave?.(record.room,connection.player);if(!record.room.players.length)record.emptyAt=Date.now();}
    const value={type:'__close',data:{reason}};
    if(connection.stream&&!connection.stream.destroyed){connection.stream.write(`data: ${JSON.stringify(value)}\n\n`);connection.stream.end();}
    else{connection.buffer.push(value);if(connection.buffer.length>256)connection.buffer.shift();}
  }
  function createRoom() {
    let def;
    const id=`qa-room-${++roomSerial}`;
    vm.runInNewContext(roomSource,{defineRoom:value=>def=value},{filename:'room.js',timeout:1000});
    const room={id,players:[],state:{},
      send(player,type,data){const connection=connections.get(typeof player==='string'?player:player.id);if(connection)event(connection,type,data);},
      broadcast(type,data,options={}){const except=typeof options.except==='string'?options.except:options.except?.id;for(const p of room.players)if(p.id!==except){const connection=connections.get(p.id);if(connection)event(connection,type,data);}},
      kick(player){const id=typeof player==='string'?player:player.id;queueMicrotask(()=>leave(connections.get(id),'kicked'));},
      lock(){record.locked=true;},unlock(){record.locked=false;},submitScore(){throw Error('No score actions expected');}};
    const record={def,room,locked:false,emptyAt:null,lastTick:Date.now()};
    rooms.set(id,record);def.onCreate?.(room);return record;
  }
  function join({userId,name,room:requested}) {
    ensureUser(userId,name);
    let record=requested&&requested!=='new'?rooms.get(requested):null;
    if(requested&&requested!=='new'&&!record)throw Object.assign(Error('Room not found'),{code:'roomNotFound'});
    if(!requested)record=[...rooms.values()].find(r=>!r.locked&&r.room.players.length<r.def.maxPlayers);
    if(!record)record=createRoom();
    if(record.locked||record.room.players.length>=record.def.maxPlayers)throw Object.assign(Error('Room full'),{code:'roomFull'});
    const player={id:`qa-connection-${++connectionSerial}`,userId,name:users.get(userId).name};
    const connection={id:player.id,userId,player,roomId:record.room.id,buffer:[],stream:null,closed:false};
    connections.set(connection.id,connection);record.room.players.push(player);record.emptyAt=null;
    joins.push({userId,connectionId:connection.id,roomId:record.room.id});
    record.def.onJoin?.(record.room,player);
    return {id:record.room.id,you:player.id};
  }
  async function call(body) {
    const {userId,name,method,input}=body;ensureUser(userId,name);
    if(typeof method!=='string'||method==='init'||method.startsWith('_')||typeof functions[method]!=='function')throw Object.assign(Error('Unknown function'),{code:'unknownFunction'});
    const active=(activeRPC.get(userId)||0)+1;activeRPC.set(userId,active);maxActiveRPC[userId]=Math.max(maxActiveRPC[userId]||0,active);
    try {
      const run=async()=>{
        await pause(latencyMs);
        const user=users.get(userId),out=functions[method](copy(user.state),copy(input??null),context(userId));
        if((out.chips?.bet||0)!==0||(out.chips?.win||0)!==0)throw Error('The preview fixture refuses real chip movement');
        user.state=copy(out.state);
        if(Object.hasOwn(out,'shared'))shared=copy(out.shared);
        const envelope={result:copy(out.result),chips:0,preview:true};
        history.push({userId,method,input:copy(input??null),result:copy(out.result),chips:copy(out.chips||{bet:0,win:0})});
        if(history.length>2048)history.shift();return envelope;
      };
      const pending=callTail.then(run,run);callTail=pending.catch(()=>{});return await pending;
    } finally {activeRPC.set(userId,(activeRPC.get(userId)||1)-1);}
  }
  const timer=setInterval(()=>{
    if(closed)return;
    const now=Date.now();
    for(const [id,record]of rooms){
      if(record.emptyAt!==null&&now-record.emptyAt>30000){rooms.delete(id);continue;}
      const dt=Math.max(0,now-record.lastTick);record.lastTick=now;
      try{record.def.onTick?.(record.room,dt);}catch(error){errors.push(String(error));for(const p of [...record.room.players])leave(connections.get(p.id),'room-error');}
    }
  },100);timer.unref();
  async function bodyOf(request) {
    let text='';for await(const part of request){text+=part;if(text.length>32768)throw Object.assign(Error('Request too large'),{code:'tooLarge'});}
    return text?JSON.parse(text):{};
  }
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'};
  const server=http.createServer(async(request,response)=>{
    const url=new URL(request.url,'http://127.0.0.1');
    const send=(status,value)=>{response.writeHead(status,{...cors,'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    if(request.method==='OPTIONS'){response.writeHead(204,cors);response.end();return;}
    try {
      if(request.method==='GET'&&url.pathname==='/events'){
        const connection=connections.get(url.searchParams.get('connectionId'));
        if(!connection)return send(404,{error:{code:'connectionNotFound'}});
        response.writeHead(200,{...cors,'Content-Type':'text/event-stream','Connection':'keep-alive','X-Accel-Buffering':'no'});response.write(': connected\n\n');
        connection.stream=response;
        for(const item of connection.buffer)response.write(`data: ${JSON.stringify(item)}\n\n`);
        connection.buffer=[];
        if(connection.closed){response.end();return;}
        response.on('close',()=>{if(connection.stream===response){connection.stream=null;leave(connection,'stream-closed');}});
        return;
      }
      if(request.method!=='POST')return send(404,{error:{code:'notFound'}});
      const body=await bodyOf(request);
      if(url.pathname==='/call')return send(200,await call(body));
      if(url.pathname==='/join')return send(200,join(body));
      if(url.pathname==='/leave'){leave(connections.get(body.connectionId));return send(200,{ok:true});}
      if(url.pathname==='/send'){
        const connection=connections.get(body.connectionId),record=connection&&rooms.get(connection.roomId);
        if(!connection||connection.closed||!record)throw Object.assign(Error('Connection closed'),{code:'connectionClosed'});
        record.def.onMessage?.(record.room,connection.player,body.type,body.data);return send(200,{ok:true});
      }
      return send(404,{error:{code:'notFound'}});
    } catch(error){errors.push(String(error));return send(error.code==='roomFull'?409:400,{error:{code:error.code||'fixtureError',message:String(error.message||error)}});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const address=server.address();
  return {origin:`http://127.0.0.1:${address.port}`,
    stats:()=>copy({calls:history,joins,leaves,maxActiveRPC,walletActions:0,errors,
      rooms:[...rooms.values()].map(r=>({id:r.room.id,players:r.room.players.map(p=>({id:p.id,userId:p.userId,name:p.name}))}))}),
    getState:userId=>users.has(userId)?copy(users.get(userId).state):null,
    getShared:()=>copy(shared),
    async close(){if(closed)return;closed=true;clearInterval(timer);for(const connection of connections.values())leave(connection,'fixture-closed');await callTail;await new Promise(resolve=>server.close(resolve));},
  };
}
