import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneModel,DEFAULT_MODEL,generateMesh,binarySTL} from '../lib/form-engine.ts';
import {applyConstructionCommand,blankConstruction} from '../lib/construction.ts';
import {makeShape} from '../lib/shapes.ts';
import {generateExportMesh,generateExportMeshAsync,isExportMeshProgress,exportMeshStageLabel} from '../lib/export-progress.ts';

const refinement={tolerance:.12,maxPasses:2,maxTriangles:900000};
const controlled=()=>{let now=0;return {now:()=>now++,budgetMs:3,yieldControl:async()=>{}};};
const attached=()=>{
 let model={...blankConstruction(),shapes:[{...makeShape('box'),id:'socket',x:18,y:8,z:5,width:24,height:20,depth:16,blend:0},{...makeShape('sweep'),id:'rib',x:-20,y:0,z:0,path:[{x:-20,y:0,z:0,radius:4},{x:0,y:8,z:0,radius:5},{x:20,y:0,z:0,radius:4}],blend:3}]};
 model=applyConstructionCommand(model,{action:'attach',sweepId:'rib',endpoint:'end',targetShapeId:'socket',anchor:'center',offset:{x:0,y:0,z:0}});
 return {...model,shapes:model.shapes.map(shape=>shape.id==='socket'?{...shape,x:27,rz:23}:shape)};
};

test('export stage boundaries retain exact refined wave and stale-attachment geometry in both paths',async()=>{
 for(const input of [cloneModel(DEFAULT_MODEL),attached()]){
  const original=JSON.stringify(input),expected=generateMesh(input,26,refinement),workerStages=[],fallbackStages=[];
  const synchronous=generateExportMesh(input,26,refinement,progress=>workerStages.push(progress));
  const cooperative=await generateExportMeshAsync(input,26,refinement,{...controlled(),onProgress:progress=>fallbackStages.push(progress)});
  assert.deepEqual(synchronous,expected);assert.deepEqual(cooperative,expected);assert.deepEqual(binarySTL(cooperative),binarySTL(expected));
  assert.deepEqual(workerStages,[{stage:'generating'},{stage:'refining'}]);assert.deepEqual(fallbackStages,workerStages);assert.equal(JSON.stringify(input),original);
 }
});

test('standard surface generation omits refinement and reports no invented counters',async()=>{
 const input=cloneModel(DEFAULT_MODEL),stages=[],actual=await generateExportMeshAsync(input,24,undefined,{...controlled(),onProgress:progress=>stages.push(progress)});
 assert.deepEqual(actual,generateMesh(input,24));assert.deepEqual(stages,[{stage:'generating'}]);
});

test('progress messages accept only known stages and valid optional measured counts',()=>{
 for(const stage of ['generating','refining','checking','writing']){assert.equal(isExportMeshProgress({stage}),true);assert.ok(exportMeshStageLabel(stage).length>0);}
 assert.equal(isExportMeshProgress({stage:'writing',completed:0,total:100}),true);
 assert.equal(isExportMeshProgress({stage:'writing',completed:100,total:100}),true);
 for(const value of [null,42,{}, {stage:'finished'},{stage:'generating',completed:-1},{stage:'generating',completed:.5},{stage:'generating',completed:Infinity},{stage:'generating',total:0},{stage:'generating',total:NaN},{stage:'generating',completed:6,total:5}])assert.equal(isExportMeshProgress(value),false);
});

test('cancelling in the refinement stage callback stops before further surface analysis',async()=>{
 const controller=new AbortController(),stages=[];
 const pending=generateExportMeshAsync(cloneModel(DEFAULT_MODEL),18,refinement,{...controlled(),signal:controller.signal,onProgress:progress=>{stages.push(progress.stage);if(progress.stage==='refining')controller.abort();}});
 await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(stages,['generating','refining']);
});
