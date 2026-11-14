// fx.chromatic: chromatic aberration, colour fringes towards the edges.
import {definePass} from './shared.js';

export const effect = {
  kind: 'fx.chromatic',
  title: 'Chromatic aberration',
  summary: 'Splits red and blue apart towards the screen edges, like a cheap lens; good for hits and glitches.',
  keywords: ['chromatic aberration', 'chromatic', 'rgb split', 'color fringe', 'lens', 'glitch', '色差', '色散', '故障'],
  params: {
    amount: {type: 'number', default: 0.004, min: 0, max: 0.05, meaning: 'Offset at the corners, as a fraction of the screen.'},
  },
};

const fragment = `uniform sampler2D image;uniform float amount;varying vec2 vUv;
void main(){
  vec2 offset=(vUv-.5)*2.*amount;
  float r=texture2D(image,vUv+offset).r;
  float g=texture2D(image,vUv).g;
  float b=texture2D(image,vUv-offset).b;
  gl_FragColor=vec4(r,g,b,1.);
  #include <colorspace_fragment>
}`;

export const createPass = definePass(effect, fragment,
  () => ({amount: {value: 0}}),
  (u, v) => { u.amount.value = v.amount; });
