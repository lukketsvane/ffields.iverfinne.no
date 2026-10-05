import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeshSamplingGrid} from '../lib/mesh-sampling.ts';
import {generateMesh,modelBounds} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {blankConstruction,applyConstructionCommand as apply} from '../lib/construction.ts';
import {createStereoCameraStudy} from '../lib/stereo-camera-study.ts';
import {auditExportMesh} from '../lib/component-fit.ts';

const box=(id,patch={})=>({...makeShape('box'),id,x:0,y:0,z:0,rx:0,ry:0,rz:0,width:100,height:50,depth:18,roundness:0,blend:0,...patch});
const corridors=()=>({...blankConstruction(),lenses:false,shell:false,usb:false,buttons:false,fingerGrooves:false,shapes:[
 box('mass',{blend:1}),box('rear',{width:94,height:44,depth:61,z:-15,operation:'subtract'}),box('front',{width:94,height:44,depth:32,z:23.5,operation:'subtract'}),
]});
const union=patch=>box('later',{width:20,height:20,depth:4,z:-28,roundness:1,...patch});
const grid=model=>createMeshSamplingGrid(model,modelBounds(model,false),96);
const alignedAt=(sampling,axis,face)=>[face-.002,face+.002].every(value=>sampling.coordinates[axis].some(v=>Math.abs(v-value)<1e-10));

test('disjoint hard unions retain hidden-cap pruning while overlapping, touching and blended unions do not',()=>{
 const base=corridors(),late=union(),model={...base,shapes:[...base.shapes,late]},before=JSON.stringify(model),sampling=grid(model);
 for(const face of [7.5,15.5])assert.equal(alignedAt(sampling,2,face),false,'insertion blocker is disjoint from hidden caps');
 for(const face of [-47,47])assert.equal(alignedAt(sampling,0,face),true,'camera side faces remain aligned');assert.equal(JSON.stringify(model),before);
 for(const patch of [{z:7.5},{z:3.5,depth:8},{blend:1}]){
  const modified={...base,shapes:[...base.shapes,union(patch)]};assert.equal(alignedAt(grid(modified),2,7.5),true,'overlapping/touching bounds or nonzero blend conservatively retain the cap plane');
 }
 const disabled={...base,shapes:[...base.shapes,union({z:7.5,enabled:false})]};assert.equal(alignedAt(grid(disabled),2,7.5),false,'disabled unions do not restore material');
 const distantRotated={...base,shapes:[...base.shapes,union({rx:31,ry:19,rz:-11})]};assert.equal(alignedAt(grid(distantRotated),2,7.5),false,'conservative rotated world bounds can also establish disjointness');
});

test('cap proof uses the covering cut original index and rejects post-CSG lens seats',()=>{
 const base=corridors(),[mass,rear,front]=base.shapes,overlap=union({z:7.5});
 const between={...base,shapes:[mass,rear,overlap,front]};assert.equal(alignedAt(grid(between),2,7.5),true,'a union after covering rear cut but before target front cut may restore its cap');
 const beforeCover={...base,shapes:[mass,front,overlap,rear]};assert.equal(alignedAt(grid(beforeCover),2,7.5),false,'later covering cut removes an earlier union again');
 const lenses={...base,lenses:true};assert.equal(alignedAt(grid(lenses),2,7.5),true,'lens seats unioned after all shape cuts prohibit a hidden-cap proof');assert.equal(alignedAt(grid(lenses),2,15.5),true);
 const noChange=grid(base),unionsBeforeCuts=grid({...base,shapes:[mass,union(),rear,front]});for(const face of [7.5,15.5]){assert.equal(alignedAt(noChange,2,face),false);assert.equal(alignedAt(unionsBeforeCuts,2,face),false,'ordinary final cuts retain cap pruning');}
});

test('sampling accepts only the bounded bracket offsets and reports the actual grid',()=>{
 const model=corridors(),bounds=modelBounds(model,false),defaultGrid=createMeshSamplingGrid(model,bounds,96),explicit=createMeshSamplingGrid(model,bounds,96,{facePlaneOffset:.002}),wide=createMeshSamplingGrid(model,bounds,96,{facePlaneOffset:.02});assert.deepEqual(explicit,defaultGrid,'default .002 behavior is unchanged');assert.equal(wide.sampling.facePlaneOffset,.02);
 for(const offset of [0,.001,.01,.03,-.02,NaN,Infinity,'0.02',null])assert.throws(()=>createMeshSamplingGrid(model,bounds,96,{facePlaneOffset:offset}),/offset/);
 const disabled=createMeshSamplingGrid(model,bounds,96,{featurePlanes:false,facePlaneOffset:.02});assert.equal(disabled.sampling.featureAligned,false);assert.equal(disabled.sampling.facePlaneOffset,undefined);assert.equal(disabled.sampling.skippedReason,'disabled');
 for(const patch of [{shell:true},{asymmetry:1},{lattice:{enabled:true}}]){const unsupported=createMeshSamplingGrid({...model,...patch},bounds,96,{facePlaneOffset:.02});assert.equal(unsupported.sampling.featureAligned,false);assert.equal(unsupported.sampling.facePlaneOffset,undefined);}
});

for(const resolution of [96,220])test(`stereo insertion-only blocker preserves both captured seats at resolution ${resolution}`,()=>{
 const original=createStereoCameraStudy(),model=apply(original,{action:'add',shape:{id:'insertion-blocker',name:'Insertion-only blocker',kind:'box',operation:'union',blend:0,x:-36,y:0,z:-28,width:20,height:20,depth:4,roundness:0}}),before=JSON.stringify(model),mesh=generateMesh(model,resolution),{audit,componentFit}=auditExportMesh(model,mesh);
 assert.equal(audit.components,2,'the added blocker is intentionally a second disconnected solid');for(const key of ['boundaryEdges','nonManifoldEdges','inconsistentWindingEdges','degenerateTriangles','invalidIndices'])assert.equal(audit[key],0,key);assert.equal(audit.finite,true);assert.equal(componentFit.meshVerified,true);
 assert.equal(mesh.sampling.featureAligned,true,'unrelated union does not force loss of dimensional planes');assert.deepEqual(mesh.sampling.addedPlanes,resolution===220?[11,8,4]:[12,8,4]);assert.equal(mesh.sampling.facePlaneOffset,resolution===220?.02:.002);assert.equal(mesh.sampling.budgetLimited,false);
 if(resolution===220){assert.equal(mesh.sampling.quantizationLimited,true);assert.deepEqual(mesh.sampling.gridPhase,[.173,.223,.265]);}
 const left=componentFit.components.find(row=>row.assetId==='stereo-camera-left'),right=componentFit.components.find(row=>row.assetId==='stereo-camera-right');for(const row of [left,right]){assert.deepEqual(row.testedClearance,[.45,.45,.45]);assert.equal(row.seat.status,'clear');assert.equal(row.seat.surfaceTriangleCount,0);assert.equal(row.seat.centreInside,false);}
 assert.equal(left.insertion.status,'interference');assert.ok(left.insertion.surfaceTriangleCount>0,'captured triangles detect the real insertion obstruction');assert.equal(right.insertion.status,'clear');assert.equal(right.insertion.surfaceTriangleCount,0);assert.equal(right.insertion.centreInside,false);assert.equal(JSON.stringify(model),before,'sampling and checking do not change authored geometry');assert.equal(original.shapes.length+1,model.shapes.length);
 console.log(JSON.stringify({resolution,triangles:audit.triangles,volume:audit.volume,alignedPlanes:mesh.sampling.addedPlanes,gridPhase:mesh.sampling.gridPhase,quantizationLimited:mesh.sampling.quantizationLimited,leftInsertionTriangles:left.insertion.surfaceTriangleCount}));
});
