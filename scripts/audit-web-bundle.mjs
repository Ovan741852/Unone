#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {checkedRoot, inside, json, verifiedExport} from './web-export-files.mjs';
// The core SDK installs its official Web modules under templates/web. The
// engine checkout and AI package install that same module tree under web.
const shared = new URL(fs.existsSync(new URL('../sdk.json', import.meta.url))
  ? '../templates/web/shared/' : '../web/shared/', import.meta.url);
const {createAssetCatalog, validateImagePreloadPlan, inspectAuthoredImageDimensions, imageDimensionsPrefixLimit}
  = await import(new URL('asset-encoding.js', shared));
const {payloadDataSources} = await import(new URL('load-project.js', shared));

const schema = 'unone.web-bundle-audit.v1';
const usage = `node scripts/audit-web-bundle.mjs --export <finished Web export> [--out <fresh report.json>]
  [--hold <image group>]... [--baseline <previous audit.json>] [--near-ratio <0..1>]
  [--max-logical-bytes N] [--max-eager-data-bytes N] [--max-eager-font-bytes N] [--max-image-rgba-bytes N]
  [--max-duplicate-bytes N] [--fail-on <finding code>]...
Verifies both published copies. JSON reports sealed bytes, file identities, staged data and
estimated group RGBA. --hold adds simultaneous groups to startup. Gates exit 1 and retain
the report; invalid input exits 2. Without --out the complete report goes to stdout.`;
const unique = values => [...new Set(values)];
const sum = values => values.reduce((a,b) => a+b, 0);
const bytesOf = records => sum(records.map(r => r.bytes));
const advisories = {
  GENERATION_NAME_MISMATCH:'Reseal this immutable release before using its directory name as the content identity.',
  ALIAS_SEPARATE_FILES:'Check whether deployment needs both paths and whether the storage layer can share their bytes.',
  DUPLICATE_CONTENT_URLS:'Trace both URLs before consolidating identical content.',
  ASSET_IDS_SHARE_SOURCE:'Inspect per-ID decode and group reservations for the shared source.',
  IMAGE_HEADER_INSPECTION:'Measure header requests on the target server and consider declaring verified raster dimensions.',
  IMAGE_COLD_DIMENSIONS_UNKNOWN:'Verify cold preload admission for these IDs before depending on group readiness.',
  IMAGE_GROUP_LIMIT_NEAR:'Check this selected group lifetime against the declared byte and entry limits.',
  IMAGE_GROUP_LIMIT_EXCEEDED:'Reduce the simultaneous image set or review the declared budget.',
  CATALOG_GROUP_COUNT_NEAR:'Check available group slots before adding more named image groups.',
};

function collect(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function physicalInventory(player) {
  const identities = new Map(), byName = new Map();
  let unknown = 0;
  for (const {path:name} of [...player.manifest.files, {path:'export.json'}]) {
    const stat = fs.statSync(path.join(player.root,name), {bigint:true});
    if (stat.ino === 0n) { unknown++; continue; }
    const key = stat.dev + ':' + stat.ino;
    byName.set(name, key);
    if (!identities.has(key)) identities.set(key, {bytes:Number(stat.size), links:stat.nlink, names:0});
    identities.get(key).names++;
  }
  let hardlinkedPairs = 0, separatePairs = 0, separateBytes = 0;
  for (const [name, record] of player.logical) {
    const alias = byName.get(name), release = byName.get(player.manifest.release_root + name);
    if (alias === undefined || release === undefined) continue;
    if (alias === release) hardlinkedPairs++;
    else { separatePairs++; separateBytes += record.bytes; }
  }
  const files = [...identities.values()];
  return {hardlinked_alias_pairs:hardlinkedPairs, separate_alias_pairs:separatePairs, separate_alias_bytes:separateBytes,
    unknown_identity_paths:unknown, distinct_file_objects:unknown ? null : files.length,
    distinct_file_object_bytes:unknown ? null : bytesOf(files),
    file_objects_linked_outside_export:files.filter(file => file.links > BigInt(file.names)).length};
}

function imageHeader(file) {
  const fd = fs.openSync(file.source, 'r');
  try {
    const prefix = Buffer.alloc(Math.min(imageDimensionsPrefixLimit, file.bytes));
    const length = fs.readSync(fd, prefix, 0, prefix.length, 0);
    return inspectAuthoredImageDimensions(prefix.subarray(0,length));
  } finally { fs.closeSync(fd); }
}

export function audit(directory, {hold = [], nearRatio = .9} = {}) {
  if (!(nearRatio > 0 && nearRatio <= 1)) throw Error('near-ratio must be greater than zero and at most one');
  const player = verifiedExport(directory, {allowCustomRenderer:true});
  const {logical, manifest} = player;
  function record(name) {
    const value = logical.get(name);
    if (!value) throw Error('Missing logical file: ' + name);
    return value;
  }
  const read = name => json(record(name).source);
  const payload = read('content/project.json'), catalog = read('content/assets.json');
  const assets = new Map(catalog.assets.map(asset => [asset.id, asset]));
  if (assets.size !== catalog.assets.length) throw Error('Duplicate catalog asset ID');
  const plan = logical.has('content/image-assets.json') ?
    validateImagePreloadPlan(read('content/image-assets.json'), createAssetCatalog(catalog)) : null;
  const groups = plan?.groups ?? {};
  for (const name of hold) if (!Object.hasOwn(groups, name)) throw Error('Unknown --hold group: ' + name);
  const findings = [];
  const finding = (code, subject, evidence) => findings.push({code, severity:'advisory', subject, evidence, guidance:advisories[code]});
  if (!player.generation_matches) finding('GENERATION_NAME_MISMATCH', manifest.release_root, {manifest_hashes_verified:true});
  const disk = physicalInventory(player);
  if (disk.separate_alias_pairs) finding('ALIAS_SEPARATE_FILES', 'export', {pairs:disk.separate_alias_pairs, bytes:disk.separate_alias_bytes});

  const digests = new Map(), sources = new Map(), bundles = new Map(), kinds = new Map();
  for (const [name, file] of logical) collect(digests, file.sha256, name);
  for (const a of assets.values()) {
    const name = 'content/' + a.source;
    collect(sources, name, a.id);
    const bundle = a.bundle ?? '(unassigned)';
    if (!bundles.has(bundle)) bundles.set(bundle,{name:bundle,entries:0,files:new Set()});
    const entry = bundles.get(bundle);
    entry.entries++;
    for (const source of unique([a.source,...(a.files ?? [])])) {
      const url = 'content/' + source;
      record(url);
      collect(kinds, url, a.kind);
      entry.files.add(url);
    }
  }
  const duplicates = [...digests].filter(([,paths]) => paths.length>1).map(([sha256, paths]) => ({
    sha256, paths, repeated_bytes:(paths.length-1)*record(paths[0]).bytes,
  })).sort((a,b) => b.repeated_bytes-a.repeated_bytes);
  const duplicateBytes = sum(duplicates.map(d => d.repeated_bytes));
  if (duplicates.length) finding('DUPLICATE_CONTENT_URLS','logical generation',{sets:duplicates.length, repeated_bytes:duplicateBytes});
  const sameSources = [...sources].filter(([,ids]) => ids.length>1).map(([source, ids]) => ({source,ids}));
  if (sameSources.length) finding('ASSET_IDS_SHARE_SOURCE','catalog',{paths:sameSources.length});

  const staged = payloadDataSources(payload).map(s => ({...s, bytes:record('content/'+s.source).bytes}));
  const fileSummary = names => bytesOf(unique(names).map(record));
  const lazy = (payload.data_assets ?? []).filter(a => a.on_demand===true).map(a => ({id:a.id,source:a.source,bytes:record('content/'+a.source).bytes}));
  const dataUrls = unique(staged.map(a => 'content/'+a.source));
  const presentation = logical.has('content/presentation.json') ? read('content/presentation.json') : {};
  const ui = presentation.ui ?? {};
  const fontSources = new Map();
  if (ui.font_source) collect(fontSources,ui.font_source,false);
  for (const face of (ui.fonts ?? [])) collect(fontSources,face.source,face.on_demand===true);
  const fonts = [...fontSources].map(([source,deferred])=>({source,bytes:record('content/'+source).bytes,on_demand:deferred.every(Boolean)}));
  const fontUrls = new Set(fonts.map(f=>'content/'+f.source));
  const bytecodeUrls = new Set([payload.script_bytecode,payload.script_module_bytecode].filter(Boolean).map(b=>'content/'+b.source));
  const categories = new Map();
  for (const [name,file] of logical) {
    const entryKinds = unique(kinds.get(name)??[]);
    let category;
    if (bytecodeUrls.has(name)) category='bytecode';
    else if (fontUrls.has(name)) category='ui_font';
    else if (entryKinds.length) category=entryKinds.length===1?'asset:'+entryKinds[0]:'shared_asset_file';
    else category=name.startsWith('runtime/')?'runtime':name.startsWith('web/')?'web_host':name.startsWith('content/')?'content_metadata_or_other':'other';
    collect(categories,category,file);
  }
  const scene = payload.scene ?? {}, entities = Object.values(scene.entities ?? {});
  const sceneIds = unique([...entities.map(e => e?.sprite?.asset),
    ...Object.values(scene.particle_effects ?? {}).flatMap(e => (e.emitters ?? []).map(v => v.texture))].filter(id => typeof id==='string' && id));
  const hidden = unique(entities.filter(e => e.sprite?.visible===false).map(e => e.sprite.asset).filter(Boolean));
  const images = new Map(), headers = new Map(), needInspection = [], coldUnknown = [];
  for (const id of unique([...Object.values(groups).flat(), ...sceneIds])) {
    const asset = assets.get(id);
    if (!asset || asset.kind!=='texture2d') throw Error('Unknown image dependency: '+id);
    const name = 'content/'+asset.source, file = record(name);
    let dimensions = plan?.dimensions?.[id];
    if (!dimensions) {
      if (!headers.has(name)) headers.set(name, imageHeader(file));
      dimensions = headers.get(name);
      (dimensions ? needInspection : coldUnknown).push(id);
    }
    images.set(id,{source:name, bytes:file.bytes, rgba:dimensions ? dimensions.width*dimensions.height*4 : null});
  }
  if (needInspection.length) finding('IMAGE_HEADER_INSPECTION','image preparation',{ids:needInspection});
  if (coldUnknown.length) finding('IMAGE_COLD_DIMENSIONS_UNKNOWN','image preparation',{ids:coldUnknown});
  function imageSet(ids) {
    const selected = unique(ids), members=selected.map(id => images.get(id));
    return {entries:selected.length, unique_urls:unique(members.map(m => m.source)).length,
      encoded_url_bytes:fileSummary(members.map(m => m.source)), known_rgba_bytes:sum(members.map(m => m.rgba ?? 0)),
      unknown_rgba_ids:selected.filter(id => images.get(id).rgba===null)};
  }
  const startup = plan?.startup ?? [], selected = unique([...startup,...hold]);
  const selection = imageSet(selected.flatMap(g => groups[g]));
  function checkBudget(subject, set) {
    if (!plan) return;
    const ratios = {bytes:set.known_rgba_bytes/plan.budget.max_bytes, entries:set.entries/plan.budget.max_entries};
    const usage = Math.max(ratios.bytes,ratios.entries);
    if (usage>=nearRatio) finding(usage>1?'IMAGE_GROUP_LIMIT_EXCEEDED':'IMAGE_GROUP_LIMIT_NEAR',subject,ratios);
  }
  const imageGroups = Object.entries(groups).map(([name,ids]) => {
    const estimate = imageSet(ids);
    checkBudget('group:'+name, estimate);
    return {name,...estimate};
  });
  checkBudget('selected groups', selection);
  if (imageGroups.length/128>=nearRatio) finding('CATALOG_GROUP_COUNT_NEAR','image plan',{groups:imageGroups.length,limit:128});
  const total = bytesOf([...logical.values()]), metrics = {logical_bytes:total, eager_data_bytes:fileSummary(dataUrls), eager_font_bytes:bytesOf(fonts.filter(f=>!f.on_demand)),
    image_rgba_bytes:selection.known_rgba_bytes, duplicate_bytes:duplicateBytes};
  return {schema, export:{project:manifest.project, variant:manifest.variant, renderer:manifest.renderer_mode,
    release_root:manifest.release_root, generation_matches:player.generation_matches, manifest_sha256:player.manifest_sha256},
    scope:'Static sealed file bytes and authored resource estimates. Browser transfer, runtime use, GPU memory and filesystem allocation require measurement.',
    metrics, inventory:{logical_files:logical.size, alias_bytes:total, generation_bytes:total, indexed_bytes:manifest.total_bytes,
      index_bytes:manifest.files.find(f=>f.path==='index.html').bytes, manifest_bytes:fs.statSync(path.join(player.root,'export.json')).size, ...disk},
    logical_breakdown:[...categories].map(([kind,files])=>({kind,files:files.length,bytes:bytesOf(files)})),
    largest_files:[...logical.values()].sort((a,b)=>b.bytes-a.bytes).slice(0,25).map(({path,bytes})=>({path,bytes})),
    asset_catalog:{entries:assets.size, bundles:[...bundles.values()].map(({name,entries,files}) => ({name,entries,unique_sources:files.size,source_bytes:fileSummary([...files])})),
      shared_source_ids:sameSources}, duplicate_content:duplicates,
    payload:{project_json_bytes:record('content/project.json').bytes, asset_manifest_bytes:record('content/assets.json').bytes,
      image_plan_bytes:logical.get('content/image-assets.json')?.bytes ?? 0, staged, on_demand:lazy, ui_font_sources:fonts},
    images:{groups:imageGroups, max_group_count:128, startup, selected, budget:plan?.budget ?? null, selected_union:selection,
      hidden_sprite_asset_ids:hidden, scene_dependencies:imageSet(sceneIds), scene_plus_startup:imageSet([...sceneIds,...startup.flatMap(g=>groups[g])])},
    findings};
}

const limitFlags = {'max-logical-bytes':'logical_bytes','max-eager-data-bytes':'eager_data_bytes','max-eager-font-bytes':'eager_font_bytes','max-image-rgba-bytes':'image_rgba_bytes','max-duplicate-bytes':'duplicate_bytes'};
export function main(args=process.argv.slice(2)) {
  const options=Object.fromEntries(['export','out','baseline','near-ratio',...Object.keys(limitFlags)].map(key=>[key,{type:'string'}]));
  const {values}=parseArgs({args,options:{...options,hold:{type:'string',multiple:true},'fail-on':{type:'string',multiple:true},help:{type:'boolean',short:'h'}}});
  if (values.help) {console.log(usage);return 0;}
  if (!values.export) throw Error('Missing --export\n'+usage);
  const root=checkedRoot(values.export);
  let output;
  if (values.out) {
    output=path.join(checkedRoot(path.dirname(path.resolve(values.out))),path.basename(values.out));
    if (inside(root,output)||fs.existsSync(output)) throw Error('Choose a fresh output path outside the export');
  }
  const chosen=values['fail-on']??[];
  for (const code of chosen) if (!Object.hasOwn(advisories,code)) throw Error('Unknown --fail-on code: '+code);
  const report=audit(root,{hold:values.hold,nearRatio:Number(values['near-ratio']??.9)});
  if (values.baseline) {
    const baseline=json(checkedRoot(values.baseline));
    if (baseline.schema!==schema||!Object.keys(report.metrics).every(k=>Number.isSafeInteger(baseline.metrics?.[k]))) throw Error('Invalid baseline bundle audit');
    report.comparison={baseline_release:baseline.export.release_root, baseline_selected:baseline.images.selected,
      delta:Object.fromEntries(Object.entries(report.metrics).map(([k,v])=>[k,v-baseline.metrics[k]]))};
  }
  const failures=[];
  for (const [flag,metric] of Object.entries(limitFlags)) if (values[flag]!==undefined) {
    const max=Number(values[flag]);
    if (!/^(0|[1-9]\d*)$/.test(values[flag])||!Number.isSafeInteger(max)) throw Error('Invalid --'+flag);
    if (report.metrics[metric]>max) failures.push({metric,max,actual:report.metrics[metric]});
    if (metric==='image_rgba_bytes' && report.images.selected_union.unknown_rgba_ids.length) failures.push({metric,reason:'unknown selected image dimensions'});
  }
  for (const finding of report.findings) if (chosen.includes(finding.code)) failures.push({code:finding.code,subject:finding.subject});
  report.gates={passed:!failures.length,failures};
  const body=JSON.stringify(report,null,2)+'\n';
  if (output) fs.writeFileSync(output,body,{flag:'wx'}); else process.stdout.write(body);
  return failures.length ? 1 : 0;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {process.exitCode=main();} catch(error) {console.error(error.message);process.exitCode=2;}
}
