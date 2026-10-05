import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneModel,compileModelField,evaluate,generateMesh,generateMeshAsync,makeInfluence} from '../lib/form-engine.ts';
import {createCameraPodStudy} from '../lib/camera-pod-study.ts';

function points(){
 const samples=[[-4,-37.5,17.7],[-4,-25.5,20.5],[39,27,13],[14.5,8.5,10.8]];
 let seed=314159;
 for(let i=0;i<240;i++){
  const coordinate=(extent)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed/0x100000000-.5)*extent;};
  samples.push([coordinate(130),coordinate(150),coordinate(80)]);
 }
 return samples;
}
test('prepared bulk fields preserve scoped CSG, swept cuts and ripple inverse to floating-point roundoff',()=>{
 for(const separate of [false,true])for(const ripple of [false,true]){
  const model=createCameraPodStudy(separate);
  if(ripple)model.influences=[{...makeInfluence('wave'),strength:4.2,angle:26,phase:113},{...makeInfluence('twist'),strength:3.1}];
  const field=compileModelField(model);
  for(const point of points())assert.ok(Math.abs(field(...point)-evaluate(model,...point))<1e-12,JSON.stringify({separate,ripple,point}));
 }
});
test('compiled field snapshots remain valid while the author edits swept geometry and ownership',()=>{
 const model=createCameraPodStudy(),snapshot=cloneModel(model),field=compileModelField(model);
 model.shapes.find(shape=>shape.kind==='sweep').path[0].radius+=2;
 model.shapes.find(shape=>shape.componentId).componentId=undefined;
 model.influences=[{...makeInfluence('wave'),strength:5}];
 for(const point of points())assert.equal(field(...point),evaluate(snapshot,...point));
 assert.ok(points().some(point=>field(...point)!==evaluate(model,...point)));
});
test('compiled cooperative mesh stays byte-identical and cancellable for swept component waves',async()=>{
 const model=createCameraPodStudy();model.influences=[{...makeInfluence('wave'),strength:1.5}];
 const options={tolerance:.15,maxPasses:1,maxTriangles:120000};
 assert.deepEqual(await generateMeshAsync(model,24,options),generateMesh(model,24,options));
 const controller=new AbortController();let clock=0;
 await assert.rejects(generateMeshAsync(model,24,options,undefined,{signal:controller.signal,budgetMs:1,now:()=>clock++,yieldControl:async()=>controller.abort()}),{name:'AbortError'});
});
