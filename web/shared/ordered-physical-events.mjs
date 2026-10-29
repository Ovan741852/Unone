const common=['sequence','received_us','origin','route','kind'];
const shapes={key:['code','location','state','repeat','is_composing','modifiers'],
 pointer:['pointer_id','pointer_type','phase','button','buttons','point?','modifiers'],
 wheel:['delta_x','delta_y','delta_z','unit','point','modifiers'],capture:['pointer_id','captured','source'],
 focus:['focused','scope'],reset:['scope','pointer_id?','reason'],viewport:['viewport']};
const fail=s=>{throw Error('INPUT_PHYSICAL_INVALID: '+s);};
export const safe=n=>Number.isSafeInteger(n)&&n>=0;
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e9;
function object(v,required,optional=[]){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>![...required,...optional].includes(k))||required.some(k=>!Object.hasOwn(v,k))||Object.values(v).some(n=>n===null))fail('closed object');
}
function viewport(v){
 object(v,['revision','width','height','rect_left','rect_top','css_width','css_height','device_pixel_ratio']);
 if(!safe(v.revision)||v.revision<1||![v.width,v.height].every(n=>Number.isInteger(n)&&n>0&&n<=32768)||
 ![v.rect_left,v.rect_top,v.css_width,v.css_height].every(finite)||v.css_width<=0||v.css_height<=0||!finite(v.device_pixel_ratio)||v.device_pixel_ratio<=0||v.device_pixel_ratio>16)fail('viewport');
}
function point(v){object(v,['x','y','inside','viewport']);if(!finite(v.x)||!finite(v.y)||typeof v.inside!=='boolean')fail('point');viewport(v.viewport);}
function modifiers(v){object(v,['shift','control','alt','meta'],['alt_graph','caps_lock','num_lock']);if(Object.values(v).some(x=>typeof x!=='boolean'))fail('modifiers');}
export function validatePhysicalEvent(e){
 const shape=shapes[e?.kind];if(!shape)fail('kind');object(e,[...common,...shape.filter(s=>!s.endsWith('?'))],shape.filter(s=>s.endsWith('?')).map(s=>s.slice(0,-1)));
 if(!safe(e.sequence)||e.sequence<1||!safe(e.received_us)||!['browser','host_synthetic','fixture'].includes(e.origin))fail('common');
 const control=['capture','focus','reset','viewport'].includes(e.kind);
 if(control?e.route!=='control':!['game','engine_ui','host_ui'].includes(e.route))fail('route');
 if(e.modifiers)modifiers(e.modifiers);
 if(e.kind==='key'&&(!(typeof e.code==='string'&&e.code.length>0&&new TextEncoder().encode(e.code).length<=128)||!Number.isInteger(e.location)||e.location<0||e.location>3||!['down','up'].includes(e.state)||typeof e.repeat!=='boolean'||typeof e.is_composing!=='boolean'))fail('key');
 if(e.pointer_id!==undefined&&!safe(e.pointer_id))fail('pointer id');
 if(e.kind==='pointer'){
  if(!['mouse','pen','touch'].includes(e.pointer_type)||!['down','up','move','cancel'].includes(e.phase)||!Number.isInteger(e.button)||e.button< -1||e.button>4||!Number.isInteger(e.buttons)||e.buttons<0||e.buttons>31)fail('pointer');
  if(e.point)point(e.point);else if(e.phase!=='cancel')fail('pointer position');
 }
 if(e.kind==='wheel'){if(![e.delta_x,e.delta_y,e.delta_z].every(finite)||!['pixel','line','page'].includes(e.unit))fail('wheel');point(e.point);}
 if(e.kind==='capture'&&(typeof e.captured!=='boolean'||!['got','lost'].includes(e.source)||e.captured!==(e.source==='got')))fail('capture');
 if(e.kind==='focus'&&(typeof e.focused!=='boolean'||!['game','window'].includes(e.scope)))fail('focus');
 if(e.kind==='reset'&&(!['all','pointer'].includes(e.scope)||(e.scope==='pointer')!==(e.pointer_id!==undefined)||!['blur','hidden','host_pause','focus_left_game','pointer_cancel','lost_capture','load'].includes(e.reason)))fail('reset');
 if(e.kind==='viewport')viewport(e.viewport);return e;
}
export function normalizeZeros(v){if(Array.isArray(v))return v.map(normalizeZeros);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,n])=>[k,normalizeZeros(n)]));return Object.is(v,-0)?0:v;}
