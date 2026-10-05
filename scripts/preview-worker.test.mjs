import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {cloneModel,DEFAULT_MODEL,generateMesh,generatePreviewMesh,evaluateBase,clamp} from '../lib/form-engine.ts';
import {compileShape,makeShape} from '../lib/shapes.ts';
import {previewAmbientOcclusion} from '../lib/preview-shading.ts';
import {previewRefinement} from '../lib/preview-scheduler.ts';
import {createCameraPodStudy} from '../lib/camera-pod-study.ts';
import {generateMeshAsync} from '../lib/form-engine.ts';

test('worker-side AO preserves the existing field shading and can abort between probes',async()=>{
 const model={...cloneModel(DEFAULT_MODEL),influences:[],asymmetry:0,baseEnabled:false,shapes:[{...makeShape('torus'),x:0,y:0,z:0,blend:0,width:32,height:12,depth:32,roundness:.4}]},mesh=generateMesh(model,32),before=JSON.stringify(model),shapes=model.shapes.map(compileShape),expected=new Float32Array(mesh.positions.length/3);
 for(let i=0;i<expected.length;i++){
  const p=i*3;let occ=0;for(const d of [2,5,10])occ+=Math.max(0,1-evaluateBase(model,mesh.positions[p]+mesh.normals[p]*d,mesh.positions[p+1]+mesh.normals[p+1]*d,mesh.positions[p+2]+mesh.normals[p+2]*d,shapes)/d);expected[i]=1-clamp(occ*.1,0,.2);
 }
 let tick=0,yields=0;const ao=await previewAmbientOcclusion(model,mesh,{now:()=>tick++,budgetMs:2,yieldControl:async()=>{yields++;}});
 assert.deepEqual(ao,expected);assert.ok(yields>10);assert.ok(ao.some(v=>v<.99),'the torus inner surface has actual concavity shading');assert.ok(ao.every(v=>v>=.8&&v<=1));assert.equal(JSON.stringify(model),before);
 const controller=new AbortController();tick=0;
 await assert.rejects(previewAmbientOcclusion(model,mesh,{signal:controller.signal,now:()=>tick++,budgetMs:1,yieldControl:async()=>controller.abort()}),{name:'AbortError'});
});

test('real worker protocol cancels an in-progress preview, then completes the newest draft and unchanged audit',async()=>{
 // Transpile the actual worker source, changing only module URLs so Node can
 // run its browser message handler. No copied worker algorithm or fake mesh.
 const workerUrl=new URL('../lib/form-worker.ts',import.meta.url),source=await readFile(workerUrl,'utf8');
 const resolved=source.replace(/from '\.\/([^']+)'/g,(_match,name)=>`from '${new URL(name+'.ts',workerUrl).href}'`),output=ts.transpileModule(resolved,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const messages=[],surface={onmessage:null,postMessage:(message,options)=>messages.push({message,options})},previous=globalThis.self;globalThis.self=surface;
 try{
  await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
  const model={...cloneModel(DEFAULT_MODEL),influences:[],asymmetry:0};
  const old=surface.onmessage({data:{id:1,model,resolution:96,shading:true}});
  await surface.onmessage({data:{cancel:1}});await old;
  assert.equal(messages.length,1);assert.deepEqual(messages[0].message,{id:1,aborted:true});
  await surface.onmessage({data:{id:2,model,resolution:28,draft:true,shading:true}});
  const draft=messages.at(-1).message;assert.equal(draft.id,2);assert.equal(draft.ao,undefined,'interaction ignores requested settled shading');assert.ok(Number.isFinite(draft.milliseconds));assert.deepEqual(draft.mesh,generatePreviewMesh(model,28));assert.equal(messages.at(-1).options.transfer.length,3);
  await surface.onmessage({data:{id:3,model,resolution:28,shading:true}});
  const settled=messages.at(-1).message;assert.deepEqual(settled.mesh,generateMesh(model,28,previewRefinement(false)));assert.equal(settled.ao.length,settled.mesh.positions.length/3);assert.equal(messages.at(-1).options.transfer.length,4);
  await surface.onmessage({data:{id:4,model,resolution:28,task:'audit',draft:true,shading:true}});
  const audit=messages.at(-1).message;assert.equal(audit.id,4);assert.equal(audit.mesh,undefined);assert.equal(audit.check.audit.triangles,generateMesh(model,28).indices.length/3);assert.equal(audit.check.audit.boundaryEdges,0);
 }finally{if(previous===undefined)delete globalThis.self;else globalThis.self=previous;}
});

test('fine surface streaming includes every current camera component before refinement without changing final geometry',async()=>{
 const model=createCameraPodStudy(),before=JSON.stringify(model),frames=[];
 const final=await generateMeshAsync(model,32,previewRefinement(false),undefined,{budgetMs:8,yieldControl:async()=>{},onSurface:mesh=>frames.push(mesh)});
 assert.equal(frames.length,1,'only the complete model is streamed');
 assert.deepEqual(frames[0],generateMesh(model,32),'the intermediate frame has accurate roots at the same fine grid');
 assert.deepEqual(frames[0].components.map(c=>c.id),['body','colani-lens-plate']);
 assert.deepEqual(final,generateMesh(model,32,previewRefinement(false)),'streaming cannot change the final mesh or component-scoped refinement');
 assert.ok(final.components.every(c=>c.refinement));assert.equal(JSON.stringify(model),before);
 const controller=new AbortController();let count=0;
 await assert.rejects(generateMeshAsync(model,32,previewRefinement(false),undefined,{signal:controller.signal,yieldControl:async()=>{},onSurface:()=>{count++;controller.abort();}}),{name:'AbortError'});
 assert.equal(count,1,'superseding the streamed surface stops the actual queued refinement');
});

test('worker intermediate fine surface does not transfer live refinement buffers or masquerade as a completed result',async()=>{
 const workerUrl=new URL('../lib/form-worker.ts',import.meta.url),source=await readFile(workerUrl,'utf8');
 const resolved=source.replace(/from '\.\/([^']+)'/g,(_match,name)=>`from '${new URL(name+'.ts',workerUrl).href}'`),output=ts.transpileModule(resolved,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const messages=[],surface={onmessage:null,postMessage:(message,options)=>messages.push({message,options})},previous=globalThis.self;globalThis.self=surface;
 try{
  await import('data:text/javascript;base64,'+Buffer.from(output+'\n// intermediate-stage-test').toString('base64'));
  const model={...cloneModel(DEFAULT_MODEL),influences:[],asymmetry:0};
  await surface.onmessage({data:{id:81,model,resolution:28,streamSurface:true,shading:true}});
  assert.equal(messages.length,2);assert.equal(messages[0].message.stage,'surface');assert.equal(messages[0].message.id,81);
  assert.equal(messages[0].options,undefined,'intermediate buffers remain owned by refinement');
  assert.deepEqual(messages[0].message.mesh,generateMesh(model,28));
  assert.equal(messages[1].message.stage,undefined);assert.ok(messages[1].message.ao);assert.equal(messages[1].options.transfer.length,4);
 }finally{if(previous===undefined)delete globalThis.self;else globalThis.self=previous;}
});
