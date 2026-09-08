import {mountPanel} from './panel.js';
import {requestSchema} from './api.js';
const api=Object.freeze({async request(value){try{const response=await fetch('/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});if(!response.ok)throw new Error('Native transport HTTP '+response.status);return await response.json();}catch(error){return {ok:false,value:null,diagnostics:[{code:'NATIVE_UNAVAILABLE',explanation:error.message}],effects:[]};}}});
Object.defineProperty(window,'unoneDeveloper',{value:api});
const context=document.modelContext??navigator.modelContext;
if(context?.registerTool)await context.registerTool({name:'unone_developer_request',description:'Inspect or operate the connected native Unone game process. Call describe then tools.list. This is the same runtime shown in the native game window.',inputSchema:requestSchema,execute:async request=>JSON.stringify(await api.request(request))});
mountPanel(api);
