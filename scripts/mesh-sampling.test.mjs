import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeshSamplingGrid} from '../lib/mesh-sampling.ts';
import {DEFAULT_MODEL,cloneModel,generateMesh,evaluateBase,modelBounds,makeInfluence} from '../lib/form-engine.ts';
import {makeShape,compileShape} from '../lib/shapes.ts';
import {auditMesh} from '../lib/mesh-audit.ts';
import {createStereoCameraStudy} from '../lib/stereo-camera-study.ts';
import {stereoEnvelopeCollisions} from './stereo-geometry-check.mjs';

const rim=()=>({...cloneModel(DEFAULT_MODEL),baseEnabled:false,influences:[],asymmetry:0,shapes:[
 {...makeShape('box'),id:'outer',x:0,y:0,z:0,width:100,height:50,depth:18,roundness:0,blend:0},
 {...makeShape('box'),id:'cavity',x:0,y:0,z:0,width:94,height:44,depth:22,roundness:0,blend:0,operation:'subtract'},
]});
const residuals=(model,mesh)=>{
 const compiled=model.shapes.map(compileShape),field=(x,y,z)=>evaluateBase(model,x,y,z,compiled),p=mesh.positions,ids=mesh.indices;
 let maxFace=0,maxEdge=0;
 for(let i=0;i<ids.length;i+=3){
  const a=ids[i]*3,b=ids[i+1]*3,c=ids[i+2]*3;
  maxFace=Math.max(maxFace,Math.abs(field((p[a]+p[b]+p[c])/3,(p[a+1]+p[b+1]+p[c+1])/3,(p[a+2]+p[b+2]+p[c+2])/3)));
  for(const [u,v]of[[a,b],[b,c],[c,a]])maxEdge=Math.max(maxEdge,Math.abs(field((p[u]+p[v])/2,(p[u+1]+p[v+1])/2,(p[u+2]+p[v+2])/2)));
 }
 return {maxFace,maxEdge};
};
const assertClosed=mesh=>{const report=auditMesh(mesh);assert.equal(report.components,1);assert.equal(report.boundaryEdges,0);assert.equal(report.nonManifoldEdges,0);assert.equal(report.inconsistentWindingEdges,0);assert.equal(report.degenerateTriangles,0);assert.equal(report.invalidIndices,0);assert.equal(report.finite,true);return report;};

test('feature-aligned sharp case rim preserves the analytic cavity and substantially reduces face error',()=>{
 const model=rim(),before=JSON.stringify(model),uniform=generateMesh(model,72,undefined,{featurePlanes:false}),aligned=generateMesh(model,72),old=residuals(model,uniform),now=residuals(model,aligned);
 const exactVolume=(100*50-94*44)*18,report=assertClosed(aligned);assertClosed(uniform);
 assert.ok(old.maxFace>.3&&old.maxEdge>.5,'the fixture exercises a genuinely unresolved uniform-grid corner');
 assert.ok(now.maxFace<.004&&now.maxEdge<.004,JSON.stringify({old,now}));
 assert.ok(now.maxFace<old.maxFace*.01&&now.maxEdge<old.maxEdge*.01,'both worst sampled face and edge errors improve, not only the mean');
 assert.ok(Math.abs(report.volume-exactVolume)<.1,`known rectangular rim volume ${report.volume} != ${exactVolume}`);
 assert.deepEqual(report.dimensions,[100,50,18]);
 assert.equal(aligned.sampling.featureAligned,true);assert.equal(uniform.sampling.featureAligned,false);
 assert.ok(aligned.sampling.addedPlanes.some(v=>v>0));
 const baseline=uniform.sampling.cells.map(v=>v+1).reduce((a,b)=>a*b,1),samples=aligned.sampling.cells.map(v=>v+1).reduce((a,b)=>a*b,1);
 assert.ok(samples<=Math.floor(baseline*1.75));
 assert.equal(JSON.stringify(model),before,'sampling does not change the authored model');
});

test('face-straddling planes avoid float32 collapsed corners when the ordinary grid lands exactly on a face',()=>{
 const model=rim(),mesh=generateMesh(model,108),report=assertClosed(mesh);
 assert.ok(Math.abs(report.volume-15552)<.1);
 const grid=createMeshSamplingGrid(model,modelBounds(model,false),108);
 for(const [axis,faces]of[[0,[-50,-47,47,50]],[1,[-25,-22,22,25]],[2,[-9,9]]])for(const face of faces){
  assert.ok(!grid.coordinates[axis].some(v=>Math.abs(v-face)<1e-10),'the sampling node is not an exact zero of an authored face');
 }
});

test('sampling falls back for unsupported rotated, blended and globally deformed faces',()=>{
 const base=rim();
 for(const patch of [{asymmetry:1},{shell:true},{lattice:{enabled:true}},{influences:[{...makeInfluence('twist'),enabled:true,strength:8}]}]){
  const model={...base,...patch},grid=createMeshSamplingGrid(model,modelBounds(base,false),72);
  assert.equal(grid.sampling.featureAligned,false);assert.deepEqual(grid.sampling.addedPlanes,[0,0,0]);assert.ok(grid.sampling.skippedReason);
 }
 for(const shapePatch of [{rx:1},{ry:90},{rz:-19},{blend:1},{roundness:.4}]){
  const model={...base,shapes:base.shapes.map(s=>({...s,...shapePatch}))};
  assert.equal(createMeshSamplingGrid(model,modelBounds(model,false),72).sampling.featureAligned,false);
 }
 const disabled=createMeshSamplingGrid(base,modelBounds(base,false),72,{featurePlanes:false});assert.equal(disabled.sampling.skippedReason,'disabled');
});

test('additional sampling is bounded and reported for dense collections of sharp faces',()=>{
 const model=rim();model.shapes=Array.from({length:32},(_,i)=>({...model.shapes[0],id:'box-'+i,width:12+i*1.3,height:10+i*1.1,depth:8+i*.8,x:i*.37,y:i*.41,z:i*.31}));
 const bounds=modelBounds(model,false),baseline=createMeshSamplingGrid(model,bounds,52,{featurePlanes:false}),aligned=createMeshSamplingGrid(model,bounds,52);
 const samples=aligned.coordinates.reduce((n,axis)=>n*axis.length,1),original=baseline.coordinates.reduce((n,axis)=>n*axis.length,1);
 assert.ok(samples<=Math.floor(original*1.75));assert.equal(aligned.sampling.budgetLimited,true);
 assert.ok(aligned.sampling.featureAligned);assert.ok(aligned.sampling.addedPlanes.every(v=>v<=24));
 for(let axis=0;axis<3;axis++){
  const coords=aligned.coordinates[axis];assert.equal(coords[0],bounds[axis]);assert.equal(coords.at(-1),bounds[axis+3]);
  assert.ok(coords.every((v,i)=>Number.isFinite(v)&&(!i||v>coords[i-1])));
  assert.ok(aligned.sampling.maxSpacing[axis]<=aligned.sampling.nominalSpacing[axis]+1e-10,'authored face planes retain the ordinary sampling density');
 }
 for(const bounds of [[0,0,0,0,1,1],[0,0,NaN,1,1,1],[0,1]])assert.throws(()=>createMeshSamplingGrid(model,bounds,52));
 assert.throws(()=>createMeshSamplingGrid(model,modelBounds(model,false),NaN));
});

test('sampling metadata remains attached to refined export geometry',()=>{
 const model=rim(),mesh=generateMesh(model,32,{tolerance:.04,maxPasses:0});
 assert.ok(mesh.refinement);assert.ok(mesh.sampling);assert.equal(mesh.sampling.featureAligned,true);assertClosed(mesh);
});

test('overlapping rear and front corridors do not add planes at their hidden internal caps',()=>{
 const model=rim();model.shapes=[{...model.shapes[0],blend:1},
  {...model.shapes[1],id:'rear',z:-15,depth:61},
  {...model.shapes[1],id:'front',z:23.5,depth:32}];
 const grid=createMeshSamplingGrid(model,modelBounds(model,false),72);
 for(const face of [7.5,15.5])for(const coordinate of grid.coordinates[2])assert.ok(Math.abs(coordinate-face)>.0019,'an overlapped cap is not a surviving surface');
 assert.equal(grid.sampling.featureAligned,true);assert.equal(grid.sampling.facePlaneOffset,.002);
});

test('a real camera variant retries quantized tiny cells while retaining dimensional face planes',()=>{
 const model=createStereoCameraStudy({cameraWidth:68,cameraHeight:48,cameraDepth:38,baseline:86,clearance:.8,wall:4}),before=JSON.stringify(model);
 const mesh=generateMesh(model,72,{tolerance:.12,maxPasses:0}),direct=generateMesh(model,72,undefined,{featurePlanes:true,gridPhase:[.173,.223,.265]});
 assertClosed(mesh);assert.equal(mesh.sampling.quantizationLimited,true);assert.equal(mesh.sampling.featureAligned,true);assert.equal(mesh.sampling.skippedReason,undefined);
 assert.deepEqual(mesh.sampling.gridPhase,[.173,.223,.265]);
 assert.deepEqual(mesh.indices,direct.indices);assert.deepEqual(mesh.positions,direct.positions,'regeneration produces the complete phased surface rather than deleting bad faces');
 assert.ok(mesh.refinement);assert.equal(mesh.refinement.degenerateInputTriangles,0);
 for(const centre of [-43,43])for(const x of [-34,0,34])for(const y of [-24,0,24])for(const z of [-19,0,19])assert.ok(evaluateBase(model,centre+x,y,z)>=.799,'authored component clearance remains intact');
 assert.equal(JSON.stringify(model),before);
});

test('the production-resolution stereo mesh resolves float32 collapse and keeps both measured reference seats empty',()=>{
 const model=createStereoCameraStudy(),mesh=generateMesh(model,220),report=assertClosed(mesh),seats=stereoEnvelopeCollisions(mesh);
 assert.equal(mesh.sampling.quantizationLimited,true,'the ordinary aligned grid collapses two Float32 faces in this fixture');
 assert.equal(mesh.sampling.featureAligned,true,'phase retry retains the authored dimensional planes');
 assert.deepEqual(mesh.sampling.gridPhase,[.173,.223,.265]);assert.equal(mesh.sampling.facePlaneOffset,.002);
 assert.equal(seats.triangleHardwareCollisions,0,'no exported triangle crosses either reference envelope plus .45 mm clearance');
 assert.equal(seats.requiredPerSideClearance,.45);
 assert.ok(report.dimensions[0]>147&&report.dimensions[0]<149);
});
