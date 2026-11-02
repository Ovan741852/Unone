// Exercise the real player's small consumer boundary, without emulating its VM,
// scheduler or renderer. Diagnostic-only failures must not escape that boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../player/main.js',import.meta.url),'utf8');
const start=source.indexOf('function publishPerformanceFeed(){'),end=source.indexOf('let orderedQueue=',start);
assert(start>=0&&end>start,'Player performance-feed consumer boundary missing');
const boundary=source.slice(start,end);
function consumer(feed,dataset){
 return vm.runInNewContext('let performanceFeed=feed;'+boundary+';({publish:publishPerformanceFeed,dispose:disposePerformanceFeed,active:()=>performanceFeed!==null})',
  {feed,document:{body:{dataset}}});
}
test('a failed publication and failed diagnostic error sink cannot escape into RAF handling',()=>{
 let reads=0,disposals=0,reports=0;
 const dataset={};Object.defineProperty(dataset,'playerCompletionFeedError',{set(){reports++;throw Error('DOM sink failed');}});
 const c=consumer({publish(){reads++;throw Error('snapshot failed');},dispose(){disposals++;throw Error('DOM deletion failed');}},dataset);
 assert.doesNotThrow(()=>c.publish());assert.equal(c.active(),false);
 assert.equal(reads,1);assert.equal(disposals,1);assert.equal(reports,2);
 assert.doesNotThrow(()=>c.publish());assert.doesNotThrow(()=>c.dispose());assert.equal(reads,1);assert.equal(disposals,1);
});
test('teardown releases the feed before deletion errors and leaves other cleanup runnable',()=>{
 let disposals=0,remainingCleanup=false;
 const dataset={},c=consumer({publish(){},dispose(){disposals++;throw Error('cannot delete report');}},dataset);
 assert.doesNotThrow(()=>{c.dispose();remainingCleanup=true;});
 assert.equal(remainingCleanup,true);assert.equal(c.active(),false);assert.equal(disposals,1);
 assert.equal(dataset.playerCompletionFeedError,'cannot delete report');c.dispose();assert.equal(disposals,1);
});
