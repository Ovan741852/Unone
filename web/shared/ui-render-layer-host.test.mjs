import test from 'node:test';
import assert from 'node:assert/strict';
import {declareUiRenderLayerHost} from './ui-render-layer-host.mjs';
import {readFile} from 'node:fs/promises';

test('capability is host-owned, including restart and untrusted content',async()=>{
 const project={ui_render_layer_host:'full_resolution'};
 assert.equal(declareUiRenderLayerHost(project,false),project);
 assert(!('ui_render_layer_host' in project));
 declareUiRenderLayerHost(project,true);assert.equal(project.ui_render_layer_host,'full_resolution');
 declareUiRenderLayerHost(project,undefined);assert(!('ui_render_layer_host' in project));
 const source=await readFile(new URL('../player/main.js',import.meta.url),'utf8');
 assert(source.includes("layerHostSupported=(presentation.renderer_mode??'official')==='official';declareUiRenderLayerHost(project,layerHostSupported)"));
 assert(source.includes('declareUiRenderLayerHost(projectPayload,layerHostSupported)'));
});
