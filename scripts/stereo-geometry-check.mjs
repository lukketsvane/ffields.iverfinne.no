import {DEFAULT_STEREO_CAMERA_PARAMETERS,validateStereoCameraParameters} from '../lib/stereo-camera-study.ts';

// Independent triangle/box separating-axis check of the exported surface. A
// clear analytic field alone does not prove that tessellation preserves a seat.
function triangleIntersectsBox(vertices,center,half){
 const points=vertices.map(point=>point.map((value,axis)=>value-center[axis]));
 for(let axis=0;axis<3;axis++)if(Math.min(...points.map(point=>point[axis]))>half[axis]||Math.max(...points.map(point=>point[axis]))<-half[axis])return false;
 const edges=points.map((point,index)=>points[(index+1)%3].map((value,axis)=>value-point[axis]));
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const axes=[cross(edges[0],edges[1]),...edges.flatMap(edge=>[[1,0,0],[0,1,0],[0,0,1]].map(axis=>cross(edge,axis)))];
 for(const axis of axes){
  if(Math.hypot(...axis)<1e-12)continue;
  const radius=axis.reduce((sum,value,index)=>sum+Math.abs(value)*half[index],0),projection=points.map(point=>point.reduce((sum,value,index)=>sum+value*axis[index],0));
  if(Math.min(...projection)>radius||Math.max(...projection)<-radius)return false;
 }
 return true;
}

/** Check the actual exported triangles against two conservative rectangular
 * hardware envelopes expanded by nominal clearance minus a 0.05 mm sampling
 * allowance. This is a collision check of reference space, not a hardware fit,
 * optical, tolerance or manufacturing certification.
 */
export function stereoEnvelopeCollisions(mesh,parameters=DEFAULT_STEREO_CAMERA_PARAMETERS){
 const p=validateStereoCameraParameters(parameters),{positions,indices}=mesh;
 if(!positions||!indices||positions.length%3||indices.length%3||!positions.every(Number.isFinite)||!indices.every(index=>Number.isInteger(index)&&index>=0&&index*3<positions.length))throw Error('Stereo clearance check requires a finite indexed triangle mesh.');
 const samplingAllowance=.05,requiredPerSideClearance=Math.max(0,p.clearance-samplingAllowance),half=[p.cameraWidth/2+requiredPerSideClearance,p.cameraHeight/2+requiredPerSideClearance,p.cameraDepth/2+requiredPerSideClearance];
 let triangleHardwareCollisions=0,firstCollision=null;
 for(let i=0;i<indices.length;i+=3){
  const vertices=Array.from(indices.slice(i,i+3),index=>Array.from(positions.slice(index*3,index*3+3)));
  for(const [camera,x] of [['left',-p.baseline/2],['right',p.baseline/2]]){
   if(triangleIntersectsBox(vertices,[x,0,0],half)){
    triangleHardwareCollisions++;
    firstCollision??={triangle:i/3,camera};
   }
  }
 }
 return {testedTriangles:indices.length/3,referenceEnvelopes:2,nominalPerSideClearance:p.clearance,samplingAllowance,requiredPerSideClearance,triangleHardwareCollisions,firstCollision};
}
