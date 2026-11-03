import {createThreeRenderer} from '../../web/renderer/three.js';
import {installLandscape} from './landscape.mjs';
import {renderHelp,renderTools,updateTools} from './game-panels.mjs';
import {createCards} from './cards.mjs';
import {createCardShader} from './card-shader.mjs';

// This adapter only presents Luau observations and submits standard input events.
// The official Unone player still owns simulation, input snapshots and rendering.
const asset = name => new URL('./assets/' + name, import.meta.url).href;
const values = value => Array.isArray(value) ? value : Object.values(value || {});
const number = value => Number(value) || 0;
const format = value => number(value).toLocaleString('en-US', {maximumFractionDigits: 0});
const clamp = value => Math.min(1, Math.max(0, number(value)));
const colors = {small: 0x85f3ed, medium: 0xff8fce, large: 0xffdf87};
const weaponNames = {like: '點讚', flower: '送花', rocket: '火箭'};
const costs = {like: 1, flower: 6, rocket: 15};

export async function createRenderer(canvas, options) {
  const debugMode=new URLSearchParams(location.search).get('debug')==='1';
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(!debugMode)delete window.hotChickDebug;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = new URL('./game-ui.css', import.meta.url).href;
  document.head.append(css);
  const cardsCss=document.createElement('link');cardsCss.rel='stylesheet';cardsCss.href=new URL('./cards.css',import.meta.url).href;document.head.append(cardsCss);
  const hud = document.createElement('div');
  hud.className = 'hc-game-ui';
  hud.dataset.mode=debugMode?'debug':'play';
  hud.innerHTML = `
    <header class="hc-topbar">
      <div class="hc-brand"><span class="hc-crown" aria-hidden="true">♛</span><strong>海王</strong></div>
      <div class="hc-top-actions"><button class="hc-main-preference" data-ui="skip-seen-large" role="switch" aria-checked="false" title="略過完整看過的同一支大獎影片，獎勵照常收取。"><i aria-hidden="true"></i><span>略過已看大獎</span></button><button data-ui="gallery" title="角色、影片與心動收藏"><span aria-hidden="true">♡</span> <span>心動時分</span></button><button data-ui="help" title="遊戲說明" aria-label="遊戲說明"><span aria-hidden="true">?</span><span>說明</span></button>${debugMode?'<button data-ui="tools" title="開啟獨立測試工具"><span aria-hidden="true">⚙</span><span>工具</span></button>':''}</div>
    </header>
    <div class="hc-toast" role="status" hidden></div>
    <button class="hc-pack-energy" data-ui="pack" title="開啟心動卡包"><span>心動卡包</span><i class="hc-pack-energy-track"><b></b></i><strong>0 / 10</strong><small>0%</small></button>
    <nav class="hc-weapons" aria-label="切換攻擊方式">
      <button data-action="WeaponLike" data-weapon="like"><span class="hc-weapon-icon hc-like">♥</span><strong>點讚</strong><small>單體 <b>×1</b></small></button>
      <button data-action="WeaponFlower" data-weapon="flower"><span class="hc-weapon-icon hc-flower">✿</span><strong>送花</strong><small>範圍 <b>×6</b></small></button>
      <button data-action="WeaponRocket" data-weapon="rocket"><span class="hc-weapon-icon hc-rocket">➤</span><strong>火箭</strong><small>多目標 <b>×15</b></small></button>
    </nav>
    <div class="hc-cannon-status" aria-hidden="true"><div class="hc-cooldown"><i></i></div></div>
    <footer class="hc-bottom-bar">
      <div class="hc-wallet"><small>點數</small><strong data-value="balance">—</strong><span class="hc-wallet-increment" hidden aria-hidden="true"></span></div>
      <div class="hc-bet"><button data-action="BetDown" title="降低底注"><img src="${asset('dt2/bet-minus.png')}" alt="−"></button><div><small>底注</small><strong data-value="bet">—</strong></div><button data-action="BetUp" title="提高底注"><img src="${asset('dt2/bet-plus.png')}" alt="＋"></button></div>
      <div class="hc-round-cost"><small>本輪投注</small><strong data-value="cost">—</strong><span data-value="weapon">點讚 ×1</span></div>
      <div class="hc-play-controls"><button data-action="ToggleLock" data-toggle="lock"><span>⌖</span> 瞄準</button><button data-action="ToggleAuto" data-toggle="auto"><span>↻</span> 自動</button><button data-action="Fire" class="hc-fire">送出 <span>♥</span></button></div>
    </footer>
    <div class="hc-float-layer" aria-hidden="true"></div>
    <section class="hc-medium-layer" aria-label="砲台旁的中型演出"></section>
    <section class="hc-modal" hidden role="dialog" aria-modal="true" aria-labelledby="hc-panel-title">
      <div class="hc-modal-card"><div class="hc-modal-heading"><h2 id="hc-panel-title">心動時分</h2><button data-ui="close-gallery" class="hc-close" aria-label="關閉">×</button></div><div class="hc-modal-body"></div></div>
    </section>
    <section class="hc-gallery-hint" hidden role="dialog" aria-modal="true" aria-label="影片解鎖條件"><div class="hc-gallery-hint-card"><span>♡</span><h3></h3><p></p><button data-ui="close-gallery-hint">知道了</button></div></section>
    <section class="hc-reveal" hidden aria-label="中獎演出"><div class="hc-reveal-card"><video playsinline preload="metadata"></video><div class="hc-video-caption"><div><small class="hc-reveal-label"></small><strong class="hc-reveal-amount"></strong></div><div class="hc-video-controls"><button data-ui="sound" title="切換影片聲音">靜音</button><button data-ui="close-reveal">略過 ×</button></div></div><div class="hc-video-error" hidden>影片無法播放。可以關閉後繼續試玩。<button data-ui="close-reveal">關閉演出</button></div></div></section>
    <section class="hc-reveal-intro" hidden aria-label="大獎即將揭曉"><div class="hc-intro-focus"><i class="hc-intro-ring hc-intro-ring-a"></i><i class="hc-intro-ring hc-intro-ring-b"></i><i class="hc-intro-ring hc-intro-ring-c"></i><span class="hc-intro-heart">♥</span><span class="hc-intro-spark hc-intro-spark-a">✦</span><span class="hc-intro-spark hc-intro-spark-b">✧</span></div><div class="hc-intro-copy"><small>YOUR SPECIAL MOMENT</small><strong>大獎即將揭曉</strong><span>她的心意，為你而來</span></div><button class="hc-intro-skip" data-ui="close-reveal">略過 ×</button></section>
    <section class="hc-reward-layer" hidden aria-label="愛心獎勵"><div class="hc-heart-layer" aria-hidden="true"></div><div class="hc-reward-heading"><small></small><strong></strong><span></span></div><div class="hc-wallet-arrival" aria-hidden="true">♥</div></section>`;
  const inspectionLayer=document.createElement('section');inspectionLayer.className='hc-card-inspection-layer';inspectionLayer.hidden=true;inspectionLayer.setAttribute('role','dialog');inspectionLayer.setAttribute('aria-modal','true');inspectionLayer.setAttribute('aria-label','卡片欣賞');hud.append(inspectionLayer);
  document.body.append(hud);
  const query = selector => hud.querySelector(selector);
  const output = Object.fromEntries([...hud.querySelectorAll('[data-value]')].map(node => [node.dataset.value, node]));
  const modal = query('.hc-modal');
  const modalBody = query('.hc-modal-body');
  const revealOverlay = query('.hc-reveal');
  const revealVideo = revealOverlay.querySelector('video');
  const introOverlay = query('.hc-reveal-intro');
  const rewardOverlay = query('.hc-reward-layer');
  const heartLayer = query('.hc-heart-layer');
  const floatLayer = query('.hc-float-layer');
  const walletIncrement = query('.hc-wallet-increment');
  const mediumLayer = query('.hc-medium-layer');
  const mediumPlayers = new Map();
  let latest = null, lastSnapshot = null, currentRevealSerial = null, currentRevealStage = null, currentReveal = null;
  let galleryView = 'gallery', galleryVideo = null, galleryRenderedKey = '', initialized = false, disposed = false;
  let galleryReplayTracking=null;
  let galleryCharacterId = null, galleryClipId = null, galleryHintClipId = null, galleryNavScrollTop = 0, galleryResizeFrame = null;
  let gallerySection='profile';
  let drawFrames = 0, lastUiAt = -Infinity, lastMessage = '', renderer;
  let toastUntil=0,lastUnlockedCount=0,lastHudWeapon=null,weaponChangedAt=-Infinity;
  let lastShotCount=0,lastShotAt=-Infinity,pendingToolActions=[],nextToolActionAt=0;
  let panelReturnFocus=null,panelWasOpen=false,hintReturnFocus=null;
  let lastBalanceText = '';
  let presentedCadence = {roundInterval:null,roundsPerSecond:null,cooldownDuration:null,cooldownProgress:0,cooldownScale:1};
  let videoFrameCallbackId = null;
  let targetLayerOrder = [];
  let presentedShots = [], presentedCannonAngle = Math.PI/2;
  let videoStartNotice = {serial:null,notified:false,mediaTime:null,evidence:null};
  let largeVideoFade = {serial:null,phase:'idle',progress:1,firstFrameAt:null,firstFrameMediaTime:null,firstFrameEvidence:null,durationMs:600,startedNotified:false};
  const cleanup = [], textures = [], materials = [], geometries = [];
  const targetMeshes = new Map(), shotMeshes = new Map(), floatingNodes = new Map();
  const heartNodes = new Map(), heartNodePool = [];
  const targetPool = new Map(), shotPool = [];
  let fieldSpriteMetadata = [];
  const pendingKeys = new Set();
  const cardSeedKeys=new Set();
  let cardSeedWasReady=false,cardShader=null;
  function releaseCardSeedKeys(){for(const code of cardSeedKeys)window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));cardSeedKeys.clear();}
  function syncCardSeed(state){
    if(!state.cards)return;
    if(state.cards.seedReady){releaseCardSeedKeys();cardSeedWasReady=true;return;}
    if(cardSeedWasReady){releaseCardSeedKeys();cardSeedWasReady=false;}
    if(cardSeedKeys.size)return;
    const sample=new Uint32Array(1);do{crypto.getRandomValues(sample);}while(sample[0]>=4294967292);
    const seed=sample[0]%2147483646+1;
    for(let bit=0;bit<31;bit++)if((seed>>>bit)&1)cardSeedKeys.add(`CardSeedBit${bit}`);
    cardSeedKeys.add('CardSeedReady');
    for(const code of cardSeedKeys)window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true}));
  }

  function action(code) {
    if (disposed || pendingKeys.has(code)) return;
    pendingKeys.add(code);
    window.dispatchEvent(new KeyboardEvent('keydown', {code, bubbles: true}));
    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', {code, bubbles: true}));
      pendingKeys.delete(code);
    }, 100);
  }
  const landscape=installLandscape({canvas,hud,action});
  let inspectionWasObscured=false;
  let inspectionPresentation={active:false,obscured:false,fieldVisible:true};
  const cardCollection=createCards({asset,action,viewerRoot:inspectionLayer,onViewerChange:open=>{
    hud.classList.toggle('is-card-inspecting',open);action(open?'CardViewerOpen':'CardViewerClose');
    if(open)action(reducedMotion.matches?'CardViewerReducedMotion':'CardViewerFullMotion');
  },onOpenPack:()=>{galleryView='pack';galleryClipId=null;galleryRenderedKey='';releaseGalleryVideo();renderGallery(latest);},onOpenCollection:()=>{galleryView='gallery';gallerySection='cards';galleryRenderedKey='';renderGallery(latest);}});
  cleanup.push(()=>landscape.dispose());
  cleanup.push(releaseCardSeedKeys);
  const releaseSeedOnHidden=()=>{if(document.hidden)releaseCardSeedKeys();};
  window.addEventListener('blur',releaseCardSeedKeys);document.addEventListener('visibilitychange',releaseSeedOnHidden);
  cleanup.push(()=>{window.removeEventListener('blur',releaseCardSeedKeys);document.removeEventListener('visibilitychange',releaseSeedOnHidden);});
  function closeGallery() {
    releaseGalleryVideo();cardCollection.release(); galleryClipId=null; closeGalleryHint();
    action('GalleryClose');
  }
  function openPanel(view,opener) {
    if(!panelWasOpen)panelReturnFocus=opener||document.activeElement;
    pendingToolActions=[];
    cardCollection.release();galleryView=view;galleryRenderedKey='';closeGalleryHint();action('GalleryOpen');
  }
  function trapFocus(event,dialog) {
    const focusable=[...dialog.querySelectorAll('button:not(:disabled),a[href],video[controls],[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length&&!node.closest('[hidden],[inert]'));
    if(!focusable.length){event.preventDefault();return;}
    const first=focusable[0],last=focusable[focusable.length-1],active=document.activeElement;
    if(!dialog.contains(active)){event.preventDefault();first.focus();}
    else if(event.shiftKey&&active===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&active===last){event.preventDefault();first.focus();}
  }
  function queueToolPreview(code,count=1) {
    if(!debugMode) return;
    pendingToolActions=Array.from({length:count},()=>code); nextToolActionAt=0;
    closeGallery();
  }
  hud.addEventListener('pointerdown', event => { if (event.target.closest('button,.hc-modal,.hc-reveal,.hc-gallery-hint')) event.stopPropagation(); });
  hud.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    if (button.dataset.action) {
      const code=button.dataset.action;
      if(code.startsWith('Preview')) {queueToolPreview(code);return;}
      if(code==='DemoReset') {if(debugMode){pendingToolActions=[];action(code);}return;}
      action(code);return;
    }
    if (button.dataset.galleryCharacter) {
      galleryCharacterId=button.dataset.galleryCharacter; galleryClipId=null;
      releaseGalleryVideo(); closeGalleryHint(); galleryRenderedKey=''; renderGallery(latest);
      query('.hc-character-tab.is-active')?.focus({preventScroll:true});return;
    }
    if(button.dataset.gallerySection){gallerySection=button.dataset.gallerySection;galleryClipId=null;releaseGalleryVideo();closeGalleryHint();galleryRenderedKey='';renderGallery(latest);query(`[data-gallery-section="${gallerySection}"]`)?.focus({preventScroll:true});return;}
    if (button.dataset.galleryClip) { playGallery(button.dataset.galleryClip); return; }
    if (button.dataset.galleryUnavailable) { showGalleryHint(null); return; }
    if (button.dataset.mediumAction) {
      const player=mediumPlayers.get(button.dataset.serial);
      if(!mediumPlayerIsLive(player)) return;
      if(button.dataset.mediumAction==='skip') finishMediumPlayer(player,'CloseMediumReveal');
      if(button.dataset.mediumAction==='mute') {
        player.video.muted=!player.video.muted;
        button.textContent=player.video.muted?'靜音':'有聲';
        button.setAttribute('aria-pressed',String(!player.video.muted));
      }
      return;
    }
    switch (button.dataset.ui) {
      case 'gallery': openPanel('gallery',button); break;
      case 'pack': openPanel('pack',button); break;
      case 'skip-seen-large': action('ToggleSkipSeenLargeVideos'); break;
      case 'help':
      case 'settings': openPanel('help',button); break;
      case 'tools': if(debugMode)openPanel('tools',button); break;
      case 'preview-stack': queueToolPreview('PreviewMedium',6); break;
      case 'close-gallery': closeGallery(); break;
      case 'close-reveal': action('CloseReveal'); break;
      case 'sound': revealVideo.muted = !revealVideo.muted; button.textContent = revealVideo.muted ? '靜音' : '有聲'; break;
      case 'back-gallery': galleryClipId=null; galleryRenderedKey = ''; releaseGalleryVideo(); renderGallery(latest); query('.hc-character-tab.is-active')?.focus({preventScroll:true}); break;
      case 'close-gallery-hint': closeGalleryHint(); break;
    }
  });
  const onKey = event => {
    if ((event.repeat&&event.code!=='Tab') || /INPUT|TEXTAREA/.test(event.target?.tagName)) return;
    if(latest?.viewportBlocked)return;
    const bigActive=(latest?.reveal?.symbolTier||latest?.reveal?.tier)==='large';
    const hint=query('.hc-gallery-hint'),dialog=bigActive?(!introOverlay.hidden?introOverlay:!revealOverlay.hidden?revealOverlay:rewardOverlay):!inspectionLayer.hidden?inspectionLayer:!hint.hidden?hint:!modal.hidden?modal:null;
    if(event.code==='Tab'&&dialog){trapFocus(event,dialog);return;}
    if (event.code === 'Escape') {
      event.preventDefault();
      if(bigActive) action('CloseReveal');
      else if(!query('.hc-gallery-hint').hidden) closeGalleryHint();
      else if(latest?.galleryOpen&&(galleryView==='pack'||gallerySection==='cards')&&cardCollection.escape()) {}
      else if(latest?.reveal) action('CloseReveal');
      else if(latest?.galleryOpen && galleryClipId) { galleryClipId=null; releaseGalleryVideo(); galleryRenderedKey=''; renderGallery(latest);query('.hc-character-tab.is-active')?.focus({preventScroll:true}); }
      else if(latest?.galleryOpen) closeGallery();
      return;
    }
    if(dialog)return;
    if(event.target?.closest?.('button')&&['Space','Enter'].includes(event.code))return;
    const mapping = {Digit1: 'WeaponLike', Digit2: 'WeaponFlower', Digit3: 'WeaponRocket', KeyA: 'ToggleAuto', KeyL: 'ToggleLock', Space: 'Fire'};
    if (mapping[event.code]) { event.preventDefault(); action(mapping[event.code]); }
  };
  window.addEventListener('keydown', onKey);
  cleanup.push(() => window.removeEventListener('keydown', onKey));
  revealVideo.muted = true;
  function hasCompleteVideoCoverage(video){
    const duration=video.duration;
    if(!video.ended||video.seeking||video.error||!Number.isFinite(duration)||duration<=0||video.currentTime<duration-.15)return false;
    let covered=0;
    for(let index=0;index<video.played.length;index++){if(video.played.start(index)>covered+.35)return false;covered=Math.max(covered,video.played.end(index));}
    return covered>=duration-.15;
  }
  revealVideo.addEventListener('ended', () => {
    if(currentRevealSerial!==null&&currentRevealStage==='video'&&videoStartNotice?.serial===currentRevealSerial&&videoStartNotice.notified&&currentReveal?.clipId&&hasCompleteVideoCoverage(revealVideo))action(`LargeVideoCompleted:${currentRevealSerial}:${currentReveal.clipId}`);
  });
  revealVideo.addEventListener('error', () => { if(currentRevealStage==='video') showVideoError(); });

  function cancelVideoFrameCallback() {
    if(videoFrameCallbackId!==null) revealVideo.cancelVideoFrameCallback?.(videoFrameCallbackId);
    videoFrameCallbackId=null;
  }
  function showVideoError() {
    query('.hc-video-error').hidden=false;
    cancelVideoFrameCallback();
    largeVideoFade.phase='error'; largeVideoFade.progress=1;
    revealOverlay.style.setProperty('--large-video-opacity','1');
    revealOverlay.classList.remove('is-waiting-frame');
    introOverlay.hidden=true;
  }
  function firstLargeVideoFrame(now,mediaTime,evidence) {
    if(disposed || currentRevealStage!=='video' || currentRevealSerial!==largeVideoFade.serial || largeVideoFade.phase!=='waiting-frame') return;
    largeVideoFade.phase='fading'; largeVideoFade.firstFrameAt=now;
    largeVideoFade.firstFrameMediaTime=mediaTime; largeVideoFade.firstFrameEvidence=evidence;
    videoFrameCallbackId=null;
  }
  function notifyVideoStarted(serial,mediaTime,evidence) {
    if(disposed || currentRevealStage!=='video' || currentRevealSerial!==serial || videoStartNotice.serial!==serial || videoStartNotice.notified) return;
    videoStartNotice={serial,notified:true,mediaTime,evidence};
    if(largeVideoFade.serial===serial) largeVideoFade.startedNotified=true;
    action('RevealVideoStarted');
  }
  function beginVideoPresentation(serial,large) {
    cancelVideoFrameCallback();
    if(large) {
      largeVideoFade={serial,phase:'waiting-frame',progress:0,firstFrameAt:null,firstFrameMediaTime:null,firstFrameEvidence:null,durationMs:600,startedNotified:videoStartNotice.notified};
      revealOverlay.style.setProperty('--large-video-opacity','0');
    }
    if(revealVideo.requestVideoFrameCallback) videoFrameCallbackId=revealVideo.requestVideoFrameCallback((now,metadata)=>{
      if(currentRevealSerial!==serial || currentRevealStage!=='video') return;
      videoFrameCallbackId=null;
      notifyVideoStarted(serial,metadata.mediaTime,'requestVideoFrameCallback');
      if(large) firstLargeVideoFrame(now,metadata.mediaTime,'requestVideoFrameCallback');
    });
  }
  function updateLargeVideoFade() {
    const large=(currentReveal?.symbolTier || currentReveal?.tier)==='large';
    const active=large && currentRevealStage==='video';
    const waiting=currentRevealStage==='video' && videoStartNotice.serial===currentRevealSerial && !videoStartNotice.notified;
    const decodedFrames=waiting?(revealVideo.getVideoPlaybackQuality?.().totalVideoFrames??0):0;
    const decodedFallback=revealVideo.currentTime>.15 && decodedFrames>0;
    if(waiting && (!revealVideo.requestVideoFrameCallback || decodedFallback) && revealVideo.readyState>=2 && !revealVideo.paused && revealVideo.currentTime>0) {
      cancelVideoFrameCallback();
      notifyVideoStarted(currentRevealSerial,revealVideo.currentTime,'playing-decoded-frame');
      if(large) firstLargeVideoFrame(performance.now(),revealVideo.currentTime,'playing-decoded-frame');
    }
    if(active && largeVideoFade.phase==='fading') {
      largeVideoFade.progress=clamp((performance.now()-largeVideoFade.firstFrameAt)/largeVideoFade.durationMs);
      if(largeVideoFade.progress>=1) largeVideoFade.phase='complete';
    }
    revealOverlay.style.setProperty('--large-video-opacity',String(active?largeVideoFade.progress:1));
    revealOverlay.classList.toggle('is-waiting-frame',active && largeVideoFade.phase==='waiting-frame');
    // Keep the completed anticipation behind the first decoded video frames.
    introOverlay.hidden=!(large && (currentRevealStage==='intro' || (active && ['waiting-frame','fading'].includes(largeVideoFade.phase))));
  }

  function mediumPlayerIsLive(player) {
    return Boolean(player && !disposed && mediumPlayers.get(player.serial)===player && player.stage==='video' && player.video && !player.released);
  }
  function cancelMediumFrameCallback(player) {
    if(player.frameCallbackId!==null) player.video?.cancelVideoFrameCallback?.(player.frameCallbackId);
    player.frameCallbackId=null;
  }
  function notifyMediumStarted(player,mediaTime,evidence) {
    if(!mediumPlayerIsLive(player) || player.started || player.transitionSent) return;
    player.started=true; player.startNotice={mediaTime,evidence};
    player.node.classList.add('is-ready');
    cancelMediumFrameCallback(player);
    action(`MediumVideoStarted:${player.serial}`);
  }
  function finishMediumPlayer(player,kind) {
    if(!mediumPlayerIsLive(player) || player.transitionSent) return;
    player.transitionSent=true;
    cancelMediumFrameCallback(player);
    player.video.pause();
    action(`${kind}:${player.serial}`);
  }
  function mediumVideoError(player,message) {
    if(!mediumPlayerIsLive(player) || player.transitionSent) return;
    player.error=message || player.video.error?.message || '影片無法播放';
    player.node.classList.add('has-error');
    player.node.querySelector('.hc-medium-error').hidden=false;
    // A failed player requests only its own reward transition. Others keep playing.
    finishMediumPlayer(player,'CloseMediumReveal');
  }
  function createMediumPlayer(player) {
    const node=document.createElement('section');
    node.className='hc-medium-card'; node.dataset.serial=player.serial; node.dataset.slot=String(player.slot);
    node.dataset.characterId=player.reveal.characterId || ''; node.dataset.styleId=player.reveal.styleId || ''; node.dataset.clipId=player.reveal.clipId || '';
    node.setAttribute('aria-label',`中型演出 ${player.serial}`);
    node.innerHTML=`<div class="hc-medium-picture"><video playsinline preload="auto"></video><img class="hc-medium-poster" alt=""></div><div class="hc-medium-caption"><small></small><strong></strong></div><div class="hc-medium-controls"><button data-medium-action="mute" data-serial="${player.serial}" title="切換這支影片的聲音" aria-pressed="false">靜音</button><button data-medium-action="skip" data-serial="${player.serial}" title="略過這支影片">略過 ×</button></div><div class="hc-medium-error" hidden><span>這支影片無法播放，正在收心。</span><button data-medium-action="skip" data-serial="${player.serial}">收心 ×</button></div>`;
    const video=node.querySelector('video');
    video.muted=true; video.playsInline=true; video.loop=false;
    player.node=node; player.video=video; player.released=false;
    player.source=player.reveal.videoAsset || null;
    player.poster=player.reveal.posterAsset || null;
    if(player.poster) { node.querySelector('.hc-medium-poster').src=asset(player.poster); video.poster=asset(player.poster); }
    else node.querySelector('.hc-medium-poster').hidden=true;
    const ratio=number(player.reveal.aspectRatio) || (number(player.reveal.videoHeight)>0?number(player.reveal.videoWidth)/number(player.reveal.videoHeight):1);
    node.querySelector('.hc-medium-picture').style.aspectRatio=String(ratio>0?ratio:1);
    player.handlers={
      ended:()=>finishMediumPlayer(player,'MediumRevealDone'),
      error:()=>mediumVideoError(player,video.error?.message),
    };
    for(const [event,handler] of Object.entries(player.handlers)) video.addEventListener(event,handler);
    mediumLayer.append(node);
    if(!player.source) { mediumVideoError(player,'這支演出暫無影片素材'); return; }
    if(video.requestVideoFrameCallback) player.frameCallbackId=video.requestVideoFrameCallback((_,metadata)=>{
      player.frameCallbackId=null;
      notifyMediumStarted(player,metadata.mediaTime,'requestVideoFrameCallback');
    });
    video.src=asset(player.source); video.load();
    video.play().catch(error=>{
      if(mediumPlayerIsLive(player)) mediumVideoError(player,error?.message);
    });
  }
  function releaseMediumPlayer(player) {
    if(!player.video) return;
    const video=player.video;
    player.lastTime=video.currentTime;
    player.lastDuration=Number.isFinite(video.duration)?video.duration:null;
    player.error ||= video.error?.message || null;
    const quality=video.getVideoPlaybackQuality?.();
    player.lastQuality=quality?{total:quality.totalVideoFrames,dropped:quality.droppedVideoFrames}:null;
    player.released=true;
    cancelMediumFrameCallback(player);
    for(const [event,handler] of Object.entries(player.handlers || {})) video.removeEventListener(event,handler);
    video.pause(); video.removeAttribute('src'); video.load();
    player.node.remove(); player.node=null; player.video=null; player.handlers=null;
  }
  function updateMediumPlayers(state) {
    const reveals=values(state.mediumReveals), byId=new Map(reveals.map(reveal=>[String(reveal.serial),reveal]));
    // Release old decoders before a new entry can reuse the same authored slot.
    for(const [serial,player] of mediumPlayers) {
      const reveal=byId.get(serial);
      if(!reveal || reveal.stage!=='video') releaseMediumPlayer(player);
      if(!reveal) mediumPlayers.delete(serial);
    }
    for(const reveal of reveals) {
      const serial=String(reveal.serial);
      let player=mediumPlayers.get(serial);
      if(!player) {
        player={serial,slot:number(reveal.slot),stage:reveal.stage,reveal,node:null,video:null,frameCallbackId:null,started:false,startNotice:null,transitionSent:false,released:reveal.stage!=='video',error:null,lastTime:0,lastDuration:null,lastQuality:null,source:reveal.videoAsset||null,poster:reveal.posterAsset||null};
        mediumPlayers.set(serial,player);
      }
      player.reveal=reveal; player.stage=reveal.stage;
      if(reveal.stage!=='video') continue;
      if(!player.video && !player.released) {
        if(!Number.isInteger(player.slot) || player.slot<1 || player.slot>6) { player.error='中型影片缺少有效的固定位置'; continue; }
        createMediumPlayer(player);
      }
      if(!mediumPlayerIsLive(player)) continue;
      const character=values(state.gallery?.characters).find(entry=>entry.id===reveal.characterId);
      player.node.querySelector('.hc-medium-caption small').textContent=reveal.preview?'演出預覽':`${character?.name||'專屬演出'}${reveal.styleId==='christmas'?' · 聖誕':''}`;
      player.node.querySelector('.hc-medium-caption strong').textContent=reveal.preview?'專屬心動時刻':`+ ${format(reveal.amount)}`;
      const video=player.video;
      if(!player.started && !player.transitionSent && video.readyState>=2 && !video.paused && video.currentTime>0) {
        const decoded=video.getVideoPlaybackQuality?.().totalVideoFrames??0;
        if(!video.requestVideoFrameCallback || (video.currentTime>.15 && decoded>0)) notifyMediumStarted(player,video.currentTime,'playing-decoded-frame');
      }
    }
  }

  function releaseGalleryVideo() {
    if(galleryReplayTracking?.started&&!galleryReplayTracking.completed&&!galleryReplayTracking.cancelled)action('GalleryLargeCancelled');
    galleryReplayTracking=null;
    if(!galleryVideo) return;
    const video=galleryVideo; galleryVideo=null;
    video.pause(); video.removeAttribute('src'); video.load();
  }
  function trackLargeGalleryVideo(video,item) {
    if(item.prizeTier!=='large')return;
    const track={video,started:false,completed:false,cancelled:false,covered:0,lastTime:0,lastWall:0};galleryReplayTracking=track;
    const cancel=()=>{if(galleryReplayTracking!==track||track.cancelled||track.completed)return;track.cancelled=true;if(track.started)action('GalleryLargeCancelled');};
    const advance=()=>{
      if(galleryReplayTracking!==track||!track.started||track.cancelled||track.completed)return;
      const now=performance.now(),media=video.currentTime,delta=media-track.lastTime,elapsed=(now-track.lastWall)/1000;
      if(delta<-.05||delta>Math.max(.8,elapsed*Math.max(.1,video.playbackRate)+.35)){cancel();return;}
      if(delta>0&&(!video.paused||video.ended)&&!video.seeking)track.covered+=delta;
      track.lastTime=media;track.lastWall=now;
    };
    video.addEventListener('playing',()=>{
      if(galleryReplayTracking!==track||track.cancelled||track.completed)return;
      if(!track.started){if(video.error||video.currentTime>.35){cancel();return;}track.started=true;track.lastTime=video.currentTime;track.lastWall=performance.now();action(`GalleryLargeStarted:${item.clipId}`);}
      else{track.lastTime=video.currentTime;track.lastWall=performance.now();}
    });
    video.addEventListener('timeupdate',advance);video.addEventListener('pause',advance);video.addEventListener('seeking',cancel);video.addEventListener('error',cancel);
    video.addEventListener('ended',()=>{
      advance();const duration=video.duration;
      if(galleryReplayTracking!==track||!track.started||track.cancelled||track.completed||video.error||!Number.isFinite(duration)||video.currentTime<duration-.15||track.covered<duration-.5)return;
      track.completed=true;action(`GalleryLargeCompleted:${item.clipId}`);
    },{once:true});
  }
  function findGalleryClip(state,clipId) {
    for(const character of values(state?.gallery?.characters)) for(const style of values(character.styles)) for(const item of values(style.items)) {
      if(String(item.clipId)===String(clipId)) return {character,style,item};
    }
    return null;
  }
  function closeGalleryHint() {
    const popup=query('.hc-gallery-hint'),wasOpen=!popup.hidden;
    popup.hidden=true;galleryHintClipId=null;
    if(wasOpen&&hintReturnFocus?.isConnected)hintReturnFocus.focus();
    hintReturnFocus=null;
  }
  function showGalleryHint(record) {
    const item=record?.item;
    galleryHintClipId=item?.clipId || null;
    const popup=query('.hc-gallery-hint');
    hintReturnFocus=[...hud.querySelectorAll('[data-gallery-clip]')].find(node=>node.dataset.galleryClip===item?.clipId)||document.activeElement;
    popup.querySelector('h3').textContent=!item || !item.available?'暫無此獎項':'尚未解鎖';
    popup.querySelector('p').textContent=item?.unlockHint || (!item || !item.available?'這個風格暫無此獎項。':'這支影片尚未解鎖。');
    popup.hidden=false;popup.querySelector('button').focus();
  }
  function playGallery(clipId) {
    const record=findGalleryClip(latest,clipId);
    if(!record || !record.item.available || !record.item.unlocked || !record.item.replayAsset) { showGalleryHint(record); return; }
    galleryCharacterId=record.character.id;gallerySection='movies'; galleryClipId=record.item.clipId;
    releaseGalleryVideo(); closeGalleryHint(); galleryRenderedKey=''; renderGallery(latest);
  }
  function galleryElement(tag,className,text) {
    const node=document.createElement(tag);
    if(className) node.className=className;
    if(text!==undefined) node.textContent=text;
    return node;
  }
  function galleryImage(parent,path,alt) {
    if(!path) return;
    const img=galleryElement('img'); img.alt=alt || ''; img.src=asset(path);
    img.addEventListener('error',()=>{img.hidden=true;parent.classList.add('has-missing-image');},{once:true});
    parent.append(img);
  }
  function renderGalleryCatalog(state) {
    const characters=values(state?.gallery?.characters);
    if(!characters.some(character=>character.id===galleryCharacterId)) galleryCharacterId=state?.gallery?.defaultCharacterId || characters[0]?.id || null;
    const character=characters.find(entry=>entry.id===galleryCharacterId) || characters[0];
    if(character) galleryCharacterId=character.id;
    const replay=galleryClipId?findGalleryClip(state,galleryClipId):null;
    if(galleryClipId && (!replay?.item.available || !replay?.item.unlocked || !replay?.item.replayAsset)) galleryClipId=null;
    const key=galleryClipId?`gallery/${galleryCharacterId}/${galleryClipId}/${replay.item.replayAsset}`:gallerySection==='cards'?`gallery/${galleryCharacterId}/cards`:`gallery/${galleryCharacterId}/${gallerySection}/${JSON.stringify(state?.gallery || {})}`;
    if(galleryRenderedKey===key) return;
    galleryRenderedKey=key; releaseGalleryVideo();cardCollection.release();
    query('.hc-modal-card').classList.remove('is-help','is-tools','is-pack');
    query('.hc-modal-card').classList.add('is-gallery');
    query('.hc-modal-heading h2').textContent='心動時分';
    rememberGalleryNav();
    modalBody.replaceChildren();
    const layout=galleryElement('div','hc-gallery-layout');
    const tabs=galleryElement('nav','hc-character-tabs'); tabs.setAttribute('aria-label','選擇角色');
    for(const entry of characters) {
      const tab=galleryElement('button','hc-character-tab'); tab.dataset.galleryCharacter=entry.id;
      tab.classList.toggle('is-active',entry.id===galleryCharacterId); tab.setAttribute('aria-pressed',String(entry.id===galleryCharacterId));
      const portrait=galleryElement('div','hc-character-portrait'); galleryImage(portrait,entry.portraitAsset,entry.name);
      tab.append(portrait,galleryElement('strong',null,entry.name || entry.id)); tabs.append(tab);
    }
    const main=galleryElement('div','hc-gallery-main');
    layout.append(tabs,main); modalBody.append(layout);
    tabs.scrollTop=galleryNavScrollTop;
    keepGalleryCharacterVisible(tabs);
    const heading=galleryElement('div','hc-role-heading');heading.append(galleryElement('h3',null,character?.name||'角色'));
    const sections=galleryElement('nav','hc-role-sections');sections.setAttribute('aria-label','角色內容');
    for(const [id,label]of[['profile','角色介紹'],['movies','影片'],['cards','卡片']]){const tab=galleryElement('button',null,label);tab.dataset.gallerySection=id;tab.classList.toggle('is-active',gallerySection===id);tab.setAttribute('aria-pressed',String(gallerySection===id));sections.append(tab);}
    heading.append(sections);main.append(heading);
    const content=galleryElement('div','hc-role-content');main.append(content);
    if(gallerySection==='profile'){
      const profile=galleryElement('section','hc-role-profile');const photo=galleryElement('div','hc-role-profile-photo');galleryImage(photo,character?.portraitAsset,character?.name);
      const copy=galleryElement('div','hc-role-profile-copy');copy.append(galleryElement('small',null,'HEART CONNECTION'),galleryElement('h4',null,character?.profileTitle||'專屬於你的心動時刻'),galleryElement('p',null,character?.profileText||'在海王的世界裡，每一次相遇，都能收藏新的心動。'));
      profile.append(photo,copy);content.append(profile);return;
    }
    if(gallerySection==='cards'){cardCollection.mount(content,state.cards,character?.id);return;}
    if(galleryClipId && replay) {
      const player=galleryElement('div','hc-gallery-player');
      player.append(galleryElement('h3',null,replay.item.label || '影片'));
      const video=galleryElement('video'); video.controls=true; video.playsInline=true; video.muted=true; video.preload='metadata';
      video.src=asset(replay.item.replayAsset);
      if(replay.item.posterAsset) video.poster=asset(replay.item.posterAsset);
      const note=galleryElement('p',null,'影片重播 · 不扣點、不派彩');
      const back=galleryElement('button',null,'返回影片'); back.dataset.ui='back-gallery';
      player.append(video,note,back); content.append(player); galleryVideo=video;
      trackLargeGalleryVideo(video,replay.item);
      video.addEventListener('error',()=>{if(galleryVideo===video) note.textContent='這支影片暫時無法播放，可以返回影片。';},{once:true});
      video.play().catch(()=>{});
      return;
    }
    content.append(galleryElement('p','hc-gallery-intro','點選灰色影片，查看她的解鎖條件。'));
    if(!character) content.append(galleryElement('p','hc-gallery-empty','暫無角色資料。'));
    const prizeTiers=['small','medium','large'],prizeLabels={small:'小獎影片',medium:'中獎影片',large:'大獎影片'};
    for(const style of values(character?.styles)) {
      const items=values(style.items).filter(item=>item.available&&item.replayAsset).map((item,index)=>({item,index})).sort((a,b)=>prizeTiers.indexOf(a.item.prizeTier)-prizeTiers.indexOf(b.item.prizeTier)||a.index-b.index).map(entry=>entry.item);
      if(!items.length)continue;
      const row=galleryElement('section','hc-style-row'); row.dataset.styleId=style.id;
      row.append(galleryElement('h3',null,style.title || style.id));
      const cards=galleryElement('div','hc-style-cards');
      for(const item of items) {
        const tier=item.prizeTier;
        const unlocked=Boolean(item.unlocked);
        const card=galleryElement('button','hc-gallery-card');
        card.dataset.galleryClip=item.clipId;
        card.dataset.prizeTier=tier; card.classList.toggle('is-locked',!unlocked);
        const photo=galleryElement('div','hc-gallery-thumb');
        photo.append(galleryElement('span','hc-gallery-placeholder','♡'));
        if(item?.posterAsset) galleryImage(photo,item.posterAsset,item.label || prizeLabels[tier]);
        photo.append(galleryElement('span','hc-gallery-badge',unlocked?'▶ 重播':'🔒 尚未解鎖'));
        card.append(photo,galleryElement('strong',null,item?.label || prizeLabels[tier]),galleryElement('small',null,prizeLabels[tier]));
        cards.append(card);
      }
      row.append(cards); content.append(row);
    }
    content.append(galleryElement('p','hc-disclaimer','收藏僅保留本次開啟期間，重播不扣點、不重複派彩。'));
  }
  function renderGallery(state) {
    if(!state) return;
    if(galleryView==='gallery') {renderGalleryCatalog(state);return;}
    if(galleryView==='pack'){
      if(galleryRenderedKey==='pack')return;
      galleryRenderedKey='pack';releaseGalleryVideo();rememberGalleryNav();cardCollection.release();
      const panel=query('.hc-modal-card');panel.classList.remove('is-gallery','is-help','is-tools');panel.classList.add('is-pack');
      query('.hc-modal-heading h2').textContent='心動卡包';cardCollection.mountPack(modalBody,state.cards);return;
    }
    const tools=galleryView==='tools'&&debugMode;
    const key=tools?'tools':'help';
    if(galleryRenderedKey===key) {if(tools)updateTools(modalBody,state);return;}
    galleryRenderedKey=key;releaseGalleryVideo();cardCollection.release();rememberGalleryNav();
    const card=query('.hc-modal-card');
    card.classList.remove('is-gallery','is-help','is-tools','is-pack');
    card.classList.add(tools?'is-tools':'is-help');
    query('.hc-modal-heading h2').textContent=tools?'測試工具':'遊戲說明';
    if(tools)renderTools(modalBody,state);else renderHelp(modalBody,state);
  }
  function rememberGalleryNav() {
    const tabs=modalBody.querySelector('.hc-character-tabs');
    if(tabs)galleryNavScrollTop=tabs.scrollTop;
  }
  function keepGalleryCharacterVisible(tabs=modalBody.querySelector('.hc-character-tabs')) {
    const selected=tabs?.querySelector('.hc-character-tab.is-active');
    if(!tabs||!selected)return;
    const viewport=tabs.getBoundingClientRect(),button=selected.getBoundingClientRect();
    if(button.top<viewport.top)tabs.scrollTop-=viewport.top-button.top;
    else if(button.bottom>viewport.bottom)tabs.scrollTop+=button.bottom-viewport.bottom;
    galleryNavScrollTop=tabs.scrollTop;
  }
  const resizeGalleryNav=()=>{
    if(galleryResizeFrame!==null)cancelAnimationFrame(galleryResizeFrame);
    galleryResizeFrame=requestAnimationFrame(()=>{galleryResizeFrame=null;if(!disposed&&latest?.galleryOpen&&galleryView==='gallery')keepGalleryCharacterVisible();});
  };
  window.addEventListener('resize',resizeGalleryNav);
  cleanup.push(()=>{window.removeEventListener('resize',resizeGalleryNav);if(galleryResizeFrame!==null)cancelAnimationFrame(galleryResizeFrame);});
  function updateReveal(state) {
    const reveal = state.reveal;
    const serial = reveal?.serial ?? null;
    const stage = reveal?.stage || (reveal ? 'video' : null);
    currentReveal = reveal || null;
    introOverlay.style.setProperty('--intro-progress',String(stage==='intro'?clamp(reveal?.stageProgress):1));
    if (serial === currentRevealSerial && stage === currentRevealStage) { updateLargeVideoFade(); return; }
    const changedSerial = serial !== currentRevealSerial;
    currentRevealSerial = serial; currentRevealStage = stage;
    cancelVideoFrameCallback();
    revealVideo.pause();
    if (!reveal) { revealOverlay.hidden = true; revealVideo.removeAttribute('src'); revealVideo.load(); updateLargeVideoFade(); return; }
    const large = (reveal.symbolTier || reveal.tier) === 'large';
    revealOverlay.classList.toggle('is-large', large);
    revealOverlay.classList.toggle('is-medium', !large);
    revealOverlay.hidden = stage !== 'video';
    query('.hc-video-error').hidden = true;
    const character=values(state.gallery?.characters).find(entry=>entry.id===reveal.characterId);
    query('.hc-reveal-label').textContent = reveal.preview ? '演出預覽' : `${character?.name||'專屬演出'}${reveal.styleId==='christmas'?' · 聖誕':''}`;
    query('.hc-reveal-amount').textContent = reveal.preview ? '海王的專屬時刻' : `+ ${format(reveal.amount)}`;
    if (changedSerial) {
      videoStartNotice={serial,notified:false,mediaTime:null,evidence:null};
      largeVideoFade={serial,phase:large?'awaiting-video':'idle',progress:1,firstFrameAt:null,firstFrameMediaTime:null,firstFrameEvidence:null,durationMs:600,startedNotified:false};
      revealVideo.muted=true; query('[data-ui="sound"]').textContent='靜音';
      if(reveal.posterAsset) revealVideo.poster=asset(reveal.posterAsset); else revealVideo.removeAttribute('poster');
      if(reveal.videoAsset) { revealVideo.src = asset(reveal.videoAsset); revealVideo.currentTime = 0; revealVideo.load(); }
      else revealVideo.removeAttribute('src');
    }
    if (stage === 'video') {
      if(!reveal.videoAsset) { showVideoError(); return; }
      beginVideoPresentation(serial,large);
      revealVideo.play().catch(() => { if(currentRevealStage==='video' && currentRevealSerial===serial) showVideoError(); });
    }
    updateLargeVideoFade();
  }
  function updateRewardFx(state) {
    const hearts=values(state.fxHearts), rewards=values(state.rewardFx), alive=new Set();
    const pulse=clamp(state.walletPulse);
    rewardOverlay.hidden=hearts.length===0 && rewards.length===0 && pulse===0;
    query('.hc-wallet').style.setProperty('--wallet-pulse',String(pulse));
    query('.hc-wallet-arrival').style.setProperty('--wallet-pulse',String(pulse));
    for (const heart of hearts) {
      const id=String(heart.id); alive.add(id);
      let node=heartNodes.get(id);
      if(!node) {
        node=heartNodePool.pop()||document.createElement('span');
        node.className='hc-reward-heart'; node.hidden=false;
        if(!node.parentNode) heartLayer.append(node);
        heartNodes.set(id,node);
      }
      const phase=heart.phase==='collect'||heart.phase==='chip'?'collect':'burst';
      if(node.dataset.phase!==phase) { node.dataset.phase=phase; node.textContent='♥'; }
      node.dataset.tier=heart.tier||'small';
      node.style.left=`${(number(heart.x)/17.7777778+.5)*100}%`;
      node.style.top=`${(.5-number(heart.y)/10)*100}%`;
      node.style.opacity=String(clamp(heart.opacity));
      node.style.transform=`translate(-50%,-50%) rotate(${number(heart.rotation)}deg) scale(${Math.max(0,number(heart.scale))})`;
    }
    for(const [id,node] of heartNodes) if(!alive.has(id)) { node.hidden=true; heartNodes.delete(id); heartNodePool.push(node); }
    const heading=query('.hc-reward-heading');
    const focus=rewards[rewards.length-1];
    heading.hidden=!focus;
    if(focus) {
      const tier=focus.rewardTier||'small';
      heading.dataset.tier=tier;
      heading.querySelector('small').textContent=focus.preview?'特效預覽 · 不派彩':({small:'心動小獎',medium:'甜蜜中獎',large:'滿滿愛意 · 大獎'}[tier]||'心動獎勵');
      heading.querySelector('strong').textContent=number(focus.amount)>0?`+ ${format(focus.amount)}`:`${format(focus.count)} 顆心動`;
      const note=heading.querySelector('span');note.textContent=focus.preview?'預覽不派彩':'';note.hidden=!focus.preview;
      heading.style.opacity=String(Math.min(1,(1-clamp(focus.progress))*4));
    }
  }
  function updateWallet(state) {
    // Luau owns collected credit. Rendering never interpolates or adds money.
    const balanceText=format(state.displayBalance ?? state.balance);
    if(balanceText!==lastBalanceText) { output.balance.textContent=balanceText; lastBalanceText=balanceText; }
    const serial=number(state.walletLastIncrementSerial);
    const increment=number(state.walletLastIncrement);
    const age=number(state.walletLastIncrementAge);
    walletIncrement.hidden=serial<=0 || increment<=0 || age<0 || age>=.45;
    if(walletIncrement.hidden) return;
    walletIncrement.textContent=`+${format(increment)}`;
    walletIncrement.dataset.serial=String(serial);
    walletIncrement.style.setProperty('--receipt-progress',String(clamp(age/.45)));
  }
  function updateCadence(state) {
    const roundInterval=number(state.roundInterval),roundsPerSecond=number(state.roundsPerSecond);
    const duration=number(state.cooldownDuration || state.roundInterval);
    // Luau's progress is the remaining fraction: 1 just fired, 0 ready.
    const remaining=Number.isFinite(state.cooldownProgress)?clamp(state.cooldownProgress):(duration>0?clamp(number(state.cooldown)/duration):0);
    const scale=1-remaining;
    query('.hc-cooldown i').style.transform=`scaleX(${scale})`;
    const rateText=roundsPerSecond>0?`${roundsPerSecond.toLocaleString('en-US',{maximumFractionDigits:2})} 輪/秒`:'— 輪/秒';
    const intervalText=roundInterval>0?`${roundInterval.toLocaleString('en-US',{maximumFractionDigits:3})} s/輪`:'— s/輪';
    presentedCadence={roundInterval:roundInterval||null,roundsPerSecond:roundsPerSecond||null,cooldownDuration:duration||null,cooldownProgress:remaining,cooldownScale:scale,rateText,intervalText};
  }
  function showToast(text,tone='success') {
    const toast=query('.hc-toast');toast.textContent=text;toast.dataset.tone=tone;
    toast.hidden=false;toast.classList.add('is-visible');toastUntil=performance.now()+2600;
  }
  function updateHud(state) {
    const now=performance.now();
    output.bet.textContent = format(state.bet);
    output.cost.textContent = format(number(state.bet) * (costs[state.weapon] || 1));
    output.weapon.textContent = `${weaponNames[state.weapon] || '點讚'} ×${costs[state.weapon] || 1}`;
    if(lastHudWeapon!==state.weapon){if(lastHudWeapon!==null)weaponChangedAt=now;lastHudWeapon=state.weapon;}
    hud.dataset.weapon=state.weapon||'like';hud.dataset.auto=state.auto?'on':'off';hud.dataset.lock=state.lock?'on':'off';
    hud.querySelectorAll('[data-weapon]').forEach(button => {
      const selected=button.dataset.weapon===state.weapon;
      button.classList.toggle('is-active',selected);button.classList.toggle('is-recent',selected&&now-weaponChangedAt<450&&!reducedMotion.matches);
      button.setAttribute('aria-pressed',String(selected));
    });
    hud.querySelectorAll('[data-toggle]').forEach(button => { const on = Boolean(state[button.dataset.toggle]); button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on)); });
    const cost=number(state.bet)*(costs[state.weapon]||1);
    const fire=query('.hc-fire');
    fire.disabled=Boolean(state.viewportBlocked||state.galleryOpen||state.reveal||number(state.revealQueueCount)>0||number(state.displayBalance??state.balance)<cost);
    fire.dataset.ready=String(Boolean(state.canShoot));
    fire.setAttribute('aria-label',`送出${weaponNames[state.weapon]||'點讚'}，每輪 ${format(cost)} 點`);
    const message = typeof state.message === 'string' ? state.message : '';
    if(message!==lastMessage){lastMessage=message;if(message.includes('不足'))showToast('點數不足，請調整底注。','warning');}
    const unlocked=values(state.gallery?.characters).reduce((sum,character)=>sum+values(character.styles).reduce((total,style)=>total+values(style.items).filter(item=>item.unlocked).length,0),0);
    if(unlocked>lastUnlockedCount)showToast('收藏了新的心動時刻，可到心動時分觀看。');
    lastUnlockedCount=unlocked;
    if(now>=toastUntil){const toast=query('.hc-toast');toast.hidden=true;toast.classList.remove('is-visible');}
    const packEnergy=query('.hc-pack-energy'),packCount=number(state.cards?.drawsAvailable),packCapacity=number(state.cards?.capacity)||10;
    const packProgress=packCount>=packCapacity?1:clamp(number(state.cards?.progress)/Math.max(1,number(state.cards?.threshold)||1000));
    packEnergy.querySelector('b').style.transform=`scaleY(${packProgress})`;packEnergy.querySelector('strong').textContent=`${format(packCount)} / ${format(packCapacity)}`;
    packEnergy.querySelector('small').textContent=packCount>=packCapacity?'已滿':`${Math.floor(packProgress*100)}%`;
    packEnergy.classList.toggle('is-full',packCount>=packCapacity);packEnergy.classList.toggle('has-packs',packCount>0);
    packEnergy.setAttribute('aria-label',`心動卡包 ${format(packCount)} / ${format(packCapacity)}，${packCount>=packCapacity?'已滿':`下一包進度 ${Math.floor(packProgress*100)}%`}，點擊開啟`);
    modal.hidden = !state.galleryOpen;
    cardCollection.update(state.cards);
    if (state.galleryOpen) renderGallery(state);
    else { releaseGalleryVideo();cardCollection.release(); galleryClipId=null; closeGalleryHint(); galleryRenderedKey = ''; }
    const skipSeen=query('[data-ui="skip-seen-large"]');if(skipSeen){const enabled=Boolean(state.preferences?.skipSeenLargeVideos);skipSeen.setAttribute('aria-checked',String(enabled));skipSeen.classList.toggle('is-on',enabled);}
    if(state.galleryOpen&&!panelWasOpen)query('[data-ui="close-gallery"]').focus();
    if(!state.galleryOpen&&panelWasOpen&&panelReturnFocus?.isConnected)panelReturnFocus.focus();
    panelWasOpen=Boolean(state.galleryOpen);
    if(!state.galleryOpen&&pendingToolActions.length&&now>=nextToolActionAt){
      if(state.viewportBlocked||state.reveal||number(state.revealQueueCount)>0)pendingToolActions=[];
      else{action(pendingToolActions.shift());nextToolActionAt=now+140;}
    }
  }

  async function spriteMetadata(name) {
    const response=await fetch(asset(name));
    if(!response.ok) throw Error(`Sprite atlas metadata unavailable: ${name}`);
    return response.json();
  }
  const [atlas,characterAtlases] = await Promise.all([
    spriteMetadata('spritesheet-128.json'),
    Promise.all(['mugi','jiayi','yeseul','eunbi'].map(async characterId=>({characterId,atlas:await spriteMetadata(`${characterId}/field-sprites.json`)})))
  ]);
  renderer = await createThreeRenderer(canvas, {
    ...options, bloom: false, ao: false,
    threeModuleUrl: new URL('./three/three.module.js', import.meta.url).href,
    async onReady(ctx) {
      const {THREE} = ctx;
      ctx.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      ctx.renderer.setClearColor(0x111125, 1);
      const stage = new THREE.Group(); ctx.scene.add(stage);
      cardShader=createCardShader({THREE,ctx,asset});
      const loader = new THREE.TextureLoader();
      async function texture(name, optional = false) {
        try {
          const map = await loader.loadAsync(asset(name));
          map.colorSpace = THREE.SRGBColorSpace; map.generateMipmaps = false;
          map.minFilter = THREE.LinearFilter; map.magFilter = THREE.LinearFilter;
          textures.push(map); return map;
        } catch (error) { if (!optional) throw error; return null; }
      }
      const [pages, mediumPortrait, largePortrait, mediumSheet, largeSheet,characterSheets] = await Promise.all([
        Promise.all(atlas.pages.map(page => texture(page.file))), texture('portrait-medium.webp'), texture('portrait-large.webp'),
        texture('field-medium.webp',true),texture('field-large.webp',true),
        Promise.all(characterAtlases.map(async entry=>({...entry,sheets:await Promise.all(entry.atlas.sources.map(source=>texture(`${entry.characterId}/${source.file}`)))})))
      ]);
      // Optional generated art can be swapped without touching game rules.
      let loungeBackground=null;
      texture('bg-lounge.png', true).then(map => { if (map && !disposed) {loungeBackground=map;if(!hud.classList.contains('is-card-inspecting')||hud.classList.contains('is-card-obscured'))ctx.scene.background=map;} });
      const keepGeometry = value => { geometries.push(value); return value; };
      const material = (settings = {}) => {
        const result = new THREE.MeshBasicMaterial({transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, ...settings});
        materials.push(result); return result;
      };
      function plane(width, height, mat) { return new THREE.Mesh(keepGeometry(new THREE.PlaneGeometry(width, height)), mat); }
      function canvasTexture(draw, width = 192, height = 192) {
        const image = document.createElement('canvas'); image.width = width; image.height = height;
        draw(image.getContext('2d'), width, height);
        const map = new THREE.CanvasTexture(image); map.colorSpace = THREE.SRGBColorSpace; textures.push(map); return map;
      }
      function glyphMap(glyph, color) {
        return canvasTexture((c,w,h) => { c.shadowColor = color; c.shadowBlur = 16; c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 130px "Segoe UI Symbol",sans-serif'; c.fillText(glyph,w/2,h/2+5); });
      }
      const icons = {
        like: material({map: glyphMap('♥','#ff5d9d')}),
        flower: material({map: glyphMap('✿','#ffc3e7')}),
        rocket: material({map: glyphMap('➤','#ffdc8a')})
      };
      const smallMaterials = pages.map(map => material({map}));
      const photoMaterials = {medium: material({map: mediumPortrait}), large: material({map: largePortrait})};
      const fieldSheets={
        'original:medium':{material:mediumSheet?material({map:mediumSheet}):photoMaterials.medium,hasAtlas:Boolean(mediumSheet),columns:8,rows:8,fps:12,frameCount:60,duration:5,asset:'field-medium.webp'},
        'original:large':{material:largeSheet?material({map:largeSheet}):photoMaterials.large,hasAtlas:Boolean(largeSheet),columns:8,rows:8,fps:12,frameCount:60,duration:5,asset:'field-large.webp'},
      };
      for(const {characterId,atlas:sheetAtlas,sheets} of characterSheets) {
        sheetAtlas.sources.forEach((source,index)=>{
          fieldSheets[`${characterId}:${source.symbol_tier}`]={material:material({map:sheets[index]}),hasAtlas:true,columns:source.columns??sheetAtlas.columns,rows:source.rows??sheetAtlas.rows,fps:source.fps??sheetAtlas.fps,frameCount:source.frame_count??sheetAtlas.frame_count,duration:source.loop_duration??source.source_duration,asset:`${characterId}/${source.file}`};
        });
      }
      fieldSpriteMetadata=Object.entries(fieldSheets).map(([key,sheet])=>({key,asset:sheet.asset,fps:sheet.fps,frameCount:sheet.frameCount,columns:sheet.columns,rows:sheet.rows,loopDuration:sheet.duration}));
      const labels = {};
      for (const [tier, text] of Object.entries({small: '小型', medium: '中型', large: '大型'})) {
        labels[tier] = material({map: canvasTexture((c,w,h) => {
          c.fillStyle = tier === 'large' ? '#503119e8' : tier === 'medium' ? '#572945e8' : '#183e45e8';
          c.beginPath(); c.roundRect(5,5,w-10,h-10,23); c.fill();
          c.fillStyle = tier === 'large' ? '#ffe0a4' : tier === 'medium' ? '#ffcfeb' : '#befff9';
          c.font = '600 38px "Microsoft JhengHei",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text,w/2,h/2);
        },192,64)});
      }
      function setFrame(photo, index) {
        if (photo.userData.frame === index) return;
        const frame = atlas.frames[index], page = atlas.pages[frame.page];
        const original = photo.userData.originalUv, uv = photo.geometry.attributes.uv;
        for (let i=0;i<uv.count;i++) uv.setXY(i, (frame.x+original[i*2]*frame.w)/page.width, 1-(frame.y+(1-original[i*2+1])*frame.h)/page.height);
        uv.needsUpdate = true; photo.material = smallMaterials[frame.page]; photo.userData.frame = index;
      }
      function setSheetFrame(photo,index,key) {
        const sheet=fieldSheets[key];
        if (!sheet?.hasAtlas || photo.userData.frame===index) return;
        const original=photo.userData.originalUv,uv=photo.geometry.attributes.uv;
        const column=index%sheet.columns,row=Math.floor(index/sheet.columns);
        for(let i=0;i<uv.count;i++) uv.setXY(i,(column+original[i*2])/sheet.columns,1-(row+1-original[i*2+1])/sheet.rows);
        uv.needsUpdate=true; photo.material=sheet.material; photo.userData.frame=index;
      }
      function newTarget(target) {
        const characterId=target.characterId || 'original',poolKey=`${characterId}:${target.tier}`;
        const reused = targetPool.get(poolKey)?.pop();
        if (reused) { reused.group.visible=true; targetMeshes.set(String(target.id),reused); return reused; }
        const group = new THREE.Group();
        const halo = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(.49,.57,64)), material({color: colors[target.tier] || colors.small, opacity: .18}));
        const ring = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(.475,.50,64)), material({color: colors[target.tier] || colors.small, opacity: .95}));
        const photoGeometry = keepGeometry(new THREE.CircleGeometry(.473,64));
        const photo = new THREE.Mesh(photoGeometry, fieldSheets[poolKey]?.material || (target.tier==='small'?smallMaterials[0]:photoMaterials[target.tier] || photoMaterials.medium));
        photo.userData.originalUv = new Float32Array(photoGeometry.attributes.uv.array);
        const label = plane(.47,.157,labels[target.tier] || labels.small); label.position.set(0,-.46,.01);label.visible=false;
        const glint = new THREE.Mesh(keepGeometry(new THREE.CircleGeometry(.028,12)),material({color:0xffffff,opacity:.85})); glint.position.set(-.28,.33,.02);
        group.add(halo,photo,ring,label,glint); group.renderOrder = 0;
        group.children.forEach(mesh => { mesh.frustumCulled=false; });
        stage.add(group);
        const result = {group,halo,ring,photo,tier:target.tier,characterId,poolKey}; targetMeshes.set(String(target.id), result); return result;
      }
      const lockRing = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(.515,.535,64,1,0,Math.PI*1.65)),material({color:0xffffff}));
      lockRing.renderOrder=9000; lockRing.visible=false; stage.add(lockRing);
      const flowerRange=new THREE.Mesh(keepGeometry(new THREE.RingGeometry(.98,1,96)),material({color:0xffb5df,opacity:.6}));
      flowerRange.visible=false; flowerRange.renderOrder=9010; stage.add(flowerRange);
      function cannon(x, own) {
        const group = new THREE.Group(); group.position.set(x,-4.35,0);
        const base = new THREE.Mesh(keepGeometry(new THREE.CircleGeometry(own?.4:.31,48)),material({color:own?0x43233e:0x272b43,opacity:.96}));
        const trim = new THREE.Mesh(keepGeometry(new THREE.RingGeometry(own?.35:.27,own?.4:.31,48)),material({color:own?0xffcc7e:0x706e8a,opacity:own?1:.65}));
        const barrel = plane(own?.20:.15, own?.56:.40, material({color:own?0xffd8a4:0x837888})); barrel.position.y=.22;
        const heart = plane(own?.25:.19,own?.25:.19,icons.like); heart.position.y=-.025;
        group.add(base,trim,barrel,heart); group.children.forEach((mesh,i)=>mesh.renderOrder=11000+i); stage.add(group);
        return {group,barrel};
      }
      const ownCannon = cannon(0,true); cannon(-5.05,false); cannon(5.17,false);
      function updateTargets(state) {
        const alive = new Set();
        const tierDepth={small:0,medium:1,large:2};
        const ordered=values(state.targets).slice().sort((a,b)=>number(b.y)-number(a.y) || (tierDepth[a.tier]??0)-(tierDepth[b.tier]??0) || (String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0));
        targetLayerOrder=[];
        for (let depth=0;depth<ordered.length;depth++) {
          const target=ordered[depth];
          const id = String(target.id); alive.add(id);
          let view=targetMeshes.get(id);
          const expectedPoolKey=`${target.characterId || 'original'}:${target.tier}`;
          if(view && view.poolKey!==expectedPoolKey) {
            view.group.visible=false; targetMeshes.delete(id);
            if(!targetPool.has(view.poolKey)) targetPool.set(view.poolKey,[]);
            targetPool.get(view.poolKey).push(view); view=null;
          }
          view ||= newTarget(target);
          // One contiguous range per symbol prevents another symbol's frame
          // from being sorted over this symbol's foreground portrait.
          const firstOrder=100+depth*10;
          view.group.children.forEach((mesh,i)=>{mesh.renderOrder=firstOrder+i;});
          const scale = number(target.diameter || 1) * (target.scale === undefined ? 1 : number(target.scale));
          view.group.visible = scale > .005;
          view.group.position.set(number(target.x),number(target.y),0);
          view.group.scale.set(scale,scale,1);
          view.halo.material.opacity=.16 + clamp(target.hitFlash)*.62;
          view.ring.material.color.setHex(target.hitFlash > .1 ? 0xffffff : colors[target.tier] || colors.small);
          if (view.characterId==='original' && target.tier === 'small') {
            const frame=Math.floor(number(target.phase)*atlas.fps)%atlas.frames.length;
            setFrame(view.photo,frame);
          } else {
            const sheet=fieldSheets[view.poolKey];
            if(sheet) {
              const phase=((number(target.phase)%sheet.duration)+sheet.duration)%sheet.duration;
              setSheetFrame(view.photo,Math.min(sheet.frameCount-1,Math.floor(phase*sheet.fps)),view.poolKey);
            }
          }
          targetLayerOrder.push({id,characterId:view.characterId,poolKey:view.poolKey,tier:target.tier,y:number(target.y),spriteFrame:view.photo.userData.frame??null,groupOrder:view.group.renderOrder,layers:view.group.children.map(mesh=>mesh.renderOrder)});
        }
        for (const [id,view] of targetMeshes) if (!alive.has(id)) {
          view.group.visible=false; targetMeshes.delete(id);
          if(!targetPool.has(view.poolKey)) targetPool.set(view.poolKey,[]);
          targetPool.get(view.poolKey).push(view);
        }
        const locked=ordered.find(target=>String(target.id)===String(state.lockedTargetId));
        lockRing.visible=Boolean(state.lock && locked);
        if (locked) { lockRing.position.set(number(locked.x),number(locked.y),.1); lockRing.scale.setScalar(number(locked.diameter)*1.12); lockRing.rotation.z=number(state.time)*1.5; }
      }
      function newShot(shot) {
        const reused=shotPool.pop();
        if (reused) { reused.icon.material=icons[shot.weapon]||icons.like; reused.trail.material.color.setHex(shot.weapon==='rocket'?0xffd778:0xff91c7); shotMeshes.set(String(shot.id),reused); return reused; }
        const group=new THREE.Group(), icon=plane(.38,.38,icons[shot.weapon]||icons.like);
        const trail=plane(.12,.62,material({color:shot.weapon==='rocket'?0xffd778:0xff91c7,opacity:.23})); trail.position.y=-.24;
        group.add(trail,icon); group.children.forEach((mesh,i)=>mesh.renderOrder=10000+i); stage.add(group);
        const result={group,icon,trail}; shotMeshes.set(String(shot.id),result); return result;
      }
      function updateShots(state) {
        const alive=new Set();
        const rounds=number(state.stats?.shots);
        if(rounds>lastShotCount)lastShotAt=number(state.time);
        else if(rounds<lastShotCount)lastShotAt=-Infinity;
        lastShotCount=rounds;
        const recoil=reducedMotion.matches?0:clamp(1-(number(state.time)-lastShotAt)/.12);
        ownCannon.group.scale.setScalar(1+recoil*.035);ownCannon.barrel.position.y=.22-recoil*.055;
        hud.style.setProperty('--shot-progress',String(recoil));
        query('.hc-fire').classList.toggle('is-firing',recoil>0&&!reducedMotion.matches);
        flowerRange.visible=false;
        presentedShots=[];
        if(Number.isFinite(state.aim?.angle)) {
          presentedCannonAngle=state.aim.angle;
          ownCannon.group.rotation.z=presentedCannonAngle-Math.PI/2;
        }
        for (const shot of values(state.shots)) {
          const id=String(shot.id); alive.add(id);
          const view=shotMeshes.get(id)||newShot(shot);
          const valid=Number.isFinite(shot.x) && Number.isFinite(shot.y) && Number.isFinite(shot.rotation);
          view.group.visible=valid;
          if(!valid) continue;
          view.group.position.set(shot.x,shot.y,.1);
          view.group.rotation.z=shot.rotation-Math.PI/2;
          view.icon.rotation.z=shot.weapon==='rocket'?Math.PI/2:-view.group.rotation.z;
          presentedShots.push({id,x:shot.x,y:shot.y,rotation:shot.rotation,trajectory:shot.trajectory,collisionCount:shot.collisionCount});
          if(shot.weapon==='flower') {
            const radius=number(state.lastRound?.searchRadius || state.demoConfig?.flowerRadius);
            flowerRange.visible=radius>0; flowerRange.position.set(number(shot.to?.x),number(shot.to?.y),.1);
            flowerRange.scale.setScalar(radius); flowerRange.material.opacity=.45;
          }
        }
        for (const [id,view] of shotMeshes) if (!alive.has(id)) { view.group.visible=false; shotMeshes.delete(id); shotPool.push(view); }
      }
      function updateFloating(state) {
        const alive=new Set();
        for (const floating of values(state.floating)) {
          if(number(floating.amount)<=0)continue;
          const id=String(floating.id); alive.add(id);
          let node=floatingNodes.get(id);
          if (!node) { node=document.createElement('div'); node.className='hc-win-number'; floatLayer.append(node); floatingNodes.set(id,node); }
          node.textContent=floating.text || `+${format(floating.amount)}`;
          node.dataset.tier=floating.tier||'small';
          const progress=clamp(number(floating.age)/Math.max(.001,number(floating.duration)));
          node.style.left=`${(number(floating.x)/17.7777778+.5)*100}%`;
          node.style.top=`${(0.5-number(floating.y)/10)*100-progress*5}%`;
          node.style.opacity=String(Math.min(1,(1-progress)*3));
          node.style.transform=`translate(-50%,-50%) scale(${1+Math.sin(progress*Math.PI)*.12})`;
        }
        for (const [id,node] of floatingNodes) if (!alive.has(id)) { node.remove(); floatingNodes.delete(id); }
      }
      ctx.attachPresentation({
        beforeRender({snapshot}) {
          lastSnapshot=snapshot;
          const state=snapshot?.world?.observations?.game;
          if (!state) return;
          latest=state; drawFrames++; landscape.sync(state);
          syncCardSeed(state);
          if(drawFrames===2)document.body.dataset.hotChickReady='true';
          updateWallet(state); updateCadence(state); updateTargets(state); updateShots(state); updateFloating(state); updateRewardFx(state); updateMediumPlayers(state);
          updateReveal(state);
          const inspecting=!inspectionLayer.hidden&&Boolean(state.galleryOpen),bigActive=(state.reveal?.symbolTier||state.reveal?.tier)==='large',obscured=inspecting&&bigActive;
          stage.visible=!inspecting||bigActive;ctx.scene.background=stage.visible?loungeBackground:null;
          hud.classList.toggle('is-card-inspecting',inspecting);hud.classList.toggle('is-card-obscured',obscured);
          cardCollection.setSuspended(obscured);inspectionLayer.inert=obscured;inspectionLayer.classList.toggle('is-obscured',obscured);
          if(obscured)inspectionLayer.setAttribute('aria-hidden','true');else inspectionLayer.removeAttribute('aria-hidden');
          if(Boolean(state.cardViewerOpen)!==inspecting)action(inspecting?'CardViewerOpen':'CardViewerClose');
          if(Boolean(state.cardViewerReducedMotion)!==reducedMotion.matches)action(reducedMotion.matches?'CardViewerReducedMotion':'CardViewerFullMotion');
          const cardPose=cardCollection.getViewerPose(),inspectedCard=values(state.cards?.catalog).find(card=>card.id===cardPose?.cardId);
          const shaderStatus=cardShader.update({snapshot,pose:inspecting?cardPose:null,card:inspectedCard,canvasRect:canvas.getBoundingClientRect()});
          cardShader.setVisible(inspecting&&!obscured);cardCollection.setShaderReady(cardPose?.cardId,Boolean(shaderStatus?.ready));
          if(obscured!==inspectionWasObscured){if(obscured)(!introOverlay.hidden?introOverlay:revealOverlay).querySelector('button')?.focus({preventScroll:true});else if(inspecting)inspectionLayer.querySelector('.hc-card-stage')?.focus({preventScroll:true});inspectionWasObscured=obscured;}
          inspectionPresentation={active:inspecting,obscured,fieldVisible:stage.visible};
          if (performance.now()-lastUiAt>60) { updateHud(state); lastUiAt=performance.now(); }
        },
        onDispose() {
          disposed=true;pendingToolActions=[];nextToolActionAt=Infinity;revealVideo.pause(); releaseGalleryVideo();cardCollection.release();cardShader?.dispose(); cancelVideoFrameCallback();
          for(const player of mediumPlayers.values()) releaseMediumPlayer(player);
          mediumPlayers.clear();
          for (const fn of cleanup) fn();
          for (const code of pendingKeys) window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
          stage.removeFromParent();
          for (const map of textures) map.dispose(); for (const mat of materials) mat.dispose(); for (const geometry of geometries) geometry.dispose();
          hud.remove(); css.remove();cardsCss.remove(); delete window.hotChickDebug;delete document.body.dataset.hotChickReady;
        }
      });
      initialized=true;
    }
  });
  if(debugMode)Object.defineProperty(window,'hotChickDebug',{configurable:true,value:Object.freeze({
    get ready(){return initialized&&drawFrames>1&&!disposed;},
    snapshot(){return latest?JSON.parse(JSON.stringify(latest)):null;},
    metadata(){return {
      implementation:'Unone official createThreeRenderer + attachPresentation',rendererMode:'custom',
      source:'game/presentation/game-renderer.mjs',luaFrame:lastSnapshot?.world?.frame,
      fieldTargets:values(latest?.targets).length,
      symbolDepthPolicy:'back-to-front: descending world y, tier small/medium/large, stable id; contiguous halo/photo/ring/label/glint',
      symbolLayers:targetLayerOrder.map(entry=>({...entry,layers:[...entry.layers]})),
      pooledTargets:[...targetPool.values()].reduce((sum,pool)=>sum+pool.length,0),
      targetPools:[...targetPool.entries()].map(([key,pool])=>({key,count:pool.length})),
      fieldSprites:fieldSpriteMetadata.map(sheet=>({...sheet})),
      inspection:inspectionPresentation,
      cardShader:cardShader?.metadata()||null,
      gallery:{selectedCharacterId:galleryCharacterId,selectedSection:gallerySection,playingClipId:galleryClipId,hintClipId:galleryHintClipId,cards:cardCollection.metadata(),
        player:galleryVideo?{source:galleryVideo.currentSrc,currentTime:galleryVideo.currentTime,paused:galleryVideo.paused,muted:galleryVideo.muted}:null,
        characters:values(latest?.gallery?.characters).map(character=>({id:character.id,name:character.name,styles:values(character.styles).map(style=>({id:style.id,title:style.title,items:values(style.items).map(item=>({clipId:item.clipId,prizeTier:item.prizeTier,available:item.available,unlocked:item.unlocked,replayAsset:item.replayAsset}))}))}))},
      activeShots:shotMeshes.size,pooledShots:shotPool.length,
      cannonAimAngle:presentedCannonAngle,presentedShots:presentedShots.map(shot=>({...shot})),
      cadence:{weapon:latest?.weapon,...presentedCadence,cooldownRemaining:latest?.cooldown??0},
      panels:{view:galleryView,open:Boolean(latest?.galleryOpen),queuedToolActions:pendingToolActions.length},
      activeRewardHearts:heartNodes.size,pooledRewardHearts:heartNodePool.length,
      walletArrivalsSerial:latest?.walletArrivalsSerial??0,
      displayBalance:latest?.displayBalance??latest?.balance,pendingWin:latest?.pendingWin??0,
      walletLastIncrement:latest?.walletLastIncrement??0,walletLastIncrementSerial:latest?.walletLastIncrementSerial??0,
      walletLastIncrementAge:latest?.walletLastIncrementAge??0,hudBalanceText:output.balance.textContent,
      fieldVideoPlayers:0,sharedAtlasPages:atlas.pages.length,atlasFrames:atlas.frame_count,atlasFps:atlas.fps,
      viewport:[canvas.clientWidth,canvas.clientHeight],orientation:landscape.metadata(),metrics:renderer.metrics(),
      reveal:currentReveal?{tier:currentReveal.tier,symbolTier:currentReveal.symbolTier,rewardTier:currentReveal.rewardTier,stage:currentRevealStage,preview:currentReveal.preview,serial:currentReveal.serial,characterId:currentReveal.characterId,styleId:currentReveal.styleId,clipId:currentReveal.clipId,videoAsset:currentReveal.videoAsset,posterAsset:currentReveal.posterAsset}:null,
      video:{currentTime:revealVideo.currentTime,duration:Number.isFinite(revealVideo.duration)?revealVideo.duration:null,paused:revealVideo.paused,readyState:revealVideo.readyState,error:revealVideo.error?.message||null,startNotice:{...videoStartNotice}},
      mediumPlayerLimit:6,activeMediumDecoders:[...mediumPlayers.values()].filter(player=>Boolean(player.video)).length,
      mediumPlayers:[...mediumPlayers.values()].map(player=>({
        serial:player.serial,slot:player.slot,stage:player.stage,currentTime:player.video?.currentTime??player.lastTime,
        duration:player.video&&Number.isFinite(player.video.duration)?player.video.duration:player.lastDuration,
        paused:player.video?.paused??true,error:player.error,started:player.started,
        luaStarted:Boolean(player.reveal?.videoStarted),startNotice:player.startNotice?{...player.startNotice}:null,
        released:player.released,visible:Boolean(player.node?.isConnected),source:player.source,
        characterId:player.reveal?.characterId,styleId:player.reveal?.styleId,clipId:player.reveal?.clipId,poster:player.poster,aspectRatio:player.reveal?.aspectRatio,
        transitionSent:player.transitionSent,preview:Boolean(player.reveal?.preview),
        readyState:player.video?.readyState??0,frameCallbackPending:player.frameCallbackId!==null,
      })),
      largeVideoFade:{...largeVideoFade,opacity:number(revealOverlay.style.getPropertyValue('--large-video-opacity')),introVisible:!introOverlay.hidden},
      simulationOnly:true
    };}
  })});
  return renderer;
}
