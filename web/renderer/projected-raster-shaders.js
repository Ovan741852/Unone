export const PROJECTED_VERTEX_SHADER=`attribute vec4 clipPosition;
attribute vec4 linearRgba;
varying vec2 projectedUv;
varying vec4 projectedColor;
void main(){
 gl_Position=vec4(clipPosition.xy,2.0 * clipPosition.z - clipPosition.w,clipPosition.w);
 projectedUv=uv;projectedColor=linearRgba;
}`;
export const PROJECTED_FRAGMENT_SHADER=`uniform sampler2D projectedTexture;
uniform float projectedEncodedMode;
uniform float projectedAlphaCutoff;
uniform float projectedAlphaStrict;
uniform float projectedEncodedSampling;
uniform float projectedRepeatAddress;
varying vec2 projectedUv;
varying vec4 projectedColor;
vec3 projectedToEncoded(vec3 value){return mix(1.055*pow(value,vec3(1.0/2.4))-0.055,12.92*value,lessThanEqual(value,vec3(0.0031308)));}
vec3 projectedToLinear(vec3 value){return mix(pow((value+0.055)/1.055,vec3(2.4)),value/12.92,lessThanEqual(value,vec3(0.04045)));}
vec4 projectedEncodedTexel(ivec2 p,ivec2 size){ivec2 position=clamp(p,ivec2(0),size-ivec2(1));if(projectedRepeatAddress>0.5)position=((p%size)+size)%size;vec4 value=texelFetch(projectedTexture,position,0);return vec4(projectedToEncoded(value.rgb),value.a);}
vec4 projectedSample(vec2 uv){
 vec4 value=texture2D(projectedTexture,uv);
 if(projectedEncodedSampling<0.5)return value;
 ivec2 size=textureSize(projectedTexture,0);vec2 p=uv*vec2(size)-0.5;ivec2 low=ivec2(floor(p));vec2 f=fract(p);
 vec4 top=mix(projectedEncodedTexel(low,size),projectedEncodedTexel(low+ivec2(1,0),size),f.x);
 vec4 bottom=mix(projectedEncodedTexel(low+ivec2(0,1),size),projectedEncodedTexel(low+ivec2(1,1),size),f.x);
 vec4 encoded=mix(top,bottom,f.y);return vec4(projectedToLinear(encoded.rgb),encoded.a);
}
void main(){
 vec4 texel=projectedSample(projectedUv);
 float alpha=texel.a*projectedColor.a;
 if(projectedAlphaStrict>0.5){if(alpha<=projectedAlphaCutoff)discard;}
 else if(alpha<projectedAlphaCutoff)discard;
 vec3 rgb=texel.rgb*projectedColor.rgb;
 if(projectedEncodedMode>0.5)rgb=projectedToLinear(projectedToEncoded(texel.rgb)*projectedColor.rgb);
 gl_FragColor=vec4(rgb,1.0);
 #include <colorspace_fragment>
}`;
export function projectedShaders(raster='host'){
 if(raster==='host')return {vertexShader:PROJECTED_VERTEX_SHADER,fragmentShader:PROJECTED_FRAGMENT_SHADER};
 if(raster!=='upper_left_checked')throw Error('PROJECTED_RASTER_INVALID');
 return {vertexShader:PROJECTED_VERTEX_SHADER.replace('clipPosition.xy','vec2(clipPosition.x,-clipPosition.y)'),
  fragmentShader:PROJECTED_FRAGMENT_SHADER.replace('#include <colorspace_fragment>','gl_FragColor.rgb=projectedToEncoded(gl_FragColor.rgb);')};
}
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
