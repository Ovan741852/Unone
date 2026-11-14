import {createGoldSaucerServer} from './goldsaucer-server.mjs';
import {createGoldSaucerRooms} from './goldsaucer-rooms.mjs';

export function standaloneTrialRequested(surface=globalThis.window) {
  try { return Boolean(surface&&surface.top===surface&&new URLSearchParams(surface.location.search).get('trial')==='1'); }
  catch { return false; }
}

export function createCardSeedBridge({setAction,now=()=>performance.now(),makeSeed}={}) {
  let seed=null,acknowledged=false,sentAt=0;
  const held=new Set();
  const release=()=>{for(const code of held)setAction?.(code,false);held.clear();};
  const randomSeed=()=>{const sample=new Uint32Array(1);do{globalThis.crypto.getRandomValues(sample);}while(sample[0]>=4294967292);return sample[0]%2147483646+1;};
  return {release,sync(state,{suspended=false}={}) {
    if(!state?.cards)return;
    if(state.cards.seedReady){release();acknowledged=true;return;}
    if(acknowledged){release();acknowledged=false;seed=null;}
    if(suspended){release();return;}
    if(held.size){if(now()-sentAt>=500)release();return;}
    if(seed===null)seed=(makeSeed||randomSeed)();
    for(let bit=0;bit<31;bit++)if(Math.floor(seed/2**bit)%2)held.add(`CardSeedBit${bit}`);
    held.add('CardSeedReady');sentAt=now();for(const code of held)setAction?.(code,true);
  }};
}

/** Browser SDK lifecycle only. Game state and the coin ledger remain in Luau/server. */
export function createGoldSaucerBridge({
  sdk = globalThis.GoldSaucer,
  setAction,
  onPauseChange = () => {},
  onStatusChange = () => {},
} = {}) {
  const standaloneTrial=standaloneTrialRequested();
  const sdkEnabled=Boolean(sdk)&&!standaloneTrial;
  let disposed = false;
  let desiredPaused = false;
  let nativePaused = false;
  let suspended = false;
  let pendingCommand = null;
  let identityReady = false;
  let balanceReady = false;
  let lastError = null;
  let status = sdkEnabled ? 'connecting' : 'local';
  let bootPending=sdkEnabled;
  let trial=!sdkEnabled;
  let source=standaloneTrial?'standalone':sdkEnabled?'platform-boot':'local';
  let reloadRequired=false;
  let lastInsufficientAttempt = 0;
  let platformNoticeBusy = false;
  const subscriptions = [];
  let server=null;
  let rooms=null;
  const serverMetadata=()=>server?.metadata()||{enabled:false,status:'local',ready:true,mode:null,preview:false,exchangeAvailable:false,balanceSynchronized:true};

  function metadata() {
    return {
      enabled: sdkEnabled, status, paused: suspended, desiredPaused, nativePaused,bootPending,trial,source,reloadRequired,
      pendingAction: pendingCommand?.action || null,
      identityReady, balanceReady, lastError,
      exchangeRate: 50, exchangeAvailable: serverMetadata().exchangeAvailable,
      server: serverMetadata(),
      platformNoticeBusy,
      rooms:rooms?.metadata()||{enabled:false,menuOpen:false,status:'trial',players:[],rooms:[]},
    };
  }

  function notifyStatus() {
    if (!disposed) onStatusChange(metadata());
  }

  function reconcilePause() {
    if (disposed || !sdkEnabled) return;
    const targetPaused=bootPending||reloadRequired||desiredPaused;
    if (!pendingCommand && nativePaused !== targetPaused) {
      const action = targetPaused ? 'PlatformPause' : 'PlatformResume';
      pendingCommand = {action, paused: targetPaused};
      setAction?.(action, true);
    }
    const nextSuspended = targetPaused || nativePaused || pendingCommand?.paused === true;
    if (nextSuspended !== suspended) {
      suspended = nextSuspended;
      onPauseChange(suspended);
    }
    notifyStatus();
  }

  function requestPause(paused) {
    if (disposed) return;
    desiredPaused = paused;
    reconcilePause();
  }

  async function notifyWagerNotice(notice) {
    const remote = serverMetadata();
    const serial = Number(notice?.attemptSerial);
    if (disposed || remote.mode !== 'paid' || remote.balanceSynchronized === false ||
        notice?.code !== 'insufficientFunds' || notice.manualAttempt !== true ||
        !Number.isSafeInteger(serial) || serial <= lastInsufficientAttempt || serial <= 0) {
      return {shown:false};
    }
    lastInsufficientAttempt = serial;
    const needed = Number(notice.roundCost), available = Number(notice.availableBalance);
    if (!Number.isSafeInteger(needed) || needed <= 0 || !Number.isSafeInteger(available) || available < 0 || available >= needed ||
        platformNoticeBusy || typeof sdk?.ui?.alert !== 'function') return {shown:false};
    platformNoticeBusy = true;
    try {
      // Plain notification only. Buying more chips remains an explicit player
      // action in the wallet; platform entry exchange is manifest-controlled.
      await sdk.ui.alert(`可用 ${available.toLocaleString('en-US')} 代幣，本輪需要 ${needed.toLocaleString('en-US')}。請降低底注，或到代幣視窗帶入代幣。`,
        {title:'代幣餘額不足',okText:'知道了'});
      return {shown:true};
    } catch {
      // An older platform may expose an SDK stub before the method is supported.
      // Keep the local HUD notice and never interrupt native gameplay for this.
      return {shown:false};
    } finally {
      platformNoticeBusy = false;
    }
  }

  async function query(method, resultField) {
    if (disposed) return;
    try {
      if (typeof sdk?.[method] !== 'function') return;
      await sdk[method]();
      if (disposed) return;
      if (resultField === 'identity') identityReady = true;
      else balanceReady = true;
    } catch (error) {
      if (!disposed) lastError = String(error?.code || error?.name || 'sdk-query-failed');
    }
    notifyStatus();
  }

  function subscribe(event, handler) {
    if(typeof sdk?.on!=='function')return;
    const unsubscribe = sdk.on(event, handler);
    if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
  }

  async function connect() {
    notifyStatus();
    if (!sdkEnabled) return metadata();
    try {
      // Register first so a pause during asynchronous initialization is retained.
      subscribe('pause', () => requestPause(true));
      subscribe('resume', () => requestPause(false));
      subscribe('userChanged', () => {
        if(disposed)return;
        reloadRequired=true;status='error';lastError='account-changed-reload';
        rooms?.dispose();rooms=null;server?.fail(lastError);reconcilePause();
      });
      subscribe('balanceChanged', () => { if(!trial&&!bootPending&&!reloadRequired)void query('getBalance', 'balance'); });
      reconcilePause();
      const initialized=await sdk.init();
      if (disposed) return metadata();
      if(reloadRequired)return metadata();
      if(initialized?.trial===true){
        trial=true;source='platform-guest';status='ready';bootPending=false;identityReady=true;
        reconcilePause();return metadata();
      }
      await Promise.all([query('getUser', 'identity'), query('getBalance', 'balance')]);
      if (disposed||reloadRequired) return metadata();
      // No GSConnecting/native remote flag is sent until the platform has
      // positively identified a non-guest session.
      server=createGoldSaucerServer({sdk,setAction,onStatusChange:()=>notifyStatus()});
      await server.start();
      if (disposed||reloadRequired) return metadata();
      if(server.enabled)rooms=createGoldSaucerRooms({sdk,setAction,call:(name,input)=>server.roomCall(name,input),
        isIdle:()=>server.isIdleForRoomSwitch(),setContext:context=>server.setRoomContext(context),
        onField:callback=>server.onRoomField(callback),onRoomError:callback=>server.onRoomError(callback),onStatusChange:()=>notifyStatus()});
      status = 'ready';
      trial=!server.enabled;source=server.enabled?(server.metadata().preview?'author-preview':'platform'):'legacy-local';bootPending=false;
      reconcilePause();
    } catch (error) {
      if (!disposed) {
        status = 'error';
        lastError = String(error?.code || error?.name || 'sdk-init-failed');
        reloadRequired=true;source='platform-error';
        server?.fail(lastError);reconcilePause();
      }
    }
    notifyStatus();
    return metadata();
  }

  const ready = connect();
  return {
    ready,
    metadata,
    notifyWagerNotice,
    reassert() {
      if (disposed) return;
      server?.reassert();
      rooms?.recover();
      if (pendingCommand) setAction?.(pendingCommand.action, true);
    },
    buyIn: () => server?server.buyIn():Promise.resolve({ok:false,reason:'trial'}),
    cashOut: () => server?server.cashOut():Promise.resolve({ok:false,reason:'trial'}),
    roomCall:(name,input)=>server?server.roomCall(name,input):Promise.reject(new Error('試玩模式沒有多人房間。')),
    isIdleForRoomSwitch:()=>server?.isIdleForRoomSwitch()||false,
    openRooms:()=>rooms?.open(),closeRooms:()=>rooms?.close(),refreshRooms:()=>rooms?.refresh(),createRoom:()=>rooms?.create(),joinRoom:id=>rooms?.join(id),cancelRoomSwitch:()=>rooms?.cancel(),
    sync(state) {
      server?.sync(state);
      rooms?.sync(state);
      if (disposed || !sdkEnabled || typeof state?.platform?.paused !== 'boolean') return;
      nativePaused = state.platform.paused;
      if (pendingCommand && nativePaused === pendingCommand.paused) {
        setAction?.(pendingCommand.action, false);
        pendingCommand = null;
      }
      reconcilePause();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rooms?.dispose();
      server?.dispose();
      if (pendingCommand) setAction?.(pendingCommand.action, false);
      pendingCommand = null;
      for (const unsubscribe of subscriptions) {
        try { unsubscribe(); } catch { /* One SDK listener must not block cleanup. */ }
      }
      subscriptions.length = 0;
      status = 'disposed';
    },
  };
}
