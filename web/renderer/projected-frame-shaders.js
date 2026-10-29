export const FRAME_VERTEX=`attribute vec4 clipPosition;
attribute vec4 linearRgba;
varying vec2 frameUv;
varying vec4 frameColor;
void main(){
 gl_Position=vec4(clipPosition.x,-clipPosition.y,2.0*clipPosition.z-clipPosition.w,clipPosition.w);
 frameUv=uv;frameColor=linearRgba;
}`;
export const FRAME_FRAGMENT=`precision highp float;
uniform sampler2D frameTexture;
uniform bool textureAlphaOne;
uniform int alphaSource;
uniform bool alphaTest;
uniform int alphaCompare;
uniform float alphaReference;
varying vec2 frameUv;
varying vec4 frameColor;
bool compareAlpha(float a,float b){
 if(alphaCompare==0)return false;if(alphaCompare==1)return a<b;
 if(alphaCompare==2)return a==b;if(alphaCompare==3)return a<=b;
 if(alphaCompare==4)return a>b;if(alphaCompare==5)return a!=b;
 if(alphaCompare==6)return a>=b;return true;
}
void main(){
 vec4 sampleValue=texture2D(frameTexture,frameUv);
 float at=textureAlphaOne?1.0:sampleValue.a;
 float a=alphaSource==0?at:alphaSource==1?frameColor.a:at*frameColor.a;
 if(alphaTest&&!compareAlpha(a,alphaReference))discard;
 gl_FragColor=vec4(sampleValue.rgb*frameColor.rgb,a);
}`;
export const FRAME_FULLSCREEN_VERTEX=`void main(){gl_Position=vec4(position.xy,0.0,1.0);}`;
export const FRAME_INITIAL_FRAGMENT=`precision highp float;
uniform vec3 initialRgb;
uniform float initialDepth;
void main(){gl_FragColor=vec4(initialRgb,1.0);gl_FragDepth=initialDepth;}`;
export const FRAME_COPY_FRAGMENT=`precision highp float;
precision highp int;
uniform sampler2D frameColorTexture;
uniform int physicalHeight;
void main(){ivec2 p=ivec2(gl_FragCoord.xy);p.y=physicalHeight-1-p.y;
 gl_FragColor=vec4(texelFetch(frameColorTexture,p,0).rgb,1.0);}`;
export const FRAME_SIZE_FRAGMENT=`precision highp float;
precision highp int;
uniform sampler2D colorAttachment;
uniform sampler2D depthAttachment;
void main(){ivec2 s=gl_FragCoord.x<1.0?textureSize(colorAttachment,0):textureSize(depthAttachment,0);
 gl_FragColor=vec4(float(s.x&255),float((s.x>>8)&255),float(s.y&255),float((s.y>>8)&255))/255.0;}`;
