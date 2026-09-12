// Presentation download policy for this game's model roster; no gameplay rules.
export async function mapDownloads(items,load,concurrency=4){
 const result=new Array(items.length);let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
  while(next<items.length){const index=next++;result[index]=await load(items[index],index);}
 }));return result;
}
export async function retryDownload(load,{attempts=3,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onRetry=()=>{}}={}){
 for(let attempt=1;attempt<=attempts;attempt++)try{return await load();}catch(error){
  const status=error.response?.status;
  const transient=[408,429,502,503,504].includes(status)||(error instanceof TypeError&&/fetch|network|load failed/i.test(error.message));
  if(!transient||attempt===attempts)throw error;
  onRetry({attempt,status:status??null});await wait(attempt*500);
 }
}
