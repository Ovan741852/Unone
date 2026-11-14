const PROTOCOL='hc-rooms-v1';
const values=value=>Array.isArray(value)?value:Object.values(value||{});
const whole=(value,max=2147483647)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const weapons=['like','flower','rocket'],bets=[1,5,10,20,50];
const error=(code,message)=>Object.assign(new Error(message),{code});
const roomMessage=e=>({roomFull:'房間已滿，請選擇另一間。',roomNotFound:'房間已關閉，請重新整理列表。',wrongVersion:'房間版本不同，請選擇其他房間。',duplicateUser:'同一帳號已在這個房間。',multiplayerDisabled:'平台尚未開啟多人房間。',cancelled:'已取消加入房間。',timeout:'房間回應較慢，請重試。'}[e?.code]||e?.message||'房間暫時無法連線。');

export function roomBuildId(sdk,location=globalThis.location) {
  const version=String(location?.pathname||'').match(/^\/play-content\/([A-Za-z0-9._-]{1,48})\//)?.[1];
  return version?`${PROTOCOL}:${version}`:PROTOCOL;
}

export function canonicalBoardFields(board,selfSeat) {
  if(board?.protocol!==PROTOCOL||typeof board.roomId!=='string'||!whole(board.seed)||!whole(board.revision)||!whole(board.elapsedMs,2**40-1)||
      !Array.isArray(board.slots)||board.slots.length!==27||!whole(selfSeat,3)||selfSeat<1)throw error('badBoard','房間盤面資料無法確認。');
  const fields={HRRevision:[board.revision,31],HRSeed:[board.seed,31],HRElapsedMs:[board.elapsedMs,40],HRSelfSeat:[selfSeat,3]};
  board.slots.forEach((slot,index)=>{
    if(!whole(slot?.generation,2**26-1)||slot.generation<1||!Number.isSafeInteger(slot.bornMs)||slot.bornMs<-(2**39)||slot.bornMs>=2**39)throw error('badBoard','房間目標資料無法確認。');
    fields[`HRGen${index+1}`]=[slot.generation,26];fields[`HRBorn${index+1}`]=[slot.bornMs<0?2**40+slot.bornMs:slot.bornMs,40];
  });
  return fields;
}

export function createRoomTransport({setAction,now=()=>performance.now()}={}) {
  let serial=0,active=null,disposed=false,sentAt=0;
  const queued=[],held=new Set();
  const release=()=>{for(const key of held)setAction(key,false);held.clear();};
  function send(packet){
    if(++serial>=2147483647)throw error('sequence','房間同步序號已用盡，請重新連線。');
    active={...packet,id:serial};release();
    const fields={...packet.fields,HRPacketId:[serial,31],HRKind:[packet.kind,2],HREpoch:[packet.epoch,31]};
    for(const [name,[value,width]]of Object.entries(fields)){
      if(!whole(value,2**width-1))throw error('packet','房間同步欄位超出範圍。');
      for(let bit=0;bit<width;bit++)if(Math.floor(value/2**bit)%2){const key=`${name}Bit${bit}`;held.add(key);setAction(key,true);}
    }
    held.add('HRReady');setAction('HRReady',true);sentAt=now();
  }
  return {
    queue(kind,epoch,fields){
      if(disposed)return Promise.reject(error('cancelled','房間同步已關閉。'));
      return new Promise((resolve,reject)=>{
        if(kind!==0){const old=queued.findIndex(packet=>packet.kind===kind&&packet.epoch===epoch);if(old>=0){queued.splice(old,1)[0].resolve(false);}}
        queued.push({kind,epoch,fields,resolve,reject});
      });
    },
    sync(room){
      if(disposed)return;
      if(active&&room?.packetAck===active.id){const packet=active;active=null;release();if(room.error||room.packetError)packet.reject(error('packet',String(room.error||room.packetError)));else packet.resolve(true);}
      if(active&&now()-sentAt>=1500){for(const key of held)setAction(key,true);sentAt=now();}
      if(!active&&queued.length){const packet=queued.shift();try{send(packet);}catch(e){release();active=null;packet.reject(e);}}
    },
    recover(){for(const key of held)setAction(key,true);},
    dispose(){disposed=true;release();active?.reject(error('cancelled','房間同步已關閉。'));active=null;for(const packet of queued.splice(0))packet.reject(error('cancelled','房間同步已關閉。'));},
  };
}

export function createGoldSaucerRooms({sdk,setAction,call,isIdle,setContext,onField,onRoomError,onStatusChange=()=>{},now=()=>performance.now(),buildId=roomBuildId(sdk)}={}) {
  let disposed=false,current=null,pending=null,generation=0,epoch=0,latest=null,menuOpen=true,status='idle',lastError='',roomRows=[],listing=false,switching=false;
  let gate=null,lastListAt=-Infinity,lastAdvertiseAt=0,lastSnapshotAt=0,lastAimAt=0,lastAim='',sentShot=0,memberToken=0,lastFieldRevision=-1,lastHintRevision=-1,lastHintAt=-Infinity;
  let advertising=false,snapshotBusy=false,dirty=true,dirtySerial=0,aimSerial=0,committing=false;
  let nativeFrame=0,gateRequestedFrame=0;
  const members=new Map(),waiters=new Set(),unsubscribers=[];
  const transport=createRoomTransport({setAction,now});
  function setGate(value){if(gate===value)return;gate=value;if(value)gateRequestedFrame=nativeFrame;setAction('RoomSwitchGate',value);}
  function metadata(){return {enabled:true,available:typeof sdk?.multiplayer?.join==='function',status,menuOpen,switching,loading:listing,lastError,buildId,roomId:current?.room.id||null,selfSeat:current?.selfSeat||0,
    rooms:roomRows.map(room=>({...room})),players:values(current?.state?.players).map(player=>({...player})),playerCount:values(current?.state?.players).length,maxPlayers:3};}
  const notify=()=>{if(!disposed)onStatusChange(metadata());};
  const check=token=>{if(disposed||token!==generation)throw error('cancelled','已取消加入房間。');};
  const directory=input=>call('roomDirectory',{...input,buildId});
  function validateState(state,room){
    if(state?.protocol!==PROTOCOL||state.roomId!==room.id||typeof state.you!=='string'||!Array.isArray(state.players)||state.players.length>3)throw error('badState','房間玩家資料無法確認。');
    const seats=new Set(),ids=new Set();
    for(const player of state.players){if(typeof player.id!=='string'||!whole(player.seat,2)||seats.has(player.seat)||ids.has(player.id))throw error('badState','房間座位資料無法確認。');seats.add(player.seat);ids.add(player.id);}
    const self=state.players.find(player=>player.id===state.you);if(!self)throw error('badState','房間尚未確認你的座位。');return self.seat+1;
  }
  function peerFields(connection){
    const fields={};
    for(let seat=1;seat<=3;seat++){
      const player=values(connection.state?.players).find(player=>player.seat===seat-1);
      let member=0;if(player){if(!members.has(player.id))members.set(player.id,++memberToken);member=members.get(player.id);}
      const shot=connection.shots.get(player?.id),x=Math.round(Math.max(-8.9,Math.min(8.9,Number(player?.x)||0))*1000),y=Math.round(Math.max(-4.5,Math.min(4.5,Number(player?.y)||0))*1000);
      Object.assign(fields,{[`HRPresent${seat}`]:[player?1:0,1],[`HRMember${seat}`]:[member,31],[`HRWeapon${seat}`]:[Math.max(0,weapons.indexOf(player?.weapon)),2],
        [`HRAimX${seat}`]:[x<0?65536+x:x,16],[`HRAimY${seat}`]:[y<0?65536+y:y,16],[`HRShotSerial${seat}`]:[shot?.serial||0,31],
        [`HRTarget${seat}`]:[whole(shot?.targetId)?shot.targetId:0,31],[`HRBet${seat}`]:[Math.max(1,bets.indexOf(player?.bet)+1),3]});
    }
    return fields;
  }
  function queuePeers(){if(current)transport.queue(2,epoch,peerFields(current)).catch(failed);}
  function acceptField(board,{broadcast=false}={}){
    if(!current||board?.roomId!==current.room.id||board.revision<lastFieldRevision)return;
    try{
      const fields=canonicalBoardFields(board,current.selfSeat);lastFieldRevision=board.revision;
      transport.queue(1,epoch,fields).catch(failed);
      if(broadcast&&board.revision>lastHintRevision&&now()-lastHintAt>=500){lastHintRevision=board.revision;lastHintAt=now();current.room.send('fieldDirty',{revision:board.revision});}
    }catch(e){failed(e);}
  }
  function failed(e){if(disposed||e?.code==='cancelled')return;lastError=roomMessage(e);status='error';menuOpen=true;setGate(true);notify();}
  async function refresh(){
    if(disposed||listing)return;listing=true;notify();
    try{const result=await directory({op:'list'});if(disposed)return;if(result?.ok===false)throw error(result.error?.code||'directory',result.error?.message||'無法讀取房間列表。');roomRows=values(result?.rooms).slice(0,16);lastListAt=now();}
    catch(e){if(!disposed)lastError=roomMessage(e);}finally{listing=false;notify();}
  }
  async function advertise(connection=current){
    if(disposed||!connection||advertising)return;advertising=true;
    try{const result=await directory({op:'advertise',roomId:connection.room.id});if(result?.ok===false)throw error(result.error?.code||'directory',result.error?.message||'房間登記失敗。');connection.leaseAt=now();if(connection===current)lastAdvertiseAt=now();return result;}
    finally{advertising=false;}
  }
  async function snapshot(){
    if(disposed||!current||snapshotBusy)return;snapshotBusy=true;const connection=current,requestedDirty=dirtySerial;
    try{const result=await call('roomSnapshot',{roomId:connection.room.id,buildId});if(current!==connection||disposed)return;if(result?.ok===false)throw error(result.error?.code||'roomUnavailable',result.error?.message||'房間已關閉。');acceptField(result.board);lastSnapshotAt=now();dirty=dirtySerial!==requestedDirty;}
    catch(e){if(current===connection)failed(e);}finally{snapshotBusy=false;}
  }
  function waitForDrain(token){return new Promise((resolve,reject)=>{const waiter=()=>{try{check(token);if(nativeFrame>gateRequestedFrame&&latest?.room?.switching===true&&latest.room.drainReady===true&&isIdle()){waiters.delete(waiter);resolve();}}catch(e){waiters.delete(waiter);reject(e);}};waiters.add(waiter);waiter();});}
  function watchRoom(connection,token){
    const joined=connection.room;
    connection.off.push(joined.on('state',state=>{
      if(disposed||(connection!==current&&connection!==pending))return;
      if(connection.state&&Number(state?.revision)<Number(connection.state.revision))return;
      try{connection.selfSeat=validateState(state,joined);connection.state=state;connection.resolveState?.(state);connection.resolveState=null;if(connection===current){queuePeers();notify();}}
      catch(e){connection.rejectState?.(e);if(connection===current)failed(e);}
    }));
    connection.off.push(joined.on('shot',shot=>{
      if(connection!==current||shot?.protocol!==PROTOCOL||shot.roomId!==joined.id||!whole(shot.serial)||typeof shot.playerId!=='string')return;
      const previous=connection.shots.get(shot.playerId);if(previous&&shot.serial<=previous.serial)return;
      connection.shots.set(shot.playerId,shot);
      if(connection.state)connection.state={...connection.state,players:connection.state.players.map(player=>player.id===shot.playerId?{...player,x:shot.x,y:shot.y,weapon:shot.weapon,bet:shot.bet}:player)};
      queuePeers();
    }));
    connection.off.push(joined.on('fieldDirty',()=>{if(connection===current){dirty=true;dirtySerial++;}}));
    connection.off.push(joined.on('roomError',data=>{const e=error(data?.code||'room',data?.message||'房間連線發生問題。');connection.rejectState?.(e);if(connection===current)failed(e);}));
    joined.onError?.((code,message)=>{if(connection===current)failed(error(code,message));else if(connection===pending)connection.rejectState?.(error(code,message));});
    joined.onClose(reason=>{if(connection===pending)connection.rejectState?.(error('connectionFailed','房間連線已中斷。'));if(connection===current){connection.closed=true;failed(error('connectionFailed','房間連線已中斷，請選擇房間重新加入。'));}});
    joined.send('hello',{protocol:PROTOCOL,buildId});
  }
  function detach(connection){if(!connection)return;connection.rejectState?.(error('cancelled','已取消加入房間。'));connection.rejectState=null;for(const off of connection.off)try{off?.();}catch{}connection.off=[];connection.room.leave();}
  async function join(target='new'){
    if(disposed||switching)return;
    if(current?.room.id===target&&status==='connected'&&!current.closed){close();return;}
    if(typeof sdk?.multiplayer?.join!=='function'){failed(error('multiplayerDisabled','平台尚未提供多人房間。'));return;}
    const token=++generation;switching=true;status='draining';lastError='';setGate(true);notify();let connection=null;const prior=current;
    try{
      await waitForDrain(token);check(token);status='joining';notify();
      if(prior?.room.id===target){detach(prior);prior.closed=true;}
      const room=await sdk.multiplayer.join({room:target});if(disposed||token!==generation){room.leave();throw error('cancelled','已取消加入房間。');}
      connection={room,state:null,selfSeat:0,off:[],shots:new Map(),leaseAt:0,closed:false};pending=connection;
      const ready=new Promise((resolve,reject)=>{connection.resolveState=resolve;connection.rejectState=reject;});
      watchRoom(connection,token);
      let timeout;await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(error('timeout','房間未回覆，請重試。')),12000);})]).finally(()=>clearTimeout(timeout));check(token);
      await advertise(connection);check(token);
      const result=await call('roomSnapshot',{roomId:room.id,buildId});check(token);if(result?.ok===false)throw error(result.error?.code||'roomUnavailable',result.error?.message||'房間已關閉。');
      const fields=canonicalBoardFields(result.board,connection.selfSeat);
      if(result.board.roomId!==room.id)throw error('badBoard','房間盤面不一致。');
      await waitForDrain(token);check(token);
      const nextEpoch=epoch+1;committing=true;await transport.queue(0,nextEpoch,fields);check(token);committing=false;
      setContext({roomId:room.id,buildId});epoch=nextEpoch;current=connection;pending=null;lastFieldRevision=result.board.revision;lastHintRevision=result.board.revision;sentShot=Number(latest?.room?.localShot?.serial)||0;lastAim='';aimSerial=0;
      lastAdvertiseAt=lastSnapshotAt=now();dirty=false;queuePeers();
      if(prior&&prior!==connection){detach(prior);void directory({op:'leave',roomId:prior.room.id}).catch(()=>{});}
      switching=false;status='connected';menuOpen=false;setGate(false);notify();
    }catch(e){
      committing=false;
      if(connection&&connection!==current){detach(connection);void directory({op:'leave',roomId:connection.room.id}).catch(()=>{});}
      if(pending===connection)pending=null;
      if(disposed)return;
      const cancelled=token!==generation;let restored=false;
      if(prior&&!prior.closed){
        current=prior;
        try{const result=await directory({op:'advertise',roomId:prior.room.id});if(result?.ok===false)throw error(result.error?.code||'directory',result.error?.message||'房間登記失敗。');prior.leaseAt=lastAdvertiseAt=now();restored=true;queuePeers();}
        catch(restoreError){e=restoreError;}
      }
      if(disposed)return;
      switching=false;lastError=cancelled&&restored?'':roomMessage(e);status=restored?'connected':cancelled&&!prior?'idle':'error';menuOpen=!(cancelled&&restored);
      setGate(!(cancelled&&restored));notify();
    }
  }
  function open(){menuOpen=true;setGate(true);notify();void refresh();}
  function close(){if(!current||switching||status==='error'||current.closed)return;menuOpen=false;status='connected';setGate(false);notify();}
  function cancel(){if(committing)return;generation++;if(pending){detach(pending);pending=null;}for(const waiter of [...waiters])waiter();if(switching){status='cancelling';lastError='正在取消並保留原房間…';setGate(true);}else{status=current&&!current.closed?'connected':'idle';if(current&&!current.closed){menuOpen=false;setGate(false);}}notify();}
  if(typeof onField==='function')unsubscribers.push(onField(board=>acceptField(board,{broadcast:true})));
  if(typeof onRoomError==='function')unsubscribers.push(onRoomError(e=>{dirty=true;failed(error(e?.code||'roomUnavailable','房間已更新或關閉，請重新選擇房間。'));}));
  setGate(true);
  if(typeof sdk?.multiplayer?.join!=='function')status='unavailable';
  else void refresh();
  return {metadata,open,close,refresh,create:()=>join('new'),join,cancel,
    sync(game){
      if(disposed)return;latest=game;nativeFrame++;transport.sync(game?.room);for(const waiter of [...waiters])waiter();
      if(!current||switching||current.closed)return;
      if(now()-current.leaseAt>=42000){failed(error('lease','房間登記已逾時，請重新選擇房間。'));return;}
      if(now()-lastAdvertiseAt>=15000&&!advertising){lastAdvertiseAt=now();void advertise().catch(failed);}
      if(((dirty&&now()-lastSnapshotAt>=750)||now()-lastSnapshotAt>=5000)&&!snapshotBusy)void snapshot();
      if(menuOpen&&now()-lastListAt>=5000&&!listing)void refresh();
      const local=game.room?.localShot;
      if(local&&whole(local.serial)&&local.serial>sentShot){sentShot=local.serial;current.room.send('shot',{serial:local.serial,weapon:local.weapon,bet:local.bet,x:local.aimX??local.x,y:local.aimY??local.y});}
      const aim=game.aim,signature=JSON.stringify([game.weapon,game.bet,Math.round((aim?.x||0)*100),Math.round((aim?.y||0)*100)]);
      if(aim&&signature!==lastAim&&now()-lastAimAt>=200){lastAim=signature;lastAimAt=now();current.room.send('aim',{serial:++aimSerial,x:aim.x,y:aim.y,weapon:game.weapon,bet:game.bet});}
    },
    recover(){transport.recover();setAction('RoomSwitchGate',Boolean(gate));},
    dispose(){if(disposed)return;disposed=true;generation++;for(const waiter of [...waiters])waiter();detach(pending);detach(current);pending=current=null;transport.dispose();setGate(false);for(const unsubscribe of unsubscribers)unsubscribe?.();},
  };
}
