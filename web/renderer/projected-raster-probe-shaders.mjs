// Internal feasibility adapters. Not a game shader or a supported presentation API.
import {PROJECTED_VERTEX_SHADER,PROJECTED_FRAGMENT_SHADER} from './projected.js';
export function probeShaderNamespace(THREE,strategy){
 if(strategy==='A')return THREE;
 return {...THREE,ShaderMaterial:class extends THREE.ShaderMaterial{
  constructor(parameters){
   if(parameters.vertexShader!==PROJECTED_VERTEX_SHADER||parameters.fragmentShader!==PROJECTED_FRAGMENT_SHADER)
    throw Error('RASTER_PROBE_SHADER_SOURCE_CHANGED');
   const vertexShader=strategy==='C'?parameters.vertexShader.replace('clipPosition.xy','vec2(clipPosition.x,-clipPosition.y)'):parameters.vertexShader;
   const fragmentShader=parameters.fragmentShader.replace('#include <colorspace_fragment>','gl_FragColor.rgb=projectedToEncoded(gl_FragColor.rgb);');
   super({...parameters,vertexShader,fragmentShader});
  }
 }};
}
export function copySourceY(destinationGlY,height,strategy){return strategy==='C'?height-1-destinationGlY:destinationGlY;}
export const COPY_VERTEX=`void main(){gl_Position=vec4(position.xy,0.0,1.0);}`;
export const COPY_FRAGMENT=`precision highp float;
precision highp int;
uniform sampler2D encodedCoverage;
uniform int physicalHeight;
uniform bool reflectRows;
void main(){
 ivec2 p=ivec2(gl_FragCoord.xy);
 if(reflectRows)p.y=physicalHeight-1-p.y;
 vec4 value=texelFetch(encodedCoverage,p,0);
 if(value.a<0.5)discard;
 gl_FragColor=vec4(value.rgb,1.0);
}`;
