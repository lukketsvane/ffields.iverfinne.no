import * as THREE from 'three';
import type {FormModel} from './form-engine';
import {lensCenters,lensY} from './form-engine';

// Explicit surface deformation, identical to rippleOffset in the export engine.
const shader = `
uniform int rippleCount;
uniform vec4 rippleField[20];
uniform vec4 rippleShape[20];
uniform float rippleFalloff[20];
uniform vec4 rippleLens;
uniform vec4 rippleCamera;
uniform vec4 rippleFeatures;
float rippleAt(vec3 p){
 float d=0.;
 for(int i=0;i<20;i++){
  if(i>=rippleCount)break;
  vec4 f=rippleField[i],s=rippleShape[i];
  float dist=length(p.xy-f.xy)/s.w;
  float w=rippleFalloff[i]<.5?exp(-dist*dist*1.6):rippleFalloff[i]<1.5?max(0.,1.-dist):rippleFalloff[i]<2.5?1.-smoothstep(0.,1.4,dist):1.;
  float u=dot(p.xy-f.xy,vec2(cos(s.z),sin(s.z)));
  d+=f.w*w*sin(u/s.x*6.28318530718+s.y);
 }
 float mask=1.;
 if(rippleCamera.w>.5){
  mask*=smoothstep(rippleLens.w+1.,rippleLens.w+22.,length(p.xy-vec2(rippleLens.x,rippleLens.z)));
  mask*=smoothstep(rippleLens.w+1.,rippleLens.w+22.,length(p.xy-vec2(rippleLens.y,rippleLens.z)));
 }
 if(rippleFeatures.z>.5)mask*=smoothstep(9.,21.,length(p.xy-vec2(rippleCamera.x*.34,rippleCamera.y*.5+1.3)));
 if(rippleFeatures.w>.5)mask*=smoothstep(8.,19.,length(p.xy-vec2(rippleCamera.x*.5,-rippleCamera.y*.25)));
 return d*mask*(.82+.18*tanh(p.z/rippleCamera.z));
}
`;
export function createRippleMaterial(material:THREE.MeshStandardMaterial,depth:THREE.MeshDepthMaterial){
 const uniforms={rippleCount:{value:0},rippleField:{value:Array.from({length:20},()=>new THREE.Vector4())},rippleShape:{value:Array.from({length:20},()=>new THREE.Vector4())},rippleFalloff:{value:new Float32Array(20)},rippleLens:{value:new THREE.Vector4()},rippleCamera:{value:new THREE.Vector4()},rippleFeatures:{value:new THREE.Vector4()}};
 for(const mat of [material,depth]){
  mat.onBeforeCompile=program=>{
   Object.assign(program.uniforms,uniforms);
   program.vertexShader=shader+program.vertexShader;
   if(mat===material)program.vertexShader=program.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    float e=.04;
    float rx=(rippleAt(position+vec3(e,0.,0.))-rippleAt(position-vec3(e,0.,0.)))/(2.*e);
    float ry=(rippleAt(position+vec3(0.,e,0.))-rippleAt(position-vec3(0.,e,0.)))/(2.*e);
    float rz=(rippleAt(position+vec3(0.,0.,e))-rippleAt(position-vec3(0.,0.,e)))/(2.*e);
    objectNormal=normalize(vec3(objectNormal.x*(1.+rz)-objectNormal.z*rx,objectNormal.y*(1.+rz)-objectNormal.z*ry,objectNormal.z));`);
   program.vertexShader=program.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n transformed.z+=rippleAt(position);');
  };
  mat.customProgramCacheKey=()=> 'form-camera-ripple-1';
 }
 return (m:FormModel,phase?:number)=>{
  const waves=m.influences.filter(f=>f.kind==='wave');uniforms.rippleCount.value=waves.length;
  waves.forEach((f,i)=>{uniforms.rippleField.value[i].set(f.x,f.y,f.z,f.enabled?f.strength:0);uniforms.rippleShape.value[i].set(f.wavelength,(i===0&&phase!==undefined?phase:f.phase)*Math.PI/180,f.angle*Math.PI/180,f.radius);uniforms.rippleFalloff.value[i]=['gaussian','linear','smooth','constant'].indexOf(f.falloff)});
  const centres=lensCenters(m);uniforms.rippleLens.value.set(centres[0],centres[1],lensY(m),m.lensRadius);
  uniforms.rippleCamera.value.set(m.width,m.height,Math.max(m.depth,44,waves.reduce((v,f)=>v+(f.enabled?Math.abs(f.strength):0),0)*.36),m.lenses&&m.protect?1:0);uniforms.rippleFeatures.value.set(0,0,m.buttons?1:0,m.usb?1:0);
 };
}
