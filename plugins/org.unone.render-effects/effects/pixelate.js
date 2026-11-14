// fx.pixelate: draw the frame as large square pixels.
import {definePass} from './shared.js';

export const effect = {
  kind: 'fx.pixelate',
  title: 'Pixelate',
  summary: 'Snaps the image to square cells for a chunky pixel-art look or a transition.',
  keywords: ['pixelate', 'pixel art', 'pixelated', 'mosaic', 'low res', '像素', '馬賽克', '像素化'],
  params: {
    size: {type: 'number', default: 4, min: 1, max: 64, meaning: 'Cell size in screen pixels; 1 is off.'},
  },
};

const fragment = `uniform sampler2D image;uniform vec2 resolution;uniform float size;varying vec2 vUv;
void main(){
  vec2 cell=size/resolution;
  vec2 uv=(floor(vUv/cell)+.5)*cell;
  gl_FragColor=vec4(texture2D(image,min(uv,vec2(1.))).rgb,1.);
  #include <colorspace_fragment>
}`;

export const createPass = definePass(effect, fragment,
  () => ({size: {value: 4}}),
  (u, v) => { u.size.value = v.size; });
