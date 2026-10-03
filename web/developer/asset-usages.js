// Source index is built once by the engine at export; live evidence comes from the published snapshot.
export function createAssetUsageReader(host){
  let loading=null;
  async function index(){
    if(!loading)loading=(async()=>{
      if(host.getAssetUsageIndex)return await host.getAssetUsageIndex();
      const response=await fetch(new URL('../../content/asset-usages.json',import.meta.url),{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error(`來源索引無法讀取（HTTP ${response.status}）；請重新匯出 development 版本。`);
      const text=await response.text();if(text.length>16*1024*1024)throw Error('來源索引超過 16 MiB，請縮小專案搜尋範圍。');
      return JSON.parse(text);
    })().then(value=>{
      if(value?.version!==1||!value.assets||!Array.isArray(value.references)||!Array.isArray(value.unresolved)||!Array.isArray(value.source_files)||!value.scope)throw Error('來源索引版本或格式不符，請重新匯出 development 版本。');
      return value;
    }).catch(error=>{loading=null;throw error;});
    return loading;
  }
  function live(snapshot,ids=null){
    const references=[];
    function walk(node,path='ui',parents=[]){
      if(!node)return;
      const ancestors=[...parents,node],owner=ancestors.findLast(value=>value.kind==='component');
      if(typeof node.asset==='string'&&(!ids||ids.has(node.asset)))references.push({asset:node.asset,node_id:node.id,kind:node.kind,ui_path:path,node_path:ancestors.map(value=>value.id),component_id:owner?.id??null,component:owner?.component??null});
      for(const [i,child] of (node.children??[]).entries())walk(child,`${path}.children[${i}]`,ancestors);
    }
    walk(snapshot?.world?.ui);
    const entities=snapshot?.world?.entities??[];
    for(const entity of Array.isArray(entities)?entities:Object.values(entities))for(const [component,value] of Object.entries(entity)){
      if(value&&typeof value.asset==='string'&&(!ids||ids.has(value.asset)))references.push({asset:value.asset,node_id:entity.id,kind:'entity',ui_path:`entities/${entity.id}/${component}/asset`,component_id:entity.id,component});
    }
    return references;
  }
  return {
    async assets(){
      let source,error;try{source=await index();}catch(e){error=e.message;}
      const current=live(host.getSnapshot()),assets=new Map(Object.entries(source?.assets??{}).map(([id,path])=>[id,{id,source:path,live_count:0}]));
      for(const reference of current){if(!assets.has(reference.asset))assets.set(reference.asset,{id:reference.asset,source:null,live_count:0});assets.get(reference.asset).live_count++;}
      return {assets:[...assets.values()].sort((a,b)=>a.id.localeCompare(b.id)),scope:source?.scope??null,source_error:error??null};
    },
    async usages(query){
      let source,error;try{source=await index();}catch(e){error=e.message;}
      const paths=new Set(Object.entries(source?.assets??{}).filter(([id,path])=>id===query||path===query).map(([,path])=>path));
      const ids=new Set(Object.entries(source?.assets??{}).filter(([id,path])=>id===query||paths.has(path)).map(([id])=>id));ids.add(query);
      const snapshot=host.getSnapshot(),references=(source?.references??[]).filter(row=>row.asset_ids.some(id=>ids.has(id))).map(row=>({...row,asset_ids:row.asset_ids.filter(id=>ids.has(id))}));
      return {query,declared:source?paths.size>0:null,asset_ids:[...ids],frame:snapshot?.world?.frame??null,live:live(snapshot,ids),references,unresolved:source?.unresolved??[],source_files:source?.source_files??[],project_root:source?.project_root??null,scope:source?.scope??null,source_error:error??null,note:'目前畫面＝已發布的節點；來源候選不代表必定執行。未解析動態位置是全專案線索，不是此資產的引用。零筆結果不代表可刪除。'};
    },
  };
}
