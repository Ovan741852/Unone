// prefetchRuntime: download + compile before Core, consumed by loadRuntime through Emscripten's instantiateWasm.
// Each case imports a fresh copy of runtime-core.mjs: its prefetch and runtime promises are per realm.
import test from 'node:test';
import assert from 'node:assert/strict';

const fresh=async()=>import('./runtime-core.mjs?case='+Math.random());
const URL_JS='https://player.invalid/runtime/unone-player.js',URL_WASM='https://player.invalid/runtime/unone_player.wasm';
function doc(){const head=[];return {head:{append:node=>head.push(node)},createElement:()=>({}),nodes:head};}

test('prefetch downloads and compiles the binary next to the runtime once, and hints the script',async()=>{
  const core=await fresh(),fetched=[],compiled=[],d=doc();
  const fetchImpl=(url,options)=>{fetched.push([url,options.credentials]);return Promise.resolve('response:'+url);};
  const compileStreaming=source=>{compiled.push(source);return Promise.resolve({module:'m'});};
  const first=core.prefetchRuntime(URL_JS,{fetchImpl,compileStreaming,doc:d});
  assert.equal(core.prefetchRuntime(URL_JS,{fetchImpl,compileStreaming,doc:d}),first,'a second call reuses the same compile');
  assert.equal(core.prefetchRuntime('https://other.invalid/r.js',{fetchImpl,compileStreaming,doc:d}),null,'one runtime URL per realm');
  assert.deepEqual(fetched,[[URL_WASM,'same-origin']]);assert.equal(compiled.length,1);assert.deepEqual(await first,{module:'m'});
  assert.deepEqual(d.nodes.map(n=>[n.rel,n.as,n.href]),[['preload','script',URL_JS]]);
});

test('without fetch or streaming compile there is no prefetch, and nothing throws',async()=>{
  const core=await fresh();
  assert.equal(core.prefetchRuntime(URL_JS,{fetchImpl:null,compileStreaming:()=>{},doc:doc()}),null);
  assert.equal(core.prefetchRuntime(URL_JS,{fetchImpl:()=>{},compileStreaming:null,doc:doc()}),null);
});

test('loadRuntime hands the prefetched module to the loader, and fetches the binary itself when the prefetch failed',async()=>{
  const realWebAssembly=globalThis.WebAssembly,realFetch=globalThis.fetch,realModule=globalThis.Module;
  try{
    for(const failing of [false,true]){
      const core=await fresh(),calls=[];
      globalThis.WebAssembly={...realWebAssembly,
        instantiate:async(module,imports)=>{calls.push(['instantiate',module,imports]);return {exports:{}};},
        instantiateStreaming:async(source,imports)=>{calls.push(['instantiateStreaming',await source,imports]);return {instance:{exports:{}},module:'streamed'};}};
      globalThis.fetch=async(url,options)=>'response:'+url+':'+options.credentials;
      core.prefetchRuntime(URL_JS,{fetchImpl:async()=>'r',compileStreaming:async()=>{if(failing)throw Error('compile-failed');return 'precompiled';},doc:doc()});
      // A fake Emscripten loader: asks instantiateWasm for an instance, then finishes initialising.
      const loaded=core.loadRuntime(URL_JS,()=>{});
      const Module=globalThis.Module;
      assert.equal(typeof Module.instantiateWasm,'undefined','a custom loader (tests, workers) keeps its own instantiation');
      // The browser path (no custom loader) is what installs the hook: exercise it directly on a second realm.
      const browser=await fresh();
      browser.prefetchRuntime(URL_JS,{fetchImpl:async()=>'r',compileStreaming:async()=>{if(failing)throw Error('compile-failed');return 'precompiled';},doc:doc()});
      const head=[];globalThis.document={createElement:()=>({}),head:{append:node=>head.push(node)}};
      const pending=browser.loadRuntime(URL_JS);
      const hook=globalThis.Module.instantiateWasm;assert.equal(typeof hook,'function','the prefetched compile is offered to the loader');
      const received=await new Promise(resolve=>{assert.deepEqual(hook({env:1},(instance,module)=>resolve({instance,module})),{});});
      assert.deepEqual(head.map(n=>n.src),[URL_JS],'the runtime script itself is still what loads the runtime');
      if(failing){assert.equal(calls[0][0],'instantiateStreaming');assert.equal(calls[0][1],'response:'+URL_WASM+':same-origin');assert.equal(received.module,'streamed');}
      else{assert.deepEqual(calls[0],['instantiate','precompiled',{env:1}]);assert.equal(received.module,'precompiled');}
      globalThis.Module.onRuntimeInitialized();await pending;Module.onRuntimeInitialized();await loaded;
      delete globalThis.document;
    }
  }finally{globalThis.WebAssembly=realWebAssembly;globalThis.fetch=realFetch;globalThis.Module=realModule;delete globalThis.document;}
});
