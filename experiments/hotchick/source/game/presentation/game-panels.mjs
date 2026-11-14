const amount=value=>(Number(value)||0).toLocaleString('en-US',{maximumFractionDigits:0});
const values=value=>Array.isArray(value)?value:Object.values(value||{});
const noticeSignatures=new WeakMap();
const roomMenuSignatures=new WeakMap();

export function updateRoomMenu(element,rooms={}) {
  element.hidden=!rooms.enabled||!rooms.menuOpen;
  if(element.hidden)return;
  if(!element.firstElementChild)element.innerHTML=`<div class="hc-room-card" role="dialog" aria-modal="true" aria-label="多人房間"><header><div><small>HEART PARTY</small><h2>選擇房間</h2></div><button data-ui="room-close" aria-label="關閉房間選單">×</button></header><p class="hc-room-current"></p><div class="hc-room-toolbar"><button data-ui="room-create">開新房間</button><button data-ui="room-refresh">重新整理列表</button></div><div class="hc-room-list"></div><div class="hc-room-code"><input aria-label="房號" maxlength="64" placeholder="輸入朋友的房號" autocomplete="off"><button data-ui="room-code-join">加入房間</button></div><p class="hc-room-status" role="status"></p></div>`;
  const signature=JSON.stringify([rooms.status,rooms.switching,rooms.loading,rooms.lastError,rooms.roomId,rooms.available,values(rooms.rooms).map(room=>[room.id,room.name,room.playerCount,room.maxPlayers])]);
  if(roomMenuSignatures.get(element)===signature)return;roomMenuSignatures.set(element,signature);
  const busy=Boolean(rooms.switching),available=rooms.available!==false;
  element.querySelector('[data-ui="room-close"]').disabled=!rooms.roomId&&!busy;
  element.querySelector('[data-ui="room-close"]').textContent=busy?'取消':'×';
  element.querySelector('[data-ui="room-create"]').disabled=busy||!available;
  element.querySelector('[data-ui="room-refresh"]').disabled=rooms.loading||!available;
  element.querySelector('[data-ui="room-code-join"]').disabled=busy||!available;
  element.querySelector('.hc-room-current').textContent=rooms.roomId?`目前房號：${rooms.roomId} · 最多 3 人`:'選一個房間，一起送出心意。每桌最多 3 人。';
  const list=element.querySelector('.hc-room-list');list.replaceChildren();
  for(const room of values(rooms.rooms).slice(0,16)){
    const row=document.createElement('button');row.dataset.ui='room-join';row.dataset.roomId=room.id;row.className='hc-room-row';
    const title=document.createElement('strong');title.textContent=room.name||'心動房間';
    const details=document.createElement('span');details.textContent=`${room.id} · ${Number(room.playerCount)||0} / 3 人`;
    const action=document.createElement('b');action.textContent=room.id===rooms.roomId?'目前房間':Number(room.playerCount)>=3?'已滿':'加入';
    row.disabled=busy||!available||(Number(room.playerCount)>=3&&room.id!==rooms.roomId);row.append(title,details,action);list.append(row);
  }
  if(!list.children.length){const empty=document.createElement('p');empty.className='hc-room-empty';empty.textContent=rooms.loading?'正在讀取房間…':'目前沒有公開房間，可以開一間等朋友。';list.append(empty);}
  element.querySelector('.hc-room-status').textContent=rooms.lastError||(!available?'平台尚未提供多人房間。':rooms.status==='draining'?'本輪結算完成後加入房間…':rooms.status==='joining'?'正在加入房間…':rooms.status==='cancelling'?'正在取消並保留原房間…':rooms.loading?'正在更新房間列表…':'換房會保留代幣與收藏。');
}

export function wagerNotice(state, platform) {
  const server=platform?.server||platform;
  const wager=state?.wagerStatus||{};
  const reason=wager.blockReason||'';
  const attempt=Number(wager.attemptSerial)||0;
  const attempted=Boolean(state?.auto)||(attempt>0&&wager.attemptReason===reason);
  const available=Number(wager.availableBalance??state?.displayBalance)||0;
  const cost=Number(wager.roundCost??state?.roundCost)||0;
  const notice=(code,title,message,tone='info',action=null)=>({code,title,message,tone,action,passive:tone==='info'&&!action,attemptSerial:attempt});
  if(platform?.reloadRequired)return notice('platformError',platform.lastError==='account-changed-reload'?'登入身分已變更':'平台連線尚未完成','請重新連線後繼續。本頁不會自動切換試玩或正式模式。','error','reconnect');
  if(platform?.bootPending)return notice('connecting','連線中','正在確認遊戲模式。');
  if(server?.enabled&&server.lastError==='staleSession') {
    return {...notice('staleSession','遊戲連線已過期','可能曾在其他分頁或裝置重新開啟遊戲。請保留一個遊戲頁面，再重新連線同步平台餘額。','error','reconnect'),actionDisabled:server.status!=='error'};
  }
  if(server?.enabled&&server.status==='error') {
    return notice('platformError','平台連線發生問題','本頁已暫停下注，餘額待同步。請重新連線後再試。','error','reconnect');
  }
  if(server?.enabled&&server.status==='refunding') {
    if(server.lastError==='insufficientFunds')return notice('insufficientFunds','平台代幣不足','正在退回本頁預扣並同步可用餘額，請稍候。','warning');
    return notice('platformError','投注已暫停','平台未接受此批投注，正在整理本頁預扣狀態。請稍候再重新連線。','error');
  }
  if(server?.enabled&&server.status==='retrying')return notice('syncing','連線稍慢','投注會在背景繼續同步。');
  if(server?.enabled&&(server.walletBusy||server.status==='syncing'))return notice('walletSync','餘額同步中','請稍候。');
  if(server?.enabled&&['connecting','bootstrap','profile'].includes(server.status))return notice('connecting','連線中','正在同步代幣與收藏。');
  if(reason==='settlementBacklog')return notice('settlementBacklog','投注同步中','等待在途回合完成。');
  if(reason==='flightCapacity')return notice('flightCapacity','禮物飛行中','等待禮物抵達目標。');
  if(reason==='platformError')return notice('platformError','投注已暫停','目前無法確認平台回覆，請重新連線同步餘額。','error','reconnect');
  if(reason==='connecting')return notice('walletSync','餘額同步中','請稍候。');
  if(reason==='pendingCredits'&&attempted)return notice('pendingCredits','獎金收取中',`可用 ${amount(available)}，本輪需要 ${amount(cost)}。等待愛心入帳後即可繼續。`);
  if(reason==='insufficientFunds'&&attempted){
    if(platform?.trial)return notice('insufficientFunds','試玩點數不足',`可用 ${amount(available)}，本輪需要 ${amount(cost)}。可重新整理開始新的試玩。`,'warning');
    return notice('insufficientFunds','代幣餘額不足',`可用 ${amount(available)}，本輪需要 ${amount(cost)}。請降低底注${server?.enabled&&server.mode==='paid'?'或帶入代幣':''}。`,'warning',server?.enabled&&server.mode==='paid'?'wallet':null);
  }
  if(reason==='noTarget'&&attempted)return notice('noTarget','等待目標','目前沒有可命中的目標，請稍候。');
  return null;
}

/** The host decides which local notices should use a supported platform UI. */
export function createWagerNoticeController({onNotice=()=>{},now=()=>performance.now()}={}) {
  let candidateCode=null,candidateAt=0,lastEvent=null;
  return {sync(state,platform) {
    const next=wagerNotice(state,platform);
    if(next?.code!==candidateCode){candidateCode=next?.code;candidateAt=now();}
    const visible=next&&(!next.passive||now()-candidateAt>=900)?next:null;
    const eventKey=visible?`${visible.code}:${visible.attemptSerial}`:null;
    if(eventKey!==lastEvent){
      lastEvent=eventKey;
      const manualAttempt=!state?.auto&&Number(state?.wagerStatus?.attemptSerial)>0&&state?.wagerStatus?.attemptReason===state?.wagerStatus?.blockReason;
      onNotice(visible?{...visible,manualAttempt,
        roundCost:manualAttempt?(state?.wagerStatus?.attemptCost??state?.wagerStatus?.roundCost):state?.wagerStatus?.roundCost,
        availableBalance:manualAttempt?(state?.wagerStatus?.attemptAvailableBalance??state?.wagerStatus?.availableBalance):state?.wagerStatus?.availableBalance}:null);
    }
    return visible;
  }};
}

export function updateWagerNotice(element,notice) {
  if(!element)return;
  const signature=notice?JSON.stringify([notice.code,notice.title,notice.message,notice.tone,notice.action,Boolean(notice.actionDisabled),notice.passive]):'';
  if(noticeSignatures.get(element)===signature)return;
  noticeSignatures.set(element,signature);
  element.hidden=!notice;
  if(!notice){element.dataset.code='';return;}
  element.dataset.code=notice.code;element.dataset.tone=notice.tone;
  element.dataset.passive=String(Boolean(notice.passive));
  const title=element.querySelector('.hc-platform-notice-title'),message=element.querySelector('.hc-platform-notice-message'),button=element.querySelector('button');
  if(title.textContent!==notice.title)title.textContent=notice.title;
  if(message.textContent!==notice.message)message.textContent=notice.message;
  button.hidden=!notice.action;button.disabled=Boolean(notice.actionDisabled);
  button.dataset.ui=notice.action==='reconnect'?'platform-reconnect':'platform-wallet';
  button.textContent=notice.action==='reconnect'?'重新連線':'帶入代幣';
}

export function renderHelp(body,state,platform) {
  body.innerHTML=`<div class="hc-help">
    <p class="hc-help-intro">送出心意，收藏她的專屬演出。</p>
    <div class="hc-help-grid">
      <article class="hc-help-gift"><span>♥</span><h3>點讚 <b>×1</b></h3><p>朝點擊方向發射。開啟瞄準後，可追蹤指定女孩。</p></article>
      <article class="hc-help-gift"><span>✿</span><h3>送花 <b>×6</b></h3><p>點女孩展開範圍攻擊，最多命中 6 個不同目標。</p></article>
      <article class="hc-help-gift"><span>➤</span><h3>火箭 <b>×15</b></h3><p>追擊主目標與附近女孩，最多命中 5 個不同目標。</p></article>
    </div>
    <section class="hc-help-section"><h3>輕鬆操作</h3><p>點擊或按住盤面射擊，拖曳可轉向。使用送花、火箭或瞄準時，先點女孩選目標。開啟自動可持續送出目前的禮物。</p><p>每輪先預扣一次「底注 × 禮物倍率」，沒有有效命中時全額退回。開啟說明或心動時分時會停止自動射擊。</p></section>
    <section class="hc-help-section"><h3>收藏心動時刻</h3><p>實際開出的影片會加入角色收藏。中型演出可同時在砲台旁播放；大型演出會滿版呈現。獎金隨愛心飛入點數區逐步收取。</p><p>點灰色影片可查看該片的底注門檻與抽選條件。</p></section>
    <section class="hc-help-section"><h3>心動卡包</h3><p>每累計有效投注 ${amount(state?.cards?.threshold||1000)} 點，獲得 1 個卡包，最多保留 ${amount(state?.cards?.capacity||9999)} 包。落空退款的輪次不累積進度。左側入口發光時可開啟卡包，每次最多 ${Math.min(10,Number(state?.cards?.batchLimit)||10)} 包，剩餘卡包會保留；重複卡片會累加持有張數。</p><p>收藏的卡片可滿版旋轉、翻面與放大欣賞。卡片與影片的收藏條件各自獨立。</p></section>
    <section class="hc-help-section" data-help-style-rules><h3>特別風格</h3></section>
    <div class="hc-help-shortcuts"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 禮物</span><span><kbd>A</kbd> 自動</span><span><kbd>L</kbd> 瞄準</span><span><kbd>Space</kbd> 送出</span><span><kbd>Esc</kbd> 關閉視窗</span></div>
    <p class="hc-help-note">${platform?.trial ? '試玩點數不能帶出；收藏與進度僅保留本次頁面，重新整理會以 10,000 點重新開始。' : platform?.server?.enabled ? '角色演出、卡片收藏與累積進度會保存至平台帳號。作者預覽與正式遊戲分開保存。' : '本次為虛擬點數試玩，收藏僅保留本次開啟期間。'}回顧不扣點、不重複派彩。</p>
  </div>`;
  const rules=body.querySelector('[data-help-style-rules]');
  const tierNames={small:'小型',medium:'中型',large:'大型'};
  for(const character of values(state?.gallery?.characters)) {
    const styles=values(character.styles).filter(style=>style.id!=='classic'&&values(style.items).some(item=>item.available));
    if(!styles.length) continue;
    const line=document.createElement('p');
    const descriptions=styles.map(style=>{
      const tiers=values(style.items).filter(item=>item.available).map(item=>tierNames[item.prizeTier]||item.prizeTier);
      return `${style.title}需底注至少 ${amount(style.minBaseBet)}，捕獲對應${tiers.join('／')}目標`;
    });
    const chance=Number(styles[0].specialChanceTotal);
    const chanceText=Number.isFinite(chance)?`符合條件後，特殊風格合計 ${(chance*100).toLocaleString('en-US',{maximumFractionDigits:2})}%，其餘為經典。`:'';
    line.textContent=`${character.name}：${descriptions.join('；')}。${chanceText}`;
    rules.append(line);
  }
  if(rules.children.length===1)rules.remove();
  if(platform?.enabled) {
    const section=document.createElement('section');section.className='hc-help-section';
    const heading=document.createElement('h3');heading.textContent=platform.trial?'試玩模式':'GoldSaucer';
    const paragraph=document.createElement('p');
    const server = platform.server;
    paragraph.textContent = platform.trial ? '試玩使用本頁的 10,000 起始點數，不兌換紅鑽，也不能帶出。點數不足時可自行重新整理，重新開始本頁試玩與收藏。' : server?.enabled
      ? server.preview ? '作者試玩使用獨立點數，不會兌換紅鑽。'
        : `進場時，平台會將全部紅鑽以 1：50 自動換成${server.currencyName || '心動幣'}，原有代幣會保留。離場不會自動換回紅鑽，帶出須手動操作；補充帶入與帶出均由平台確認。`
      : '目前使用虛擬點數試玩。';
    section.append(heading,paragraph);body.querySelector('.hc-help-note').before(section);
  }
}

export function renderPlatformWallet(body, state, platform) {
  body.innerHTML = `<div class="hc-platform-wallet-panel">
    <p class="hc-wallet-mode"></p>
    <div class="hc-platform-amount"><small>可用點數</small><strong></strong></div>
    <p class="hc-wallet-rate"></p>
    <p class="hc-wallet-entry"></p>
    <div class="hc-platform-wallet-actions">
      <button data-ui="platform-buy-in">帶入紅鑽</button>
      <button data-ui="platform-cash-out">帶出紅鑽</button>
    </div>
    <p class="hc-wallet-status" role="status"></p>
  </div>`;
  updatePlatformWallet(body, state, platform);
}

export function updatePlatformWallet(body, state, platform) {
  const panel = body.querySelector('.hc-platform-wallet-panel');
  if (!panel) return;
  const server = platform?.server;
  panel.querySelector('.hc-wallet-mode').textContent = server?.preview ? '作者試玩點數' : 'GoldSaucer 遊戲代幣';
  panel.querySelector('.hc-platform-amount strong').textContent = server?.enabled&&server.balanceSynchronized===false?'待同步':amount(state?.displayBalance);
  panel.querySelector('.hc-wallet-rate').textContent = `1 紅鑽 = 50 ${server?.currencyName || '心動幣'}，不足 1 紅鑽的零頭會留在遊戲內。`;
  panel.querySelector('.hc-wallet-entry').textContent = server?.preview
    ? '作者試玩使用獨立點數，不會兌換紅鑽。'
    : '進場自動將全部紅鑽換成代幣，原有代幣會保留。離場不會自動換回，帶出須手動操作。';
  for (const button of panel.querySelectorAll('button')) button.disabled = !server?.canUseWallet;
  let message = '補充帶入與帶出會在平台確認後執行。';
  if (server?.lastError === 'staleSession') message = '此頁遊戲連線已過期，請保留一個遊戲分頁，再按「重新連線」同步平台餘額。';
  else if (server?.status === 'error') message = '平台連線發生問題，請按「重新連線」同步平台餘額。';
  else if (server?.status === 'syncing') message = '正在同步平台餘額，請稍候。';
  else if (server?.walletBusy) message = '請完成平台的確認視窗。';
  else if (server?.preview) message = '作者試玩使用獨立點數，審核通過後開放正式代幣。';
  else if (['settling','retrying','refunding'].includes(server?.status)) message = '正在處理在途回合與投注結果，請稍候。';
  else if (!server?.ready) message = '正在連接平台。';
  else if (!server.canUseWallet) message = '請等本輪結算與愛心收款完成。';
  panel.querySelector('.hc-wallet-status').textContent = message;
}

export function renderTools(body,state) {
  body.innerHTML=`<div class="hc-tools">
    <p class="hc-tools-intro">演出預覽不扣點、不派彩，也不解鎖收藏。</p>
    <div class="hc-tools-grid">
      <button data-action="PreviewSmall"><strong>小獎特效</strong><small>4 顆愛心</small></button>
      <button data-action="PreviewMedium"><strong>中型演出 ＋</strong><small>新增一支獨立影片</small></button>
      <button data-action="PreviewLarge"><strong>滿版大獎</strong><small>起手、淡入與收心</small></button>
      <button data-ui="preview-stack"><strong>六支中型演出</strong><small>同時播放壓力試看</small></button>
    </div>
    <div class="hc-tools-info">
      <div class="hc-tool-stat"><small>射速</small><strong data-tool-stat="rate">—</strong></div>
      <div class="hc-tool-stat"><small>每輪間隔</small><strong data-tool-stat="interval">—</strong></div>
      <div class="hc-tool-stat"><small>中型影片</small><strong data-tool-stat="medium">—</strong></div>
      <div class="hc-tool-stat"><small>待收點數</small><strong data-tool-stat="pending">—</strong></div>
    </div>
    <div class="hc-tools-toolbar"><p>重設會清空本次收藏與演出，並還原為 10,000 點。</p><button data-action="DemoReset">重設試玩</button></div>
  </div>`;
  updateTools(body,state);
}

export function updateTools(body,state) {
  const rate=Number(state?.roundsPerSecond)||0,interval=Number(state?.roundInterval)||0;
  const text={rate:`${rate.toLocaleString('en-US',{maximumFractionDigits:2})} 輪／秒`,interval:`${interval.toLocaleString('en-US',{maximumFractionDigits:3})} 秒`,medium:`${amount(state?.mediumVideoCount)} / 6`,pending:amount(state?.pendingWin)};
  for(const node of body.querySelectorAll('[data-tool-stat]')) node.textContent=text[node.dataset.toolStat]??'—';
  const blocked=Boolean(state?.viewportBlocked||state?.reveal);
  for(const button of body.querySelectorAll('[data-action^="Preview"],[data-ui="preview-stack"]')) button.disabled=blocked;
  const reset=body.querySelector('[data-action="DemoReset"]');
  if(reset)reset.closest('.hc-tools-toolbar').hidden=Boolean(state?.platform?.enabled);
}
