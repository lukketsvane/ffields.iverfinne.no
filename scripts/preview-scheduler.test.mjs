import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestPreviewScheduler,previewResolution,previewUpdateStage,previewNeedsSettle,previewRefinement,previewDetailResolution} from '../lib/preview-scheduler.ts';
import {cloneModel,DEFAULT_MODEL,generateMesh,generatePreviewMesh,generateMeshAsync,sectionContours,sectionContoursAsync,modelBounds,evaluate} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {createStereoCameraStudy} from '../lib/stereo-camera-study.ts';

test('rapid edits retain one running task and only the newest queued model',()=>{
 const queue=new LatestPreviewScheduler(),one={id:1,shape:'first'},two={id:2,shape:'middle'},three={id:3,shape:'last'};
 assert.equal(queue.enqueue(one),one);assert.equal(queue.enqueue(two),undefined);assert.equal(queue.enqueue(three),undefined);
 assert.equal(queue.current,one);assert.equal(queue.waiting,three);
 assert.deepEqual(queue.finish(1),{accept:false,next:three});assert.equal(queue.current,three);
 assert.deepEqual(queue.finish(1),{accept:false},'a repeated response cannot release the current job');
 assert.equal(queue.current,three);assert.deepEqual(queue.finish(3),{accept:true});assert.equal(queue.current,undefined);
});

test('new input invalidates an old settled response before its debounce dispatch',()=>{
 const queue=new LatestPreviewScheduler();queue.enqueue({id:1});queue.invalidate(2);
 assert.deepEqual(queue.finish(1),{accept:false},'editing never gives stale results a bypass');
 assert.equal(queue.enqueue({id:1}),undefined,'older dispatch timers are ignored');
 assert.deepEqual(queue.enqueue({id:2}),{id:2});assert.deepEqual(queue.finish(2),{accept:true});
});

test('ordinary project load and committed changes start fine; focus and release never downgrade the same geometry',()=>{
 assert.equal(previewUpdateStage(undefined,'camera',false),'settled');
 const fine={geometry:'camera',stage:'settled'};
 assert.equal(previewUpdateStage(fine,'camera',true),undefined,'opening a numeric input keeps the fine surface');
 assert.equal(previewUpdateStage(fine,'camera',false),undefined,'releasing an unchanged grip does not remesh');
 assert.equal(previewNeedsSettle(fine,'camera'),false);
 assert.equal(previewUpdateStage(fine,'committed-cut',false),'settled','a button or project load never requests a coarse draft');
 assert.equal(previewUpdateStage(fine,'dragged-camera',true),'draft','actual continuous geometry changes still get a responsive draft');
 const draft={geometry:'dragged-camera',stage:'draft'};
 assert.equal(previewNeedsSettle(draft,'dragged-camera'),true,'a paused focused input promotes without waiting for blur');
 assert.equal(previewNeedsSettle(draft,'obsolete-camera'),false,'an old timer cannot promote a replaced model');
 assert.equal(previewUpdateStage(draft,'dragged-camera',false),'settled','release requests only the fine phase');
 const promoted={geometry:'dragged-camera',stage:'settled'};
 assert.equal(previewUpdateStage(promoted,'dragged-camera',false),undefined,'blur after background completion cannot restart or downgrade it');
});

test('magnification refines display targets in bounded buckets and severely limited patches get only one grid retry',()=>{
 assert.equal(previewRefinement(false,4).tolerance,.04);
 assert.equal(previewRefinement(false,10).tolerance,.02);
 assert.equal(previewRefinement(false,24).tolerance,.01);
 assert.equal(previewRefinement(false,Infinity).tolerance,.04);
 assert.equal(previewRefinement(true,100),undefined,'a continuous input draft remains bounded');
 const severe={refinement:{qualityLimited:true,maxFaceResidualAfter:.6,meanFaceResidualAfter:.009}};
 assert.equal(previewDetailResolution(severe,128),164);
 assert.equal(previewDetailResolution(severe,164),undefined,'the finite retry cannot loop toward an unresolved crease');
 assert.equal(previewDetailResolution({refinement:{...severe.refinement,meanFaceResidualAfter:.001}},128),undefined,'an already accurate circular plate does not spend another dense grid');
 assert.equal(previewDetailResolution({refinement:{...severe.refinement,maxFaceResidualAfter:.05}},128),undefined,'a small sharp feature does not trigger bulk resampling');
});

test('background tabs and worker recovery retain the latest snapshot without duplicate work',()=>{
 const queue=new LatestPreviewScheduler();queue.enqueue({id:1});queue.pause();queue.enqueue({id:2});queue.enqueue({id:3});
 assert.deepEqual(queue.finish(1),{accept:false});assert.equal(queue.current,undefined);assert.equal(queue.waiting.id,3);
 assert.deepEqual(queue.resume(),{id:3});queue.enqueue({id:4});assert.deepEqual(queue.restart(),{id:4});
 assert.deepEqual(queue.finish(3),{accept:false});assert.deepEqual(queue.finish(4),{accept:true});
 queue.enqueue({id:5});queue.invalidate(6);assert.equal(queue.restart(),undefined,'an obsolete worker snapshot is not rerun');
 assert.deepEqual(queue.enqueue({id:6}),{id:6});queue.dispose();assert.deepEqual(queue.finish(6),{accept:false});assert.equal(queue.enqueue({id:7}),undefined);
});

test('draft grid effort responds to active complexity and actual measured time within fixed bounds',()=>{
 const simple={...cloneModel(DEFAULT_MODEL),influences:[],shapes:[],asymmetry:0},complex=createStereoCameraStudy();
 assert.equal(previewResolution(simple,{mobile:true,editing:true}),60);
 assert.ok(previewResolution(complex,{mobile:true,editing:true})<48,'many curved evaluators lower cubic draft sampling effort');
 assert.ok(previewResolution(complex,{mobile:true,editing:false})>=72);
 assert.equal(previewResolution({...simple,shapes:complex.shapes.map(s=>({...s,enabled:false}))},{mobile:true,editing:true}),60,'disabled shapes do not cost evaluation');
 const previous={resolution:60,milliseconds:2200};
 assert.equal(previewResolution(simple,{mobile:true,editing:true,previous}),28);
 assert.equal(previewResolution(simple,{mobile:true,editing:false,previous}),136,'a slow draft never lowers settled quality');
 assert.equal(previewResolution(simple,{mobile:true,editing:true,previous:{resolution:60,milliseconds:NaN}}),60);
});

function equivalent(a,b){
 for(const key of ['positions','normals','indices'])assert.deepEqual(b[key],a[key],key);
 assert.deepEqual(b.bounds,a.bounds);assert.equal(b.volume,a.volume);assert.deepEqual(b.sampling,a.sampling);assert.deepEqual(b.refinement,a.refinement);
}

test('cooperative previews yield to input while matching waves, sharp cuts and transported sweeps exactly',async()=>{
 const waves=cloneModel(DEFAULT_MODEL),box={...makeShape('box'),id:'mass',x:0,y:0,z:0,width:62,height:48,depth:24,roundness:0,blend:0};
 const sharp={...cloneModel(DEFAULT_MODEL),baseEnabled:false,asymmetry:0,influences:[],shapes:[box,{...box,id:'cut',width:55,height:39,depth:28,operation:'subtract'}]};
 const sweep={...makeShape('sweep'),id:'loop',sectionMode:'transported',depthRatio:.5,closed:true,path:[{x:-25,y:0,z:0,radius:5},{x:0,y:20,z:12,radius:7},{x:25,y:0,z:0,radius:5},{x:0,y:-20,z:-10,radius:8}]};
 const curved={...sharp,shapes:[sweep]};
 for(const model of [waves,sharp,curved]){
  const before=JSON.stringify(model),sync=generateMesh(model,28);let tick=0,yields=0;
  const asyncMesh=await generateMeshAsync(model,28,undefined,undefined,{budgetMs:4,now:()=>tick++,yieldControl:async()=>{yields++;}});
  equivalent(sync,asyncMesh);assert.ok(yields>10,'the fallback does not monopolise one main-thread task');assert.equal(JSON.stringify(model),before);
 }
});

test('superseded cooperative previews abort after yielding and produce no completed mesh',async()=>{
 const model=cloneModel(DEFAULT_MODEL),before=JSON.stringify(model),controller=new AbortController();let tick=0,yields=0;
 await assert.rejects(generateMeshAsync(model,64,undefined,undefined,{signal:controller.signal,budgetMs:1,now:()=>tick++,yieldControl:async()=>{yields++;controller.abort();}}),{name:'AbortError'});
 assert.equal(yields,1);assert.equal(JSON.stringify(model),before);
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(generateMeshAsync(model,64,undefined,undefined,{signal:aborted.signal,yieldControl:async()=>{assert.fail('an already aborted preview must not begin');}}),{name:'AbortError'});
 await assert.rejects(generateMeshAsync(model,28,undefined,undefined,{budgetMs:0}),/budget/);
});

test('explicit four-pass interaction roots match cooperative drafts without changing authoritative generation',async()=>{
 const model=createStereoCameraStudy(),before=JSON.stringify(model),draft=generatePreviewMesh(model,28);let tick=0;
 const cooperative=await generateMeshAsync(model,28,undefined,undefined,{draft:true,now:()=>tick++,budgetMs:8,yieldControl:async()=>{}});
 equivalent(draft,cooperative);
 const exact=generateMesh(model,28),defaultAsync=await generateMeshAsync(model,28,undefined,undefined,{now:()=>tick++,budgetMs:8,yieldControl:async()=>{}});
 equivalent(exact,defaultAsync);assert.deepEqual(draft.sampling.cells,exact.sampling.cells);assert.equal(draft.indices.length,exact.indices.length);
 assert.notDeepEqual(draft.positions,exact.positions,'the explicit draft path genuinely lowers root work');assert.equal(JSON.stringify(model),before);
});

test('cooperative generation retains the bounded quantization retry and complete topology',async()=>{
 const model=createStereoCameraStudy({cameraWidth:68,cameraHeight:48,cameraDepth:38,baseline:86,clearance:.8,wall:4}),sync=generateMesh(model,72,{tolerance:.12,maxPasses:0});
 assert.equal(sync.sampling.quantizationLimited,true);let tick=0,yields=0;
 const cooperative=await generateMeshAsync(model,72,{tolerance:.12,maxPasses:0},undefined,{now:()=>tick++,budgetMs:64,yieldControl:async()=>{yields++;}});
 equivalent(sync,cooperative);assert.ok(yields>10);assert.equal(cooperative.refinement.degenerateInputTriangles,0);
});

// Independent original marching-squares evaluator verifies that compiled
// snapshots and shared Float64 corners preserve the authored section surface.
function referenceSection(model,z,n){
 const b=modelBounds(model),width=b[3]-b[0],height=b[4]-b[1],dx=width/n,dy=height/n,segments=[];
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){
  const corners=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]],points=corners.map(([x,y])=>[b[0]+x*dx,b[1]+y*dy]),v=points.map(([x,y])=>evaluate(model,x,y,z)),cuts=[];
  for(let a=0;a<4;a++){const next=(a+1)%4;if((v[a]<0)!==(v[next]<0)){const t=v[a]/(v[a]-v[next]);cuts.push([points[a][0]+t*(points[next][0]-points[a][0]),points[a][1]+t*(points[next][1]-points[a][1])]);}}
  for(let a=0;a<cuts.length-1;a+=2)segments.push([...cuts[a],...cuts[a+1]]);
 }
 return {segments,width,height,minX:b[0],minY:b[1]};
}
test('compiled shared-corner sections match the original field, async order and cancellation',async()=>{
 for(const model of [cloneModel(DEFAULT_MODEL),createStereoCameraStudy()]){
  const before=JSON.stringify(model),expected=referenceSection(model,3.25,36),sync=sectionContours(model,3.25,36);
  assert.deepEqual({...sync,segments:[]},{...expected,segments:[]});assert.equal(sync.segments.length,expected.segments.length);
  for(let i=0;i<sync.segments.length;i++)for(let a=0;a<4;a++)assert.ok(Math.abs(sync.segments[i][a]-expected.segments[i][a])<1e-10,'compiled coordinate transforms differ only by floating-point roundoff');let tick=0,yields=0;
  const cooperative=await sectionContoursAsync(model,3.25,36,{now:()=>tick++,budgetMs:2,yieldControl:async()=>{yields++;}});
  assert.deepEqual(cooperative,sync);assert.ok(yields>10);assert.equal(JSON.stringify(model),before);
 }
 const controller=new AbortController();let tick=0;
 await assert.rejects(sectionContoursAsync(DEFAULT_MODEL,0,100,{signal:controller.signal,now:()=>tick++,budgetMs:1,yieldControl:async()=>controller.abort()}),{name:'AbortError'});
 assert.throws(()=>sectionContours(DEFAULT_MODEL,NaN,100),/Section sampling/);assert.throws(()=>sectionContours(DEFAULT_MODEL,0,Infinity),/Section sampling/);
});
