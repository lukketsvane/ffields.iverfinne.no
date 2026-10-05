import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MODEL,cloneModel,validateModel,generateMesh,generateMeshAsync,generatePreviewMesh,evaluateBase,binarySTL} from '../lib/form-engine.ts';
import {solidComponents} from '../lib/solid-components.ts';
import {makeShape,compileShape} from '../lib/shapes.ts';
import {applyConstructionCommand} from '../lib/construction.ts';
import {generateExportMesh,generateExportMeshAsync} from '../lib/export-progress.ts';
import {auditMesh} from '../lib/mesh-audit.ts';
import {createCameraPodStudy,upgradeCameraPodStudy} from '../lib/camera-pod-study.ts';
import {quickShape} from '../lib/quick-modelling.ts';
const sphere=(id,x,extra={})=>({...makeShape('sphere'),id,x,y:0,z:0,width:24,height:24,depth:24,blend:0,...extra});
const assembly=()=>({...cloneModel(DEFAULT_MODEL),baseEnabled:false,influences:[],asymmetry:0,shapes:[sphere('base',0),sphere('part',10,{componentId:'part'}),sphere('cut',10,{componentId:'part',operation:'subtract',width:8,height:8,depth:40})]});
function closed(mesh,count){const report=auditMesh(mesh);assert.equal(report.components,count);assert.ok(report.triangles>0);for(const key of ['boundaryEdges','nonManifoldEdges','inconsistentWindingEdges','degenerateTriangles','invalidIndices'])assert.equal(report[key],0,key);assert.equal(report.finite,true);}
test('overlapping solids keep complete separate closed topology and scoped cuts',async()=>{
 const model=validateModel(assembly()),before=JSON.stringify(model),parts=solidComponents(model),mesh=generateMesh(model,28);
 assert.equal(parts.length,2);closed(mesh,2);assert.equal(mesh.components.length,2);
 assert.ok(evaluateBase(parts[0].model,10,0,0)<0);assert.ok(evaluateBase(parts[1].model,10,0,0)>0);assert.ok(evaluateBase(model,10,0,0)<0);
 const compiled=model.shapes.map(compileShape);assert.equal(evaluateBase(model,10,0,0,compiled),evaluateBase(model,10,0,0));
 assert.deepEqual(await generateMeshAsync(model,28),mesh);closed(generatePreviewMesh(model,28),2);
 const refinement={tolerance:.15,maxPasses:1,maxTriangles:40000},exported=generateExportMesh(model,28,refinement);closed(exported,2);assert.deepEqual(await generateExportMeshAsync(model,28,refinement),exported);
 for(const part of parts){const individual=generateExportMesh(part.model,28,refinement);closed(individual,1);assert.equal(binarySTL(individual).byteLength,84+individual.indices.length/3*50);}
 assert.equal(JSON.stringify(model),before);
});
test('component root translation and rotation carry every cut and preserve other solids',()=>{
 const model=assembly(),moved=applyConstructionCommand(model,{action:'update',id:'part',patch:{x:30,z:12,rx:30,ry:20,rz:40}});
 assert.deepEqual(moved.shapes[0],model.shapes[0]);assert.equal(moved.shapes[2].x,30);assert.equal(moved.shapes[2].z,12);assert.ok(Math.abs(moved.shapes[2].rx-30)<1e-8);
 assert.equal(quickShape(moved,'cylinder','subtract','part').componentId,'part');
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(moved))),moved);
 const removed=applyConstructionCommand(moved,{action:'remove',id:'part'});assert.deepEqual(removed.shapes,[model.shapes[0]]);
});
test('separate and assign actions validate ownership atomically',()=>{
 const original=assembly();for(const shape of original.shapes)delete shape.componentId;
 const split=applyConstructionCommand(original,{action:'separate-solid',ids:['part','cut']});assert.equal(split.shapes[2].componentId,'part');
 assert.throws(()=>applyConstructionCommand(split,{action:'assign-solid',ids:['part'],componentId:'body'}),/every shape/);
 const merged=applyConstructionCommand(split,{action:'assign-solid',ids:['part','cut'],componentId:'body'});assert.deepEqual(merged,validateModel(original));
 for(const owner of [null,42,'missing','cut']){const invalid=assembly();invalid.shapes[1].componentId=owner;assert.throws(()=>validateModel(invalid),/component/);}
 assert.throws(()=>applyConstructionCommand(original,{action:'separate-solid',ids:['cut']}),/Merge/);
});
test('new camera has two closed components and a positive receiving-pocket gap',()=>{
 const camera=createCameraPodStudy(),parts=solidComponents(camera);assert.equal(camera.shapes.length,20);assert.deepEqual(parts.map(p=>p.shapeIds.length),[16,4]);
 for(const part of parts)closed(generateMesh(part.model,60),1);closed(generateMesh(camera,60),2);
 const plate=generateMesh(parts[1].model,48),compiled=parts[0].model.shapes.map(compileShape);let gap=Infinity;
 for(let i=0;i<plate.positions.length;i+=3)gap=Math.min(gap,evaluateBase(parts[0].model,...plate.positions.slice(i,i+3),compiled));
 assert.ok(gap>.20,'all plate vertices clear the body: '+gap);
 assert.deepEqual(upgradeCameraPodStudy(createCameraPodStudy(false)),camera);const edited=createCameraPodStudy(false);edited.shapes[0].width+=1;assert.deepEqual(upgradeCameraPodStudy(edited),edited);
});
test('abort stops assembly meshing between cooperative slices',async()=>{const controller=new AbortController();let clock=0;await assert.rejects(generateMeshAsync(assembly(),40,undefined,undefined,{signal:controller.signal,budgetMs:1,now:()=>clock++,yieldControl:async()=>controller.abort()}),{name:'AbortError'});});

test('component copies and mirrors carry their own cuts',()=>{const source=assembly();for(const command of [{action:'duplicate-solid',id:'part',newId:'copy'},{action:'mirror',id:'part',axis:'x',newId:'copy'}]){const result=applyConstructionCommand(source,command),copy=solidComponents(result).find(part=>part.id==='copy');assert.equal(copy.shapeIds.length,2);assert.equal(copy.model.shapes[1].operation,'subtract');assert.equal(copy.model.shapes[1].x,command.action==='mirror'?-10:28);}});
