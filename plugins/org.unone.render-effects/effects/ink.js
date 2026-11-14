// fx.ink: dark outlines where the image's brightness changes sharply.
import {definePass} from './shared.js';

export const effect = {
  kind: 'fx.ink',
  title: 'Ink outlines',
  summary: 'Draws outlines along sharp brightness edges (Sobel filter), for a comic or cel-shaded look.',
  keywords: ['outline', 'outlines', 'ink', 'edge detection', 'sobel', 'comic', 'cel shading', 'toon', '描邊', '輪廓', '卡通', '漫畫'],
  params: {
    threshold: {type: 'number', default: 0.2, min: 0, max: 1, meaning: 'Edge strength that starts a line; lower draws more lines.'},
    thickness: {type: 'number', default: 1, min: 0.5, max: 4, meaning: 'Line width in screen pixels.'},
    strength: {type: 'number', default: 1, min: 0, max: 1, meaning: 'Line opacity.'},
    color: {type: 'color', default: '#101010', meaning: 'Line colour, "#rrggbb".'},
  },
};

const fragment = `uniform sampler2D image;uniform vec2 resolution;uniform float threshold,thickness,strength;uniform vec3 inkColor;varying vec2 vUv;
float luma(vec2 uv){return dot(sqrt(max(texture2D(image,uv).rgb,0.)),vec3(.299,.587,.114));}
void main(){
  vec2 d=thickness/resolution;
  float tl=luma(vUv+vec2(-d.x,d.y)),t=luma(vUv+vec2(0.,d.y)),tr=luma(vUv+d);
  float l=luma(vUv-vec2(d.x,0.)),r=luma(vUv+vec2(d.x,0.));
  float bl=luma(vUv-d),b=luma(vUv-vec2(0.,d.y)),br=luma(vUv+vec2(d.x,-d.y));
  float gx=tr+2.*r+br-tl-2.*l-bl,gy=tl+2.*t+tr-bl-2.*b-br;
  float edge=smoothstep(threshold,threshold+.1,length(vec2(gx,gy)));
  gl_FragColor=vec4(mix(texture2D(image,vUv).rgb,inkColor,edge*strength),1.);
  #include <colorspace_fragment>
}`;

export const createPass = definePass(effect, fragment,
  THREE => ({threshold: {value: 0.2}, thickness: {value: 1}, strength: {value: 1}, inkColor: {value: new THREE.Color()}}),
  (u, v) => { u.threshold.value = v.threshold; u.thickness.value = v.thickness; u.strength.value = v.strength; u.inkColor.value.set(v.color); });
