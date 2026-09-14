import '../app.mjs';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
const w=window.wardrobe,source=new FBXLoader().parse(await (await fetch('tests/mixamo-test.fbx')).arrayBuffer(),'');const result=w.retargetFBX(source,w.rig,source.animations[0]);w.clips.imported=result.clip;const menu=document.getElementById('motion');menu.add(new Option('Mixamo 測試動作','imported'));menu.value='imported';menu.dispatchEvent(new Event('change'));document.getElementById('status').textContent='真實 FBX 測試 · 55/55 骨骼映射';
