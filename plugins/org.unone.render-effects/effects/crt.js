// fx.crt: a curved CRT screen with scanlines and an RGB aperture mask.
import {definePass} from './shared.js';

export const effect = {
  kind: 'fx.crt',
  title: 'CRT screen',
  summary: 'Barrel curvature, scanlines and an RGB aperture mask, like an old tube display.',
  keywords: ['crt', 'retro', 'scanlines', 'tube', 'arcade', '復古', '掃描線', '映像管'],
  params: {
    curvature: {type: 'number', default: 0.15, min: 0, max: 1, meaning: 'Barrel bend of the screen; 0 is flat.'},
    scanlines: {type: 'number', default: 0.35, min: 0, max: 1, meaning: 'How dark the gaps between lines are.'},
    mask: {type: 'number', default: 0.2, min: 0, max: 1, meaning: 'Strength of the red/green/blue column mask.'},
  },
};

const fragment = `uniform sampler2D image;uniform vec2 resolution;uniform float curvature,scanlines,mask;varying vec2 vUv;
void main(){
  vec2 c=vUv*2.-1.;
  c*=1.+curvature*.25*dot(c,c);
  vec2 uv=c*.5+.5;
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);}
  else{
    vec3 color=texture2D(image,uv).rgb;
    color*=1.-scanlines*(.5+.5*cos(uv.y*resolution.y*3.14159265));
    float column=mod(floor(gl_FragCoord.x),3.);
    vec3 tint=column<1.?vec3(1.,1.-mask,1.-mask):column<2.?vec3(1.-mask,1.,1.-mask):vec3(1.-mask,1.-mask,1.);
    gl_FragColor=vec4(color*tint*(1.+mask*.5),1.);
  }
  #include <colorspace_fragment>
}`;

export const createPass = definePass(effect, fragment,
  () => ({curvature: {value: 0}, scanlines: {value: 0}, mask: {value: 0}}),
  (u, v) => { u.curvature.value = v.curvature; u.scanlines.value = v.scanlines; u.mask.value = v.mask; });
