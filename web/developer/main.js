import {createDeveloperAPI,requestSchema} from './api.js';
import {mountPanel} from './panel.js';

export function createDeveloper(){
  const messages=[],resources=[];
  const retain=(list,item)=>{list.push(item);if(list.length>200)list.shift();};
  const text=value=>{try{return (typeof value==='string'?value:JSON.stringify(value)).slice(0,4096);}catch{return String(value).slice(0,4096);}};
  for(const level of ['log','info','warn','error']){
    const original=console[level].bind(console);
    console[level]=(...args)=>{retain(messages,{level,message:args.map(text).join(' ').slice(0,8192),time_ms:performance.now()});original(...args);};
  }
  window.addEventListener('error',event=>retain(messages,{level:'error',message:event.message??'Resource failed: '+(event.target?.src??event.target?.href??'unknown'),source:event.filename??null,time_ms:performance.now()}),true);
  window.addEventListener('unhandledrejection',event=>retain(messages,{level:'error',message:text(event.reason),time_ms:performance.now()}));
  const observer=new PerformanceObserver(list=>{for(const r of list.getEntries())retain(resources,{url:r.name,initiator:r.initiatorType,duration_ms:r.duration,transfer_bytes:r.transferSize,encoded_bytes:r.encodedBodySize,decoded_bytes:r.decodedBodySize,status:Number.isFinite(r.responseStatus)&&r.responseStatus!==0?r.responseStatus:null});});
  observer.observe({type:'resource',buffered:true});
  return {connect(host){
    const api=createDeveloperAPI(host,{console:()=>messages,network:()=>resources,heap:()=>performance.memory?{used_bytes:performance.memory.usedJSHeapSize,total_bytes:performance.memory.totalJSHeapSize,limit_bytes:performance.memory.jsHeapSizeLimit}:null});
    Object.defineProperty(window,'unoneDeveloper',{value:api,configurable:false,writable:false});
    const context=document.modelContext??navigator.modelContext;
    if(context?.registerTool){Promise.resolve(context.registerTool({name:'unone_developer_request',description:'Inspect this running Unone development player or invoke its registered Lua test tools. Call describe for methods and tools.list for game tool IDs. Mutations affect this local game only.',inputSchema:requestSchema,execute:async request=>JSON.stringify(api.request(request))})).catch(error=>console.warn('WebMCP registration unavailable',error.message));}
    mountPanel(api);
  }};
}
