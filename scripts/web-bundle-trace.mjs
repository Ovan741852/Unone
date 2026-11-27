// This factory also runs directly in the measured browser via CDP or Playwright.
// Keep its dependencies inside the function so it can run against an unchanged export.
export function createBundleTrace(options = {}, host = globalThis) {
  const clock = host.performance;
  const now = () => clock.now();
  const started = now(), phases = [], findings = [], lastGroups = new Map(), timings = new Map();
  const requests = new Map(), groupErrors = new Set(), dropped = {group_events:0, loads:0, resources:0};
  const groupEvents = [], loads = [], resources = [], limit = 20000;
  let phase, observer, stopped = false, previousCounts, previousLoads, session, catalog;
  let hasGroupSnapshot = false;
  let previousStreams = new Set();
  const methods = {groups:false, load_timings:false, visible_queue:false, submissions:false, resource_timing:false};
  let hadResourceObserver = false, bufferMissed = 0, lostLoads = 0;
  const expected = options.expect_released ?? [];
  const queueBudget = options.max_visible_queue_ms ?? null;
  if (options.max_visible_queue_ms !== undefined && (!Number.isFinite(queueBudget) || queueBudget < 0 || queueBudget > 600000))
    throw RangeError('BUNDLE_VISIBLE_QUEUE_BUDGET_INVALID: expected 0..600000 milliseconds');
  let unsupportedQueue = false, invalidQueueRows = 0;
  const overBudgetIds = [];
  const push = (array, key, row) => { if (array.length < limit) array.push(row); else dropped[key]++; };
  const warn = (code, evidence, severity = 'warning') => findings.push({code, severity, ...evidence});
  function groupChanges(asset, at) {
    hasGroupSnapshot = asset?.available === true && Array.isArray(asset.groups);
    if (!hasGroupSnapshot) return;
    methods.groups = true;
    const streams = asset.streams ?? [];
    const currentStreams = new Set(streams.map(s=>s.name));
    const released = [];
    for (const id of previousStreams) if (!currentStreams.has(id)) {
      const g=host.unonePlayerAssets.status(id);
      released.push(g);
    }
    previousStreams = currentStreams;
    for (const g of [...asset.groups,...streams,...released]) {
      const prev = lastGroups.get(g.name);
      const next = {state:g.state, mode:g.mode, held:g.held, ready:g.ready, total:g.total};
      lastGroups.set(g.name, next);
      if ((!prev && g.state === 'idle') || (prev && prev.state === g.state && prev.mode === g.mode &&
          prev.held === g.held && prev.ready === g.ready)) continue;
      push(groupEvents, 'group_events', {at_ms:at, phase:phase.index, group:g.name, previous:prev ?? null,
        ...next, reserved_bytes_estimate:g.reserved_bytes_estimate, error:g.error ?? null});
      if (g.state === 'error' && !groupErrors.has(g.name)) {
        warn('BUNDLE_GROUP_ERROR', {group:g.name, phase:phase.index, error:g.error ?? null});
        groupErrors.add(g.name);
      } else if (g.state !== 'error') groupErrors.delete(g.name);
    }
  }
  function loadTimings(asset) {
    const t = asset?.loading;
    if (!Array.isArray(t?.recent) || ![t.completed,t.failed,t.cancelled].every(Number.isFinite)) return;
    methods.load_timings = true;
    const canMeasureQueue = t.visible_queue_supported === true;
    if (canMeasureQueue) methods.visible_queue = true;
    else unsupportedQueue = true;
    const n = t.completed + t.failed + t.cancelled;
    if (previousLoads !== undefined && n >= previousLoads) {
      const delta = n - previousLoads;
      if (delta > t.recent.length) lostLoads += delta - t.recent.length;
      for (const r of t.recent.slice(t.recent.length - Math.min(delta,t.recent.length))) {
        const entry = {...r,phase:phaseAt(r.completed_at_ms)};
        push(loads, 'loads', entry);
        if (canMeasureQueue && entry.phase >= 0 && r.visible_queue_ms !== null) {
          const wait = r.visible_queue_ms, q = phases[entry.phase].visible_queue;
          if (!Number.isFinite(wait) || wait < 0 || typeof r.id !== 'string') invalidQueueRows++;
          else {
            q.samples++;
            if (q.worst_ms === null || wait > q.worst_ms) {q.worst_ms = wait; q.worst_id = r.id;}
            if (queueBudget !== null && wait > queueBudget) {
              q.over_budget_loads++;
              overBudgetIds[entry.phase].add(r.id);
            }
          }
        }
        if (r.state !== 'ready' || !Number.isFinite(r.decode_ms)) continue;
        const key=JSON.stringify([catalog,r.id]), prior=timings.get(key);
        if (prior) { prior.count++; prior.last_phase = entry.phase; }
        else timings.set(key, {id:r.id,catalog_generation:catalog,count:1,first_phase:entry.phase,last_phase:entry.phase});
      }
    }
    previousLoads = n;
  }
  function sample() {
    if (stopped) return;
    const at = now();
    let asset;
    try {asset = host.unonePlayerAssets?.snapshot({includeTimings:true});}
    catch {asset = host.unonePlayerAssets?.status?.();}
    const perf = host.unonePlayerPerformance?.snapshot();
    if (asset && catalog !== undefined && asset.catalog_generation !== catalog) {
      warn('BUNDLE_CATALOG_CHANGED', {phase:phase.index}); previousLoads=undefined; lastGroups.clear(); groupErrors.clear(); previousStreams.clear();
    }
    if (asset) catalog = asset.catalog_generation;
    groupChanges(asset, at);
    loadTimings(asset);
    if (!perf?.skip_counts) return;
    methods.submissions = true;
    const counters = {...perf.skip_counts};
    if (Number.isFinite(perf.error_draws)) counters.error_draws = perf.error_draws;
    if (previousCounts && session === perf.session) for (const [key,value] of Object.entries(counters)) {
      const delta = value - (previousCounts[key] ?? 0);
      if (Number.isFinite(delta) && delta > 0) phase.draws[key] = (phase.draws[key] ?? 0) + delta;
    }
    previousCounts = counters; session = perf.session;
  }
  function phaseAt(t) {
    // Resource notifications can finish long after their request's phase.
    let lo=0, hi=phases.length;
    while (lo<hi) {const mid=(lo+hi)>>>1;if (phases[mid].start_ms<=t) lo=mid+1;else hi=mid;}
    return lo-1;
  }
  function receive(entries) {
    for (const e of entries) {
      if (e.responseEnd < started) continue;
      let url; try {url=new URL(e.name,host.location.href);} catch {continue;}
      if (!['http:','https:'].includes(url.protocol) ||
          !['img','image'].includes(e.initiatorType) && !/\.(png|jpe?g|webp|avif|svg|gif|ktx2|basis)$/i.test(url.pathname)) continue;
      // Keep full identity private: signed query parameters must neither leave the page nor merge different URLs.
      const name = url.origin === host.location.origin ? url.pathname : url.origin + url.pathname;
      const from = phaseAt(e.startTime), to = phaseAt(e.responseEnd);
      const row = {url:name, start_ms:e.startTime, end_ms:e.responseEnd, start_phase:from, end_phase:to,
        transfer_bytes:e.transferSize, encoded_body_bytes:e.encodedBodySize};
      push(resources, 'resources', row);
      if (!(e.transferSize > 0) || from < 0) continue;
      const prior = requests.get(e.name);
      if (prior) {prior.count++; prior.last_phase=from; prior.transfer_bytes+=e.transferSize;}
      else requests.set(e.name,{url:name,count:1,transfer_bytes:e.transferSize,first_phase:from,last_phase:from});
    }
  }
  function mark(label) {
    if (stopped) throw Error('BUNDLE_TRACE_CLOSED');
    if (phase) {sample(); phase.end_ms=now();}
    phase={index:phases.length,label,start_ms:phase?.end_ms ?? started,end_ms:null,draws:{},
      visible_queue:{samples:0,worst_ms:null,worst_id:null,over_budget_loads:queueBudget===null?null:0}};
    phases.push(phase);
    if (queueBudget !== null) overBudgetIds.push(new Set());
  }
  mark('baseline'); sample();
  if (host.PerformanceObserver) {
    try {
      observer=new host.PerformanceObserver((list,_observer,info)=>{
        bufferMissed+=info?.droppedEntriesCount ?? 0; receive(list.getEntries());
      });
      observer.observe({type:'resource',buffered:true}); hadResourceObserver=true;
    } catch {observer?.disconnect();observer=null;}
  }
  const timer=host.setInterval(sample,options.sample_ms ?? 250);
  function finish() {
    if (stopped) throw Error('BUNDLE_TRACE_CLOSED');
    host.clearInterval(timer); sample(); phase.end_ms=now(); stopped=true;
    if (hadResourceObserver) {receive(observer.takeRecords());observer.disconnect();methods.resource_timing=true;}
    else if (typeof clock.getEntriesByType==='function') {
      receive(clock.getEntriesByType('resource'));methods.resource_timing=true;
    }
    for (const p of phases) {
      if (p.draws.ui_diagnostics) warn('BUNDLE_UI_DIAGNOSTIC_DRAWS',{phase:p.index,count:p.draws.ui_diagnostics});
      if (p.draws.error_draws) warn('BUNDLE_DRAW_ERROR',{phase:p.index,count:p.draws.error_draws});
      const q = p.visible_queue;
      q.over_budget_images = queueBudget === null || !methods.visible_queue ? null : overBudgetIds[p.index].size;
      if (!methods.visible_queue) q.over_budget_loads = null;
      if (q.over_budget_loads > 0) warn('BUNDLE_VISIBLE_QUEUE_BUDGET_EXCEEDED',
        {phase:p.index,budget_ms:queueBudget,...q},'error');
    }
    for (const r of timings.values()) if (r.count>1) warn('BUNDLE_REPEATED_IMAGE_DECODE',r);
    for (const r of requests.values()) if (r.count>1) warn('BUNDLE_REPEATED_NETWORK_TRANSFER',r);
    if (hasGroupSnapshot) for (const group of expected) {
      let g=lastGroups.get(group);
      if(!g){
        // A declared individual image can remain idle for the whole scenario.
        try{const row=host.unonePlayerAssets.status(group);if(row?.name===group)g=row;}catch{}
      }
      if (!g) warn('BUNDLE_EXPECTED_GROUP_UNKNOWN',{group},'error');
      else if (g.held>0 || !['idle','unloaded'].includes(g.state)) warn('BUNDLE_EXPECTED_RELEASE_MISSING',{group,...g},'error');
    }
    // The broker reports load timings even when the project has no image group plan.
    const assetTraceAvailable = expected.length ? hasGroupSnapshot : methods.groups || methods.load_timings;
    if (!assetTraceAvailable || !methods.submissions) warn('BUNDLE_TRACE_UNAVAILABLE',{methods},'error');
    if (queueBudget !== null && (!methods.visible_queue || unsupportedQueue))
      warn('BUNDLE_VISIBLE_QUEUE_UNAVAILABLE',{budget_ms:queueBudget},'error');
    if (queueBudget !== null && (lostLoads || invalidQueueRows))
      warn('BUNDLE_VISIBLE_QUEUE_INCOMPLETE',{missed_load_timings:lostLoads,invalid_queue_rows:invalidQueueRows},'error');
    if (lostLoads || bufferMissed || Object.values(dropped).some(Boolean))
      warn('BUNDLE_TRACE_INCOMPLETE',{missed_load_timings:lostLoads,missed_resource_entries:bufferMissed,dropped});
    return {schema:'unone.web-bundle-trace.v1',methods,phases,group_events:groupEvents,loads,resources,findings,
      final_held:[...lastGroups].filter(([,g])=>g.held>0).map(([name,g])=>({name,...g})),
      expected_released:expected,max_visible_queue_ms:queueBudget,ok:!findings.some(f=>f.severity==='error'),sample_ms:options.sample_ms ?? 250};
  }
  return {mark,finish};
}
