const amount=value=>(Number(value)||0).toLocaleString('en-US',{maximumFractionDigits:0});
const values=value=>Array.isArray(value)?value:Object.values(value||{});

export function renderHelp(body,state) {
  body.innerHTML=`<div class="hc-help">
    <p class="hc-help-intro">送出心意，收藏她的專屬演出。</p>
    <div class="hc-help-grid">
      <article class="hc-help-gift"><span>♥</span><h3>點讚 <b>×1</b></h3><p>朝點擊方向發射。開啟瞄準後，可追蹤指定女孩。</p></article>
      <article class="hc-help-gift"><span>✿</span><h3>送花 <b>×6</b></h3><p>點女孩展開範圍攻擊，最多命中 6 個不同目標。</p></article>
      <article class="hc-help-gift"><span>➤</span><h3>火箭 <b>×15</b></h3><p>追擊主目標與附近女孩，最多命中 5 個不同目標。</p></article>
    </div>
    <section class="hc-help-section"><h3>輕鬆操作</h3><p>點擊或按住盤面射擊，拖曳可轉向。使用送花、火箭或瞄準時，先點女孩選目標。開啟自動可持續送出目前的禮物。</p><p>每輪只扣一次「底注 × 禮物倍率」。開啟說明或心動時分時會停止自動射擊。</p></section>
    <section class="hc-help-section"><h3>收藏心動時刻</h3><p>實際開出的影片會加入角色收藏。中型演出可同時在砲台旁播放；大型演出會滿版呈現。獎金隨愛心飛入點數區逐步收取。</p><p>點灰色影片可查看該片的底注門檻與抽選條件。</p></section>
    <section class="hc-help-section"><h3>心動卡包</h3><p>每累計實際投注 ${amount(state?.cards?.threshold||1000)} 點，獲得 1 個卡包，最多保留 10 包。左側入口發光時可一次開啟全部卡包；重複卡片會累加持有張數。</p><p>收藏的卡片可滿版旋轉、翻面與放大欣賞。卡片與影片的收藏條件各自獨立。</p></section>
    <section class="hc-help-section" data-help-style-rules><h3>特別風格</h3></section>
    <div class="hc-help-shortcuts"><span><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 禮物</span><span><kbd>A</kbd> 自動</span><span><kbd>L</kbd> 瞄準</span><span><kbd>Space</kbd> 送出</span><span><kbd>Esc</kbd> 關閉視窗</span></div>
    <p class="hc-help-note">本次為虛擬點數試玩。收藏僅保留本次開啟期間，回顧不扣點、不重複派彩。</p>
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
}
