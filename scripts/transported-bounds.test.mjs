import test from 'node:test';
import assert from 'node:assert/strict';
import {makeShape,compileShape,evaluateShape,sweepFrames,sweepSamples,shapeBounds} from '../lib/shapes.ts';
import {shapeAxisDirection} from '../lib/orientation.ts';

const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const reference=(shape,world)=>{
 const axes=['x','y','z'].map(axis=>{const direction=shapeAxisDirection(shape,axis);return [direction.x,direction.y,direction.z];});
 const difference=world.map((v,i)=>v-[shape.x,shape.y,shape.z][i]),local=axes.map(axis=>dot(axis,difference));
 const frame=sweepFrames(shape)[0],samples=sweepSamples(shape);
 // Numerically minimize all linearly varying balls on each sampled segment.
 // This independent one-dimensional convex search does not use the evaluator's
 // closed-form taper formula or its box/BVH pruning. Authored radii interpolate
 // smoothly across the path, then linearly across these shared samples.
 let best=Infinity;
 for(let i=0;i<samples.length-1;i++){
  const a=samples[i],b=samples[i+1],offset=local.map((v,j)=>v-[a.x,a.y,a.z][j]);
  const length=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z),axial=dot(offset,frame.tangent),wide=dot(offset,frame.major),thin=dot(offset,frame.minor)/shape.depthRatio;
  const at=t=>Math.hypot(axial-t*length,wide,thin)-(a.radius+(b.radius-a.radius)*t);
  let low=0,high=1;for(let j=0;j<90;j++){const left=(2*low+high)/3,right=(low+2*high)/3;if(at(left)<at(right))high=right;else low=left;}
  best=Math.min(best,at(0),at(1),at((low+high)/2));
 }
 return best*shape.depthRatio;
};

test('normalized transported bounds retain independent tapered-capsule fields and finite CSG branches',()=>{
 let randomState=133719;const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
 for(const ratio of [.25,.41,.78,.99])for(const roll of [0,71])for(const radii of [[8,8],[2,27],[27,2]]){
  const shape={...makeShape('sweep'),x:17,y:-21,z:33,rx:31,ry:-49,rz:77,sectionMode:'transported',depthRatio:ratio,sectionRoll:roll,path:[{x:-40,y:-20,z:14,radius:radii[0]},{x:50,y:30,z:-18,radius:radii[1]}]},compiled=compileShape(shape),bounds=shapeBounds(shape);
  const axes=['x','y','z'].map(axis=>{const direction=shapeAxisDirection(shape,axis);return [direction.x,direction.y,direction.z];});
  const world=local=>[shape.x,shape.y,shape.z].map((v,a)=>v+axes[0][a]*local[0]+axes[1][a]*local[1]+axes[2][a]*local[2]);
  const interiors=sweepSamples(shape).map(p=>world([p.x,p.y,p.z]));
  const points=[...interiors,...Array.from({length:70},()=>[0,1,2].map(a=>bounds[a]-40+random()*(bounds[a+3]-bounds[a]+80)))];
  for(const point of points){
   const expected=reference(shape,point);
   assert.ok(Math.abs(compiled(...point)-expected)<2e-8,JSON.stringify({ratio,roll,radii,point,expected,actual:compiled(...point)}));
   assert.ok(Math.abs(evaluateShape(shape,...point)-expected)<2e-8);
   for(const limit of [-20,-6,-1,0,.5,2,5,20]){
    assert.ok(Math.abs(Math.min(compiled(...point,limit),limit)-Math.min(expected,limit))<2e-8,'finite branch limit must not discard an active surface');
    assert.ok(Math.abs(Math.min(evaluateShape(shape,...point,limit),limit)-Math.min(expected,limit))<2e-8);
   }
  }
 }
});

test('positive box distance is scaled before pruning a flattened transported surface',()=>{
 const shape={...makeShape('sweep'),x:0,y:0,z:0,sectionMode:'transported',depthRatio:.25,sectionRoll:0,path:[{x:-20,y:0,z:0,radius:8},{x:20,y:0,z:0,radius:8}]},compiled=compileShape(shape);
 // Wide-direction distance is normalized by .25, so a point 12mm outside the
 // ordinary enclosing box has field value3mm, which is active at limit4.
 const point=[0,20,0],expected=3;
 assert.ok(Math.abs(compiled(...point,4)-expected)<1e-10);assert.ok(Math.abs(evaluateShape(shape,...point,4)-expected)<1e-10);
 assert.equal(compiled(...point,2),2,'a genuinely inactive branch may return its limit');
});
