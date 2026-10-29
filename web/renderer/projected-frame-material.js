import {FRAME_VERTEX,FRAME_FRAGMENT} from './projected-frame-shaders.js';
import {FRAME_COMPARES} from '../shared/projected-frame-material.mjs';
export function createFrameMaterial(THREE,m){
 const depths=[THREE.NeverDepth,THREE.LessDepth,THREE.EqualDepth,THREE.LessEqualDepth,THREE.GreaterDepth,THREE.NotEqualDepth,THREE.GreaterEqualDepth,THREE.AlwaysDepth];
 return new THREE.ShaderMaterial({vertexShader:FRAME_VERTEX,fragmentShader:FRAME_FRAGMENT,side:THREE.DoubleSide,
  uniforms:{frameTexture:{value:null},textureAlphaOne:{value:m.texture_alpha==='one'},alphaSource:{value:['texture','vertex','texture_times_vertex'].indexOf(m.alpha)},
   alphaTest:{value:m.alpha_test.enabled},alphaCompare:{value:FRAME_COMPARES.indexOf(m.alpha_test.compare)},alphaReference:{value:m.alpha_test.reference}},
  depthTest:m.depth.test,depthWrite:m.depth.write,depthFunc:depths[FRAME_COMPARES.indexOf(m.depth.compare)],
  transparent:false,premultipliedAlpha:false,toneMapped:false,dithering:false,
  blending:m.blend.enabled?THREE.CustomBlending:THREE.NoBlending,blendEquation:THREE.AddEquation,
  blendSrc:THREE.SrcAlphaFactor,blendDst:m.blend.destination==='one'?THREE.OneFactor:THREE.OneMinusSrcAlphaFactor,
  blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.ZeroFactor});
}
export function frameTextureKey(s){return `raw-straight:${s.min}:${s.mag}:${s.address_u}:${s.address_v}`;}
export function createFrameTexture(THREE,source,s){
 const texture=source.clone();texture.colorSpace=THREE.NoColorSpace;texture.premultiplyAlpha=false;
 texture.minFilter=s.min==='linear'?THREE.LinearFilter:THREE.NearestFilter;
 texture.magFilter=s.mag==='linear'?THREE.LinearFilter:THREE.NearestFilter;
 texture.wrapS=s.address_u==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
 texture.wrapT=s.address_v==='repeat'?THREE.RepeatWrapping:THREE.ClampToEdgeWrapping;
 texture.generateMipmaps=false;texture.needsUpdate=true;return texture;
}
