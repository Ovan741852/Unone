const $=id=>document.getElementById(id);
const video=$('source-video'),overlay=$('crop-overlay'),outputPreview=$('output-preview');
const state={info:null,sources:[],source:null,outputs:[],selectedOutput:null,baseRecipe:{},crop:null,drag:null,busy:false,loading:false,pendingSeek:0,frameHandle:null,job:null,pollTimer:null};
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const numeric=(id,fallback=0)=>Number.isFinite(Number($(id).value))?Number($(id).value):fallback;
const clone=value=>JSON.parse(JSON.stringify(value));
const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const formatTime=value=>{const seconds=Math.max(0,Number(value)||0);return `${Math.floor(seconds/60)}:${(seconds%60).toFixed(2).padStart(5,'0')}`;};
const rounded=value=>Number(Number(value).toFixed(6));
const joinPath=(parent,file)=>`${String(parent||'').replace(/[\\/]+$/,'')}/${String(file||'').replace(/^[\\/]+/,'')}`;
const isAbsolute=path=>/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(path);
const sourceById=id=>state.sources.find(source=>source.id===id);
let noticeTimer;

function notice(message,tone='info',timeout=5000){clearTimeout(noticeTimer);const element=$('notice');element.textContent=message;element.className=`notice is-${tone}`;element.hidden=false;if(timeout)noticeTimer=setTimeout(()=>{element.hidden=true;},timeout);}
async function api(path,options={}){
 const response=await fetch(path,options);
 let value;try{value=await response.json();}catch{throw Error(`服務未回傳有效資料（${response.status}）。`);}
 if(!response.ok)throw Error(value.errors?.join('\n')||value.error||`服務錯誤（${response.status}）。`);
 return value;
}
const post=(path,value)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
async function perform(task){try{await task();}catch(error){notice(error.message||String(error),'error',9000);console.error(error);}}
function defaultDirectory(){return joinPath(state.info?.default_output_root||'assets/generated',$('character-id').value.trim()||'character');}
function sourceControls(enabled){
 for(const id of ['play-toggle','timeline','mute-toggle','trim-start','trim-end','set-start','set-end','crop-enabled','crop-full','crop-square','crop-x','crop-y','crop-width','crop-height'])$(id).disabled=!enabled;
 $('add-preset').disabled=!enabled||state.loading;
}
function setLoading(value){state.loading=value;document.body.classList.toggle('is-busy',value);for(const id of ['pick-files','probe-path','load-example','import-recipe'])$(id).disabled=value;sourceControls(Boolean(state.source));}
function currentRange(){
 const duration=state.source?.duration||0;
 const start=clamp(numeric('trim-start'),0,Math.max(0,duration-.001));
 const end=clamp(numeric('trim-end',duration),Math.min(duration,start+.001),duration);
 return {start:rounded(start),end:rounded(end),duration:rounded(end-start)};
}
function effectiveCrop(){return $('crop-enabled').checked&&state.crop?clone(state.crop):null;}
function normalizeCrop(rect){
 if(!state.source)return null;
 const width=state.source.width,height=state.source.height;
 const w=clamp(Math.round(Number(rect.width)||2),2,width),h=clamp(Math.round(Number(rect.height)||2),2,height);
 return {x:clamp(Math.round(Number(rect.x)||0),0,width-w),y:clamp(Math.round(Number(rect.y)||0),0,height-h),width:w,height:h};
}
function setCrop(rect,syncFields=true){
 state.crop=normalizeCrop(rect);
 if(!state.crop)return;
 if(syncFields)for(const [key,id] of Object.entries({x:'crop-x',y:'crop-y',width:'crop-width',height:'crop-height'}))$(id).value=state.crop[key];
 drawOverlay();drawOutput();updateSummary();
}
function seek(time){const value=clamp(Number(time)||0,0,state.source?.duration||0);state.pendingSeek=value;if(video.readyState>=1){video.currentTime=value;state.pendingSeek=null;}updateTransport();}
function selectSource(source,{clearSelection=true}={}){
 if(!source)return;
 if(clearSelection){state.selectedOutput=null;$('selected-output').hidden=true;}
 state.source=source;stopFrameLoop();video.pause();video.src=source.preview_url;video.load();
 $('empty-stage').hidden=true;$('preview-label').hidden=false;$('source-meta').textContent=`${source.width} × ${source.height} · ${Number(source.fps).toFixed(2).replace(/\.00$/,'')} fps · ${source.duration.toFixed(2)} 秒`;
 $('editor-heading').textContent=source.filename;
 $('trim-start').value=0;$('trim-end').value=rounded(source.duration);$('trim-start').max=source.duration;$('trim-end').max=source.duration;
 $('timeline').max=source.duration;$('timeline').value=0;state.pendingSeek=0;
 $('crop-enabled').checked=false;setCrop({x:0,y:0,width:source.width,height:source.height});
 sourceControls(true);renderSources();updatePreset();updateSummary();
}
function addSourceMetadata(metadata,{id}={}){
 const existing=state.sources.find(source=>source.path===metadata.path&&(!id||source.id===id));
 if(existing){const stableId=existing.id;Object.assign(existing,metadata,{id:stableId});selectSource(existing);renderRecipe();return existing;}
 let chosen=id||metadata.source_id||`source-${state.sources.length+1}`;
 const base=chosen;let suffix=2;while(state.sources.some(source=>source.id===chosen))chosen=`${base}-${suffix++}`;
 const source={...metadata,id:chosen};state.sources.push(source);selectSource(source);renderRecipe();return source;
}
function renderSources(){
 const list=$('source-list');list.replaceChildren();$('source-count').textContent=state.sources.length?`${state.sources.length} 段來源影片`:'尚未加入來源';
 for(const source of state.sources){const button=node('button','source-item');button.type='button';button.classList.toggle('is-active',source.id===state.source?.id);button.dataset.sourceId=source.id;button.title=source.path;const main=node('span','source-item-main');main.append(node('strong',null,source.filename),node('small',null,`${source.width} × ${source.height} · ${source.duration.toFixed(2)} 秒`));button.append(node('span','source-icon','▤'),main);button.addEventListener('click',()=>selectSource(source));list.append(button);}
}
async function readPath(path){
 const value=String(path||'').trim().replace(/^"|"$/g,'');if(!value)throw Error('請先輸入來源影片的完整路徑。');
 setLoading(true);notice('正在讀取影片與建立預覽…','info',0);
 try{const metadata=await post('/api/probe',{path:value});addSourceMetadata(metadata);notice(`已讀取 ${metadata.filename}`,'success');}finally{setLoading(false);}
}
async function uploadFiles(files){
 if(!files.length)return;setLoading(true);
 try{for(let index=0;index<files.length;index++){const file=files[index];notice(`正在加入 ${index+1} / ${files.length}：${file.name}`,'info',0);const metadata=await api(`/api/upload?filename=${encodeURIComponent(file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});addSourceMetadata({...metadata,filename:file.name});}notice(`已加入 ${files.length} 段影片`,'success');}finally{setLoading(false);$('source-files').value='';}
}
function frameRect(){
 if(!state.source)return null;
 const width=overlay.clientWidth,height=overlay.clientHeight,scale=Math.min(width/state.source.width,height/state.source.height);
 return {x:(width-state.source.width*scale)/2,y:(height-state.source.height*scale)/2,width:state.source.width*scale,height:state.source.height*scale,scale};
}
function resizeOverlay(){const ratio=Math.min(devicePixelRatio||1,2);overlay.width=Math.round(overlay.clientWidth*ratio);overlay.height=Math.round(overlay.clientHeight*ratio);drawOverlay();drawOutput();}
function drawOverlay(){
 const context=overlay.getContext('2d'),ratio=overlay.width/Math.max(1,overlay.clientWidth);context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,overlay.clientWidth,overlay.clientHeight);
 const frame=frameRect(),crop=state.crop,enabled=$('crop-enabled').checked;overlay.style.pointerEvents=enabled?'auto':'none';
 if(!frame||!crop||!enabled)return;
 const rect={x:frame.x+crop.x*frame.scale,y:frame.y+crop.y*frame.scale,width:crop.width*frame.scale,height:crop.height*frame.scale};
 context.fillStyle='rgba(6,12,25,.55)';context.fillRect(0,0,overlay.clientWidth,overlay.clientHeight);context.clearRect(rect.x,rect.y,rect.width,rect.height);context.strokeStyle='#83e5dd';context.lineWidth=2;context.strokeRect(rect.x,rect.y,rect.width,rect.height);
 context.strokeStyle='#ffffff3d';context.lineWidth=1;for(const t of [1/3,2/3]){context.beginPath();context.moveTo(rect.x+rect.width*t,rect.y);context.lineTo(rect.x+rect.width*t,rect.y+rect.height);context.stroke();context.beginPath();context.moveTo(rect.x,rect.y+rect.height*t);context.lineTo(rect.x+rect.width,rect.y+rect.height*t);context.stroke();}
 context.fillStyle='#d9fffa';for(const [x,y] of [[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]]){context.fillRect(x-4,y-4,8,8);}
}
function outputAspect(){
 if(state.selectedOutput!==null){const output=state.outputs[state.selectedOutput];if(output){const width=Number(output.width||output.tile_width||output.max_width),height=Number(output.height||output.tile_height||output.max_height);if(width>0&&height>0)return width/height;}}
 return $('output-preset').value==='medium'?9/16:$('output-preset').value==='large'?16/9:1;
}
function drawOutput(){
 const context=outputPreview.getContext('2d'),width=outputPreview.width,height=outputPreview.height;context.clearRect(0,0,width,height);
 context.fillStyle='#e8ecf2';context.fillRect(0,0,width,height);context.fillStyle='#dce2ec';for(let y=0;y<height;y+=12)for(let x=0;x<width;x+=12)if((x/12+y/12)%2===0)context.fillRect(x,y,12,12);
 if(!state.source||video.readyState<2)return;
 const source=effectiveCrop()||{x:0,y:0,width:state.source.width,height:state.source.height};
 const aspect=outputAspect(),boxWidth=Math.min(width,height*aspect),boxHeight=boxWidth/aspect,bx=(width-boxWidth)/2,by=(height-boxHeight)/2;
 context.save();context.beginPath();context.rect(bx,by,boxWidth,boxHeight);context.clip();context.fillStyle=$('output-preset').value==='field'?'#ffffff00':'#0c1424';context.fillRect(bx,by,boxWidth,boxHeight);
 const scale=$('fit-mode').value==='cover'?Math.max(boxWidth/source.width,boxHeight/source.height):Math.min(boxWidth/source.width,boxHeight/source.height);
 const dw=source.width*scale,dh=source.height*scale;
 // The editing coordinates belong to the original source, while the browser
 // decodes a resized H.264 proxy. Convert only the drawImage sampling rectangle.
 const proxyScaleX=video.videoWidth/state.source.width,proxyScaleY=video.videoHeight/state.source.height;
 try{context.drawImage(video,source.x*proxyScaleX,source.y*proxyScaleY,source.width*proxyScaleX,source.height*proxyScaleY,bx+(boxWidth-dw)/2,by+(boxHeight-dh)/2,dw,dh);}catch{}
 context.restore();context.strokeStyle='#b6c0d133';context.lineWidth=1;context.strokeRect(bx+.5,by+.5,boxWidth-1,boxHeight-1);
}
function pointOnSource(event){const rect=overlay.getBoundingClientRect(),frame=frameRect();return {x:clamp((event.clientX-rect.left-frame.x)/frame.scale,0,state.source.width),y:clamp((event.clientY-rect.top-frame.y)/frame.scale,0,state.source.height)};}
function startCrop(event){
 if(!state.source||!$('crop-enabled').checked)return;event.preventDefault();const point=pointOnSource(event),crop=clone(state.crop),frame=frameRect(),threshold=10/frame.scale;
 let mode='create';for(const [name,x,y] of [['nw',crop.x,crop.y],['ne',crop.x+crop.width,crop.y],['sw',crop.x,crop.y+crop.height],['se',crop.x+crop.width,crop.y+crop.height]])if(Math.hypot(point.x-x,point.y-y)<=threshold)mode=name;
 const full=crop.x===0&&crop.y===0&&crop.width===state.source.width&&crop.height===state.source.height;
 if(mode==='create'&&!full&&point.x>=crop.x&&point.x<=crop.x+crop.width&&point.y>=crop.y&&point.y<=crop.y+crop.height)mode='move';
 state.drag={mode,start:point,crop,pointerId:event.pointerId,moved:false};overlay.setPointerCapture(event.pointerId);
}
function moveCrop(event){
 if(!state.drag||!state.source)return;event.preventDefault();const drag=state.drag,point=pointOnSource(event),frame=frameRect();if(Math.hypot(point.x-drag.start.x,point.y-drag.start.y)*frame.scale>2)drag.moved=true;if(!drag.moved)return;
 if(drag.mode==='move'){setCrop({...drag.crop,x:drag.crop.x+point.x-drag.start.x,y:drag.crop.y+point.y-drag.start.y});return;}
 let anchor=drag.start;
 if(drag.mode!=='create')anchor={x:drag.mode.includes('w')?drag.crop.x+drag.crop.width:drag.crop.x,y:drag.mode.includes('n')?drag.crop.y+drag.crop.height:drag.crop.y};
 setCrop({x:Math.min(anchor.x,point.x),y:Math.min(anchor.y,point.y),width:Math.abs(point.x-anchor.x),height:Math.abs(point.y-anchor.y)});
}
function endCrop(event){if(!state.drag)return;if(!state.drag.moved)setCrop(state.drag.crop);if(overlay.hasPointerCapture(event.pointerId))overlay.releasePointerCapture(event.pointerId);state.drag=null;}
function updateTransport(){const current=video.readyState?video.currentTime:state.pendingSeek||0;$('timeline').value=current;$('current-time').textContent=formatTime(current);$('total-time').textContent=formatTime(state.source?.duration||0);$('play-toggle').textContent=video.paused?'▶':'Ⅱ';$('play-toggle').setAttribute('aria-label',video.paused?'播放影片':'暫停影片');}
function frameLoop(){drawOutput();if(video.paused)return;state.frameHandle=video.requestVideoFrameCallback?video.requestVideoFrameCallback(frameLoop):requestAnimationFrame(frameLoop);}
function stopFrameLoop(){if(state.frameHandle!==null){if(video.cancelVideoFrameCallback)video.cancelVideoFrameCallback(state.frameHandle);else cancelAnimationFrame(state.frameHandle);state.frameHandle=null;}}
function normalizeRange(){if(!state.source)return;const duration=state.source.duration;let start=clamp(numeric('trim-start'),0,Math.max(0,duration-.01)),end=clamp(numeric('trim-end',duration),.01,duration);if(end<=start)end=Math.min(duration,start+.01);$('trim-start').value=rounded(start);$('trim-end').value=rounded(end);if(video.currentTime<start||video.currentTime>end)seek(start);updateSummary();}
function updateSummary(){
 if(!state.source){$('selection-summary').textContent='加入影片後即可調整';return;}
 const range=currentRange(),crop=effectiveCrop();$('selection-summary').textContent=`${range.duration.toFixed(2)} 秒 · ${crop?`${crop.width} × ${crop.height}`:`${state.source.width} × ${state.source.height}`} 取景`;
 $('crop-summary').textContent=crop?`裁切座標 (${crop.x}, ${crop.y})，原片不會被修改。`:'保留完整畫面與原始比例。';renderRecipe();
}
function updatePreset(){
 const preset=$('output-preset').value;if(preset!=='field')$('symbol-tier').value=preset;
 $('symbol-tier').disabled=preset!=='field';$('atlas-fps').disabled=preset!=='field';$('atlas-tile').disabled=preset!=='field';$('small-gallery-label').hidden=preset!=='field'||$('symbol-tier').value!=='small';
 $('preset-summary').textContent=preset==='field'?`${numeric('atlas-tile',128)} px 圖塊 · ${numeric('atlas-fps',12)} fps · WebP 圖集與海報`:preset==='medium'?'270 × 480 演出 ＋ 720 × 1280 回顧 ＋ 海報':'1920 × 1080 滿版演出 ＋ 海報';
 drawOutput();updateSummary();
}
function commonOutput(){if(!state.source)throw Error('請先加入並選擇來源影片。');const range=currentRange();if(range.duration<=0)throw Error('片段終點必須大於起點。');const value={source_id:state.source.id,start_seconds:range.start,end_seconds:range.end,fit:$('fit-mode').value};const crop=effectiveCrop();if(crop)value.crop=crop;return value;}
function videoOutput(file,width,height,common){return {...clone(common),type:'video',file,width,height,fps:24,codec:'h264',pixel_format:'yuv420p',crf:20,preset:'medium',audio:'copy_if_present',faststart:true};}
function posterOutput(file,size,common){const range=currentRange();const {source_id,fit,crop}=common;const output={type:'poster',file,source_id,at_seconds:rounded(clamp(video.currentTime||range.start,range.start,Math.max(range.start,range.end-.001))),max_width:size,max_height:size,fit,format:'webp',quality:90};if(crop)output.crop=clone(crop);return output;}
function addPreset(){
 const common=commonOutput(),preset=$('output-preset').value,tier=$('symbol-tier').value,style=$('style-id').value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_-]*$/.test(style))throw Error('風格代號請使用英文字母、數字、連字號或底線。');
 const outputs=[];
 if(preset==='field'){
  const fps=clamp(Math.round(numeric('atlas-fps',12)),1,60),tile=clamp(Math.round(numeric('atlas-tile',128)),32,1024),duration=currentRange().duration,count=Math.max(1,Math.ceil(duration*fps-1e-6));
  outputs.push({...clone(common),type:'atlas',file:`field-${tier}.webp`,symbol_tier:tier,duration_seconds:duration,source_original_duration:state.source.duration,fps,frame_count:count,tile_width:tile,tile_height:tile,columns:8,rows:Math.ceil(count/8),padding:'transparent',format:'webp',quality:88,method:6});
  outputs.push(posterOutput(`field-${tier}-poster.webp`,320,common));if(tier==='small'&&$('small-gallery').checked)outputs.push(videoOutput('field-small.mp4',480,480,common));
 }else if(preset==='medium')outputs.push(videoOutput(`${style}-medium-480.mp4`,270,480,common),videoOutput(`${style}-medium.mp4`,720,1280,common),posterOutput(`${style}-medium-poster.webp`,640,common));
 else outputs.push(videoOutput(`${style}-large.mp4`,1920,1080,common),posterOutput(`${style}-large-poster.webp`,640,common));
 for(const output of outputs){const index=state.outputs.findIndex(existing=>existing.file===output.file);if(index<0)state.outputs.push(output);else state.outputs[index]=output;}
 state.selectedOutput=null;$('selected-output').hidden=true;renderQueue();notice(`已加入／更新 ${outputs.length} 個輸出項目`,'success');
}
function selectOutput(index){
 const output=state.outputs[index],source=sourceById(output.source_id);if(!output||!source)return;state.selectedOutput=index;selectSource(source,{clearSelection:false});
 $('output-preset').value=output.type==='atlas'||output.file.startsWith('field-')?'field':output.file.includes('medium')?'medium':'large';$('symbol-tier').value=output.symbol_tier||($('output-preset').value==='field'?'small':$('output-preset').value);
 const stem=output.file.match(/^(.+)-(?:medium|large)(?:-|\.)/);if(stem)$('style-id').value=stem[1];
 $('trim-start').value=output.start_seconds??0;$('trim-end').value=output.end_seconds??Math.min(source.duration,(output.start_seconds||0)+(output.duration_seconds||source.duration));
 $('fit-mode').value=output.fit||'contain';$('crop-enabled').checked=Boolean(output.crop);setCrop(output.crop||{x:0,y:0,width:source.width,height:source.height});
 if(output.type==='atlas'){$('atlas-fps').value=output.fps||12;$('atlas-tile').value=output.tile_width||128;}
 $('selected-output').hidden=false;$('output-file').value=output.file;$('output-width').value=output.width||output.tile_width||output.max_width||640;$('output-height').value=output.height||output.tile_height||output.max_height||640;
 seek(output.type==='poster'?output.at_seconds||0:Number($('trim-start').value));updatePreset();renderQueue();$('editor-heading').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}
function updateSelected(){
 if(state.selectedOutput===null)return;const index=state.selectedOutput,previous=state.outputs[index],common=commonOutput(),file=$('output-file').value.trim();if(!file)throw Error('輸出檔名不可空白。');if(state.outputs.some((out,i)=>i!==index&&out.file===file))throw Error('佇列中已有相同輸出檔名。');
 const width=Math.max(2,Math.round(numeric('output-width',128))),height=Math.max(2,Math.round(numeric('output-height',128))),output={...previous,...common,file};delete output.crop;if(common.crop)output.crop=common.crop;
 if(previous.type==='poster'){delete output.start_seconds;delete output.end_seconds;delete output.duration_seconds;output.at_seconds=rounded(clamp(video.currentTime||currentRange().start,0,Math.max(0,state.source.duration-.001)));output.max_width=width;output.max_height=height;}
 else if(previous.type==='video'){output.width=width;output.height=height;delete output.duration_seconds;}
 else{output.fps=clamp(Math.round(numeric('atlas-fps',12)),1,60);output.duration_seconds=currentRange().duration;output.source_original_duration=state.source.duration;output.frame_count=Math.max(1,Math.ceil(output.duration_seconds*output.fps-1e-6));output.tile_width=width;output.tile_height=height;output.columns=previous.columns||8;output.rows=Math.ceil(output.frame_count/output.columns);delete output.sample_frame_indices;}
 state.outputs[index]=output;renderQueue();notice('已更新選取輸出','success');
}
function renderQueue(){
 const list=$('queue-list');list.replaceChildren();$('queue-count').textContent=state.outputs.length;$('queue-empty').hidden=state.outputs.length>0;$('clear-queue').disabled=!state.outputs.length;
 state.outputs.forEach((output,index)=>{const row=node('div','queue-item');row.classList.toggle('is-selected',state.selectedOutput===index);const select=node('button','queue-item-main');select.type='button';select.dataset.outputIndex=index;const source=sourceById(output.source_id);const start=output.start_seconds||0,end=output.end_seconds??start+(output.duration_seconds||source?.duration||0);const detail=output.type==='atlas'?`${output.frame_count} 格 · ${output.fps} fps · ${output.tile_width} px`:output.type==='poster'?`海報 · ${Number(output.at_seconds||0).toFixed(2)} 秒`:`${output.width} × ${output.height} · ${Math.max(0,end-start).toFixed(2)} 秒`;select.append(node('strong',null,output.file),node('small',null,detail));select.addEventListener('click',()=>selectOutput(index));const remove=node('button','queue-remove','×');remove.type='button';remove.title='移除此輸出';remove.setAttribute('aria-label',`移除 ${output.file}`);remove.addEventListener('click',()=>{state.outputs.splice(index,1);state.selectedOutput=null;$('selected-output').hidden=true;renderQueue();});row.append(node('span','queue-type',output.type==='atlas'?'▦':output.type==='poster'?'▧':'▷'),select,remove);list.append(row);});renderRecipe();
}
function recipe(){
 const id=$('character-id').value.trim().toLowerCase();if(!/^[a-z0-9][a-z0-9_-]*$/.test(id))throw Error('角色代號請使用英文字母、數字、連字號或底線。');
 const directory=$('output-directory').value.trim()||defaultDirectory();
 const result={...clone(state.baseRecipe),schema:'hotchick.media.recipe.v1',character_id:id,character_name:$('character-name').value.trim()||id,source_directory:state.info?.workspace||'',output_directory:directory,originals_directory:joinPath(directory,'originals'),preserve_originals:$('preserve-originals').checked,cropped:state.outputs.some(output=>Boolean(output.crop)),background_removed:false,sources:state.sources.map(source=>({id:source.id,file:source.path,sha256:source.sha256})),outputs:clone(state.outputs),runtime_manifest:'runtime-manifest.json'};
 const first=state.outputs.find(output=>output.type==='atlas');if(first)result.field_metadata={...(result.field_metadata||{}),file:result.field_metadata?.file||'field-sprites.json',fps:first.fps,frame_count:first.frame_count,columns:first.columns,rows:first.rows,tile:first.tile_width,order:'row-major'};else delete result.field_metadata;
 delete result.overwrite;return result;
}
function renderRecipe(){
 let valid=true;try{$('recipe-preview').textContent=JSON.stringify(recipe(),null,2);}catch(error){valid=false;$('recipe-preview').textContent=error.message;}
 $('export-recipe').disabled=!valid||!state.outputs.length;$('validate-recipe').disabled=!valid||!state.outputs.length||state.busy;$('build-recipe').disabled=!valid||!state.outputs.length||state.busy||!state.info?.ffmpeg_ready;
}
async function loadRecipe(value){
 if(value?.schema!=='hotchick.media.recipe.v1'||!Array.isArray(value.sources)||!Array.isArray(value.outputs))throw Error('這不是可讀取的素材配方。');
 setLoading(true);notice('正在載入配方來源與預覽…','info',0);
 try{
  const sources=[];for(let index=0;index<value.sources.length;index++){const source=value.sources[index],path=isAbsolute(source.file)?source.file:joinPath(value.source_directory||state.info?.workspace,source.file);notice(`載入來源 ${index+1} / ${value.sources.length}…`,'info',0);const metadata=await post('/api/probe',{path});if(source.sha256&&metadata.sha256!==source.sha256)throw Error(`來源內容已變動：${metadata.filename}。請確認原檔後再匯入。`);sources.push({...metadata,id:source.id});}
  state.baseRecipe=clone(value);state.sources=sources;state.outputs=clone(value.outputs);state.selectedOutput=null;$('selected-output').hidden=true;$('character-id').value=value.character_id||'character';$('character-name').value=value.character_name||value.character_id||'';lastAutoDirectory=defaultDirectory();$('output-directory').value=lastAutoDirectory;$('preserve-originals').checked=value.preserve_originals!==false;$('allow-overwrite').checked=false;
  if(sources.length)selectSource(sources[0]);renderSources();renderQueue();notice(`已載入 ${sources.length} 段影片與 ${value.outputs.length} 個輸出，產物將存至獨立資料夾。`,'success',7000);
 }finally{setLoading(false);}
}
async function validate(){const result=await post('/api/validate',{recipe:recipe(),output_directory:$('output-directory').value.trim()||defaultDirectory(),overwrite:$('allow-overwrite').checked});if(!result.ok)throw Error(result.errors?.join('\n')||'配方檢查未通過。');notice('配方檢查通過，可以開始產生素材。','success');}
async function build(){
 await validate();state.busy=true;renderRecipe();$('results-panel').hidden=false;$('build-state').textContent='排程中';$('build-state').className='service-badge';$('build-progress').style.width='0%';$('build-progress-text').textContent='正在建立工作…';$('build-log').textContent='';$('build-error').hidden=true;$('result-list').replaceChildren();$('result-directory').textContent=$('output-directory').value.trim()||defaultDirectory();
 try{const result=await post('/api/build',{recipe:recipe(),output_directory:$('output-directory').value.trim()||defaultDirectory(),overwrite:$('allow-overwrite').checked});state.job=result.job_id;pollJob(result.job_id);$('results-panel').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}catch(error){state.busy=false;renderRecipe();$('build-state').textContent='未完成';$('build-state').classList.add('is-error');$('build-error').textContent=error.message;$('build-error').hidden=false;throw error;}
}
async function pollJob(id){
 try{const job=await api(`/api/jobs/${encodeURIComponent(id)}`);if(state.job!==id)return;
  const progress=clamp(Number(job.progress)||0,0,1);$('build-progress').style.width=`${progress*100}%`;$('build-log').textContent=(job.log||[]).join('\n');$('result-directory').textContent=job.output_directory||'';
  const labels={queued:'排程中',running:'產生中',complete:'已完成',error:'未完成'};$('build-state').textContent=labels[job.status]||job.status;$('build-progress-text').textContent=`${Math.round(progress*100)}% · ${(job.log||[]).at(-1)||'等待處理'}`;
  if(job.status==='complete'||job.status==='error'){state.busy=false;renderRecipe();$('build-state').classList.toggle('is-ready',job.status==='complete');$('build-state').classList.toggle('is-error',job.status==='error');if(job.status==='error'){$('build-error').textContent=job.error||'素材處理未完成，請查看工作紀錄。';$('build-error').hidden=false;notice('素材處理未完成，請查看下方原因。','error');}else{renderResults(job.outputs||[]);notice(`已完成 ${job.outputs?.length||0} 個產物`,'success');}return;}
  state.pollTimer=setTimeout(()=>pollJob(id),650);
 }catch(error){state.busy=false;renderRecipe();$('build-error').textContent=error.message;$('build-error').hidden=false;$('build-state').textContent='連線中斷';$('build-state').classList.add('is-error');}
}
function renderResults(outputs){
 const list=$('result-list');list.replaceChildren();for(const output of outputs){const card=node('article','result-item'),preview=node('div','result-preview'),file=output.file||output.path?.split(/[\\/]/).at(-1)||'產物',url=output.url||`/api/file?job_id=${encodeURIComponent(state.job)}&file=${encodeURIComponent(file)}`;
  if(/\.(?:webp|png|jpg|jpeg)$/i.test(file)){const img=document.createElement('img');img.src=url;img.alt=file;img.loading='lazy';preview.append(img);}else if(/\.(?:mp4|webm)$/i.test(file)){const movie=document.createElement('video');movie.src=url;movie.controls=true;movie.muted=true;movie.playsInline=true;movie.preload='metadata';preview.append(movie);}else preview.textContent='{}';
  const content=node('div','result-content');content.append(node('strong',null,file));const links=node('div','result-links'),open=node('a',null,'開啟'),download=node('a',null,'下載');open.href=url;open.target='_blank';open.rel='noopener';download.href=url;download.download=file;links.append(open,download);content.append(links);card.append(preview,content);list.append(card);
 }
}
function exportRecipe(){const blob=new Blob([JSON.stringify(recipe(),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${$('character-id').value.trim()||'character'}-recipe.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

$('pick-files').addEventListener('click',()=>$('source-files').click());$('drop-zone').addEventListener('click',()=>$('source-files').click());$('drop-zone').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$('source-files').click();}});$('source-files').addEventListener('change',()=>perform(()=>uploadFiles([...$('source-files').files])));
for(const name of ['dragenter','dragover'])$('drop-zone').addEventListener(name,event=>{event.preventDefault();$('drop-zone').classList.add('is-dragging')});for(const name of ['dragleave','drop'])$('drop-zone').addEventListener(name,event=>{event.preventDefault();$('drop-zone').classList.remove('is-dragging')});$('drop-zone').addEventListener('drop',event=>perform(()=>uploadFiles([...event.dataTransfer.files])));
$('path-form').addEventListener('submit',event=>{event.preventDefault();perform(()=>readPath($('source-path').value))});$('import-recipe').addEventListener('click',()=>$('recipe-file').click());$('recipe-file').addEventListener('change',()=>perform(async()=>{const file=$('recipe-file').files[0];if(file)await loadRecipe(JSON.parse(await file.text()));$('recipe-file').value='';}));$('load-example').addEventListener('click',()=>perform(async()=>loadRecipe(await api('/api/recipe/yeseul'))));$('export-recipe').addEventListener('click',()=>perform(exportRecipe));
$('play-toggle').addEventListener('click',()=>perform(async()=>{if(!state.source)return;if(video.paused){const range=currentRange();if(video.currentTime<range.start||video.currentTime>=range.end-.02)seek(range.start);await video.play();}else video.pause();}));$('mute-toggle').addEventListener('click',()=>{video.muted=!video.muted;$('mute-toggle').textContent=video.muted?'靜音':'有聲';});$('timeline').addEventListener('input',()=>seek(numeric('timeline')));
video.addEventListener('loadedmetadata',()=>{if(state.pendingSeek!==null){video.currentTime=state.pendingSeek;state.pendingSeek=null;}resizeOverlay();updateTransport()});video.addEventListener('loadeddata',drawOutput);video.addEventListener('seeked',()=>{drawOutput();updateTransport()});video.addEventListener('timeupdate',()=>{const range=currentRange();if(!video.paused&&video.currentTime>=range.end-.015){if($('loop-selection').checked)video.currentTime=range.start;else video.pause();}updateTransport();drawOutput()});video.addEventListener('play',()=>{stopFrameLoop();frameLoop();updateTransport()});video.addEventListener('pause',()=>{stopFrameLoop();updateTransport()});video.addEventListener('ended',()=>{if($('loop-selection').checked&&state.source){seek(currentRange().start);video.play().catch(()=>{});}});video.addEventListener('error',()=>{if(state.source)notice('預覽暫時無法播放，請重新讀取來源影片。','error')});
$('set-start').addEventListener('click',()=>{$('trim-start').value=rounded(video.currentTime);normalizeRange()});$('set-end').addEventListener('click',()=>{$('trim-end').value=rounded(video.currentTime);normalizeRange()});for(const id of ['trim-start','trim-end'])$(id).addEventListener('change',normalizeRange);
$('crop-enabled').addEventListener('change',()=>{drawOverlay();drawOutput();updateSummary()});$('crop-full').addEventListener('click',()=>{if(!state.source)return;$('crop-enabled').checked=false;setCrop({x:0,y:0,width:state.source.width,height:state.source.height})});$('crop-square').addEventListener('click',()=>{if(!state.source)return;const size=Math.min(state.source.width,state.source.height);$('crop-enabled').checked=true;setCrop({x:(state.source.width-size)/2,y:(state.source.height-size)/2,width:size,height:size})});for(const id of ['crop-x','crop-y','crop-width','crop-height'])$(id).addEventListener('change',()=>{$('crop-enabled').checked=true;setCrop({x:numeric('crop-x'),y:numeric('crop-y'),width:numeric('crop-width'),height:numeric('crop-height')})});
overlay.addEventListener('pointerdown',startCrop);overlay.addEventListener('pointermove',moveCrop);overlay.addEventListener('pointerup',endCrop);overlay.addEventListener('pointercancel',endCrop);new ResizeObserver(resizeOverlay).observe($('video-stage'));
for(const id of ['output-preset','symbol-tier','atlas-fps','atlas-tile','fit-mode'])$(id).addEventListener('change',updatePreset);$('add-preset').addEventListener('click',()=>perform(addPreset));$('update-output').addEventListener('click',()=>perform(updateSelected));$('cancel-output-edit').addEventListener('click',()=>{state.selectedOutput=null;$('selected-output').hidden=true;renderQueue();drawOutput()});$('clear-queue').addEventListener('click',()=>{state.outputs=[];state.selectedOutput=null;$('selected-output').hidden=true;renderQueue()});
let lastAutoDirectory='';$('character-id').addEventListener('input',()=>{const current=$('output-directory').value;if(!current||current===lastAutoDirectory){lastAutoDirectory=defaultDirectory();$('output-directory').value=lastAutoDirectory;}renderRecipe()});for(const id of ['character-name','output-directory','preserve-originals'])$(id).addEventListener('input',renderRecipe);$('validate-recipe').addEventListener('click',()=>perform(validate));$('build-recipe').addEventListener('click',()=>perform(build));$('copy-output-path').addEventListener('click',()=>perform(async()=>{const path=$('result-directory').textContent;if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(path);else{const area=document.createElement('textarea');area.value=path;document.body.append(area);area.select();document.execCommand('copy');area.remove();}notice('已複製輸出資料夾路徑','success')}));
sourceControls(false);renderSources();renderQueue();resizeOverlay();
async function initialize(){try{state.info=await api('/api/info');$('service-status').textContent=state.info.ffmpeg_ready?'本機服務已就緒':'轉檔工具未就緒';$('service-status').classList.add(state.info.ffmpeg_ready?'is-ready':'is-error');lastAutoDirectory=defaultDirectory();$('output-directory').value=lastAutoDirectory;renderRecipe();}catch(error){$('service-status').textContent='服務連線中斷';$('service-status').classList.add('is-error');notice(error.message,'error',9000);}}
initialize();

