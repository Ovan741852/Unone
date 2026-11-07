// api.network in the browser: the snapshot's commands to a WebSocket; what arrives to `row`, as ordered
// input rows. The relay is the command's url, the page's ?relay= or the page's host at port 8433.
export function createNetworkHost({row,location:where=globalThis.location,WebSocket:Socket=globalThis.WebSocket}){
 let socket=null,seen=-1,open=false,room=null;const held=[];
 const close=()=>{const s=socket;socket=null;open=false;room=null;held.length=0;try{s?.close();}catch{}};
 function connect(command){
  close();room=command.room;
  const url=command.url??new URLSearchParams(where?.search??'').get('relay')??`ws://${where?.hostname??'localhost'}:8433`;
  let s;try{s=new Socket(url);}catch(error){row('error',0,String(error.message??error));return;}
  socket=s;
  s.onopen=()=>{if(socket!==s)return;s.send(JSON.stringify({t:'join',room}));open=true;for(const data of held.splice(0))s.send(JSON.stringify({t:'send',data}));};
  s.onmessage=e=>{if(socket!==s)return;const m=JSON.parse(e.data);
   if(m.t==='message')row('message',m.peer,m.data);else if(m.t==='open'||m.t==='peer_join'||m.t==='peer_leave')row(m.t,m.peer);};
  s.onerror=()=>{if(socket===s)row('error',0,'connection failed');};
  s.onclose=()=>{if(socket===s){socket=null;open=false;row('closed',0);}};
 }
 return{
  sync(world){
   if(world.frame===seen)return;seen=world.frame;
   for(const command of world.network_commands??[]){
    if(command.kind==='open')connect(command);
    else if(command.kind==='close'){const had=socket!==null;close();if(had)row('closed',0);}
    else if(command.kind==='send'){if(open)socket.send(JSON.stringify({t:'send',data:command.data}));else if(socket)held.push(command.data);}
   }
  },
  dispose:close,
 };
}
