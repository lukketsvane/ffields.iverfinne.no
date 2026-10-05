import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneModel,DEFAULT_MODEL,generateMesh,generateMeshAsync,binarySTL,binarySTLAsync,evaluateBase} from '../lib/form-engine.ts';
import {makeShape,compileShape} from '../lib/shapes.ts';
import {refineMeshSurface,refineMeshSurfaceAsync} from '../lib/mesh-refinement.ts';
import {auditExportMesh} from '../lib/component-fit.ts';
import {runExportMeshJob} from '../lib/export-mesh-job.ts';

const model=()=>({...cloneModel(DEFAULT_MODEL),baseEnabled:false,influences:[],asymmetry:0,shapes:[{...makeShape('cylinder'),id:'test-solid',x:0,y:0,z:0,width:8,height:160,depth:8,blend:0,roundness:0}]});
const octahedron=()=>{const positions=new Float32Array([10,0,0,-10,0,0,0,10,0,0,-10,0,0,0,10,0,0,-10]);return {positions,normals:Float32Array.from(positions,value=>value/10),indices:new Uint32Array([0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5]),bounds:[-10,-10,-10,10,10,10],volume:4000/3};};
const sphere=(x,y,z)=>Math.hypot(x,y,z)-10;
const controlled=(onYield=()=>{})=>{let tick=0;return {now:()=>tick++,budgetMs:2,yieldControl:async()=>onYield()};};

test('cooperative refinement retains conforming projection, tie ordering, limits and exact statistics',async()=>{
 for(const options of [{tolerance:.04,maxPasses:3,maxTriangles:1000},{tolerance:.001,maxPasses:4,maxTriangles:73},{tolerance:.01,maxPasses:1,maxProjectionDistance:.01,maxTriangles:40}]){
  const mesh=octahedron(),expected=refineMeshSurface(mesh,sphere,options);let yields=0;
  const actual=await refineMeshSurfaceAsync(mesh,sphere,options,controlled(()=>yields++));assert.deepEqual(actual,expected);assert.ok(yields>0);
 }
 const input=model(),compiled=input.shapes.map(compileShape),field=(x,y,z)=>evaluateBase(input,x,y,z,compiled),options={tolerance:.12,maxPasses:2,maxTriangles:900000};
 assert.deepEqual(await generateMeshAsync(input,28,options,undefined,controlled()),generateMesh(input,28,options));
 const mesh=generateMesh(input,28);assert.deepEqual(await refineMeshSurfaceAsync(mesh,field,options,controlled()),refineMeshSurface(mesh,field,options));
});

test('refinement and STL serialization remain cancellable during their actual heavy loops',async()=>{
 const controller=new AbortController();let calls=0;
 const field=(x,y,z)=>{calls++;return sphere(x,y,z);};
 await assert.rejects(refineMeshSurfaceAsync(octahedron(),field,{tolerance:.01,maxPasses:4}, {...controlled(()=>{if(calls>40)controller.abort();}),signal:controller.signal}),{name:'AbortError'});
 assert.ok(calls>40,'cancellation occurred during real field analysis/projection');
 const mesh=generateMesh(model(),64),expected=binarySTL(mesh);assert.deepEqual(await binarySTLAsync(mesh,controlled()),expected);
 const stlController=new AbortController();let yields=0;
 await assert.rejects(binarySTLAsync(mesh,{...controlled(()=>{if(++yields===2)stlController.abort();}),signal:stlController.signal}),{name:'AbortError'});assert.equal(yields,2);
});

test('no-worker fallback retains full220 resolution and exact refined audit/STL outputs with genuine stage changes',async()=>{
 const input=model(),before=JSON.stringify(input),refinement={tolerance:.12,maxPasses:2,maxTriangles:900000},mesh=generateMesh(input,220,refinement),expected=auditExportMesh(input,mesh);let abort,yields=0;const stages=[];
 const result=await runExportMeshJob(input,true,'stl',value=>abort=value,{createWorker:()=>{throw Error('Module workers blocked');},onProgress:progress=>stages.push(progress),...controlled(()=>yields++)});
 assert.deepEqual(result.check.audit,expected.audit);assert.deepEqual(result.check.componentFit,expected.componentFit);assert.deepEqual(result.check.sampling,mesh.sampling);assert.equal(result.check.sampling.resolution,220);assert.deepEqual(result.check.refinement,mesh.refinement);assert.deepEqual(result.stl,binarySTL(mesh));assert.equal(abort,null);assert.ok(yields>10);assert.equal(JSON.stringify(input),before);
 assert.deepEqual(stages,[{stage:'generating'},{stage:'refining'},{stage:'checking'},{stage:'writing'}]);
});

test('failed workers fall back once and cancellation remains live after meshing has started',async()=>{
 let abort,terminated=0,posted=0,yields=0;const stages=[],fake={onmessage:null,onerror:null,postMessage(){posted++;queueMicrotask(()=>{fake.onmessage({data:{progress:{stage:'generating'}}});fake.onerror({});fake.onmessage({data:{progress:{stage:'writing'}}});fake.onerror({});});},terminate(){terminated++;}};
 const result=await runExportMeshJob(model(),false,'audit',value=>abort=value,{createWorker:()=>fake,onProgress:progress=>stages.push(progress.stage),...controlled(()=>yields++)});
 assert.equal(posted,1);assert.equal(terminated,1);assert.equal(result.check.sampling.resolution,220);assert.ok(result.check.audit.triangles>0);assert.ok(yields>10);assert.equal(abort,null);
 assert.deepEqual(stages,['generating','generating','checking'],'fallback reports its own real restart and ignores detached worker updates');
 let cancel,entered=0;
 await assert.rejects(runExportMeshJob(model(),true,'audit',value=>cancel=value,{createWorker:null,...controlled(()=>{if(++entered===3)cancel();})}),{name:'AbortError'});
 assert.equal(entered,3);assert.equal(cancel,null);
});

test('worker cancellation, authoritative errors and caller abort never launch unnecessary fallback work',async()=>{
 let cancel,terminated=0;const worker={onmessage:null,onerror:null,postMessage(){},terminate(){terminated++;}};
 const task=runExportMeshJob(model(),false,'audit',value=>cancel=value,{createWorker:()=>worker});cancel();await assert.rejects(task,{name:'AbortError'});assert.equal(terminated,1);assert.equal(cancel,null);
 const rejected={...worker,postMessage(){queueMicrotask(()=>rejected.onmessage({data:{error:'Invalid geometry'}}));}};
 await assert.rejects(runExportMeshJob(model(),false,'audit',()=>{},{createWorker:()=>rejected,yieldControl:async()=>assert.fail('geometry errors must not start fallback')}),/Invalid geometry/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(runExportMeshJob(model(),false,'audit',()=>{},{signal:controller.signal,createWorker:()=>{assert.fail('already cancelled tasks must not create a worker');}}),{name:'AbortError'});
});

test('the default no-worker fallback delivers real timer input before a full-resolution export finishes',async()=>{
 const controller=new AbortController();let inputDelivered=false,abort;
 const pending=runExportMeshJob(model(),true,'stl',value=>abort=value,{signal:controller.signal,createWorker:null});
 const timer=setTimeout(()=>{inputDelivered=true;controller.abort();},0);
 try{await assert.rejects(pending,{name:'AbortError'});assert.equal(inputDelivered,true);assert.equal(abort,null);}
 finally{clearTimeout(timer);}
});

test('worker progress is validated, never completes the job and stops after the final result',async()=>{
 let abort,settled=false,terminated=0;const stages=[],worker={onmessage:null,onerror:null,postMessage(){},terminate(){terminated++;}};
 const pending=runExportMeshJob(model(),true,'stl',value=>abort=value,{createWorker:()=>worker,onProgress:progress=>stages.push(progress)});
 pending.then(()=>settled=true);
 for(const progress of [{stage:'generating'},{stage:'invented'},{stage:'refining',completed:Infinity,total:10},{stage:'checking',completed:12,total:10},{stage:'refining',completed:2,total:10}])worker.onmessage({data:{id:1,progress}});
 await Promise.resolve();assert.equal(settled,false);assert.equal(typeof abort,'function');assert.equal(terminated,0);
 assert.deepEqual(stages,[{stage:'generating'},{stage:'refining',completed:2,total:10}]);
 const check={audit:{triangles:1},milliseconds:8},stl=new ArrayBuffer(4);worker.onmessage({data:{id:1,check,stl}});
 assert.deepEqual(await pending,{check,stl});assert.equal(abort,null);assert.equal(terminated,1);
 worker.onmessage({data:{id:1,progress:{stage:'writing'}}});assert.equal(stages.length,2);
});

test('worker cancellation drops late progress and results without restarting work',async()=>{
 let abort,terminated=0;const stages=[],worker={onmessage:null,onerror:null,postMessage(){},terminate(){terminated++;}};
 const pending=runExportMeshJob(model(),false,'stl',value=>abort=value,{createWorker:()=>worker,onProgress:progress=>stages.push(progress.stage),yieldControl:async()=>assert.fail('cancellation must not restart fallback')});
 worker.onmessage({data:{progress:{stage:'generating'}}});abort();
 worker.onmessage({data:{progress:{stage:'writing'}}});worker.onmessage({data:{check:{}}});worker.onerror({});
 await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(stages,['generating']);assert.equal(terminated,1);assert.equal(abort,null);
});

test('a cooperative cancellation has no later stage reports',async()=>{
 let abort,yields=0;const stages=[];
 const pending=runExportMeshJob(model(),true,'stl',value=>abort=value,{createWorker:null,onProgress:progress=>stages.push(progress.stage),...controlled(()=>{if(++yields===2)abort();})});
 await assert.rejects(pending,{name:'AbortError'});await Promise.resolve();
 assert.deepEqual(stages,['generating']);assert.equal(yields,2);assert.equal(abort,null);
});
