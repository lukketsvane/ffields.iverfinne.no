import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Matrix4,Vector3} from 'three';
import {auditMesh,auditMeshAsync} from '../lib/mesh-audit.ts';
import {auditExportMesh,auditExportMeshAsync} from '../lib/component-fit.ts';
import {applyConstructionCommand as apply,blankConstruction} from '../lib/construction.ts';
import {createStereoCameraStudy} from '../lib/stereo-camera-study.ts';
import {generateMesh} from '../lib/form-engine.ts';

const asset=(patch={})=>({id:'camera',sourceId:'gopro-hd-hero',name:'Measured camera',visible:true,x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1,envelope:[4,4,4],...patch});
const model=(camera=asset())=>apply(blankConstruction(),{action:'add-component',asset:camera});
const mesh=(positions,indices)=>({positions:new Float32Array(positions),normals:new Float32Array(positions.length),indices:new Uint32Array(indices),bounds:[0,0,0,0,0,0],volume:0});
function cube(dimensions=[10,10,10],position=[0,0,0],angles=[0,0,0]){
 const [x,y,z]=dimensions.map(value=>value/2),matrix=new Matrix4().makeRotationFromEuler(new Euler(...angles.map(value=>value*Math.PI/180),'XYZ'));
 const points=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].flatMap(point=>new Vector3(...point).applyMatrix4(matrix).add(new Vector3(...position)).toArray());
 return mesh(points,[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
}
function combine(...parts){let offset=0;const positions=[],indices=[];for(const part of parts){positions.push(...part.positions);indices.push(...Array.from(part.indices,index=>index+offset));offset+=part.positions.length/3;}return mesh(positions,indices);}
function hollow(outer,inner,position=[0,0,0],angles=[0,0,0]){const cavity=cube(inner,position,angles);for(let i=0;i<cavity.indices.length;i+=3)[cavity.indices[i+1],cavity.indices[i+2]]=[cavity.indices[i+2],cavity.indices[i+1]];return combine(cube(outer,position,angles),cavity);}
const linked=(document,opening)=>apply(document,{action:'component-clearance',assetId:'camera',shapeId:'pocket',clearance:{x:.5,y:.5,z:.5},...(opening?{opening}:{})});
const clockOptions=(yieldControl)=>{let tick=0;return {budgetMs:8,now:()=>tick+=9,yieldControl};};

test('cooperative audits exactly retain topology, winding, triangle order, rotated envelopes and full corridors',async()=>{
 const angles=[23,41,-32],camera=asset({x:61,y:-12,z:8,rx:angles[0],ry:angles[1],rz:angles[2],scale:1.7,envelope:[4,6,8],visible:false}),rotatedModel=linked(model(camera)),effective=camera.envelope.map(value=>value*camera.scale),rotatedShell=hollow(effective.map(value=>value+8),effective.map(value=>value+1),[camera.x,camera.y,camera.z],angles);
 const corridorModel=linked(model(),{axis:'z',direction:-1,travel:12}),blocker=cube([4,4,4],[0,0,-8]);
 const crossing=mesh([-6,-6,0,6,-6,0,0,6,0,0,0,10],[0,2,1,0,1,3,0,3,2,1,2,3]),valid=cube([4,4,4],[50,0,0]),badPosition=valid.positions.slice();badPosition[0]=NaN;
 const reversed=valid.indices.slice();[reversed[0],reversed[1]]=[reversed[1],reversed[0]];
 const cases=[
  [model(),crossing],[model(),cube([12,12,12])],[model(),hollow([12,12,12],[8,8,8])],
  [rotatedModel,rotatedShell],[corridorModel,blocker],
  [corridorModel,{...valid,indices:valid.indices.slice(3)}],
  [corridorModel,{...valid,indices:new Uint32Array([...valid.indices,...valid.indices.slice(0,3)])}],
  [corridorModel,{...valid,indices:reversed}],
  [corridorModel,{...valid,indices:new Uint32Array([...valid.indices,0,0,1])}],
  [corridorModel,{...valid,positions:badPosition}],
  [corridorModel,{...valid,indices:new Uint32Array([0,1,99])}],
  [corridorModel,mesh([],[])],
 ];
 let yields=0;
 for(const [document,surface] of cases){
  const before=[surface.positions.slice(),surface.normals.slice(),surface.indices.slice()],options=clockOptions(async()=>{yields++;});
  assert.deepEqual(await auditMeshAsync(surface,options),auditMesh(surface));
  assert.deepEqual(await auditExportMeshAsync(document,surface,options),auditExportMesh(document,surface));
  assert.deepEqual([surface.positions,surface.normals,surface.indices],before,'audit leaves the captured arrays untouched');
 }
 assert.ok(yields>=cases.length,'even small fit reports have an input-delivery boundary');
 const corridor=await auditExportMeshAsync(corridorModel,blocker);
 assert.equal(corridor.componentFit.components[0].seat.status,'clear');
 assert.equal(corridor.componentFit.components[0].insertion.status,'interference');
 assert.equal(corridor.componentFit.components[0].insertion.firstTriangle,0);
 assert.equal((await auditExportMeshAsync(rotatedModel,rotatedShell)).componentFit.components[0].status,'clear');
});

test('actual stereo export reports are exact across synchronous and cooperative execution',async()=>{
 const document=createStereoCameraStudy(),surface=generateMesh(document,72),expected=auditExportMesh(document,surface);let yields=0;
 const actual=await auditExportMeshAsync(document,surface,clockOptions(async()=>{yields++;}));
 assert.deepEqual(actual,expected);assert.equal(actual.audit.components,1);assert.equal(actual.componentFit.meshVerified,true);
 assert.equal(actual.componentFit.components.length,2);for(const component of actual.componentFit.components){assert.equal(component.seat.status,'clear');assert.equal(component.insertion.status,'clear');}
 assert.ok(yields>100,'large position, edge, seat and corridor scans yield throughout');
});

test('cancellation interrupts topology validation and never returns a partial clean report',async()=>{
 const surface=combine(...Array.from({length:40},(_,index)=>cube([4,4,4],[index*10,0,0]))),controller=new AbortController();let yields=0;
 await assert.rejects(auditMeshAsync(surface,{...clockOptions(async()=>{yields++;controller.abort();}),signal:controller.signal}),{name:'AbortError'});
 assert.equal(yields,1);
 const preCancelled=new AbortController();preCancelled.abort();
 await assert.rejects(auditExportMeshAsync(model(),surface,{signal:preCancelled.signal}),{name:'AbortError'});
});

test('cancellation interrupts a component triangle scan after topology has completed',async()=>{
 const surface=combine(...Array.from({length:40},(_,index)=>cube([4,4,4],[50+index*10,0,0]))),document=model(),controller=new AbortController();let fitStarted=false,fitYields=0,topologyYields=0;
 // Envelope lookup happens only after the captured topology and its finite /
 // index validation scans have finished. Abort at the next triangle group.
 Object.defineProperty(document.assets[0],'envelope',{get(){fitStarted=true;return [4,4,4];},enumerable:true});
 await assert.rejects(auditExportMeshAsync(document,surface,{...clockOptions(async()=>{if(fitStarted){fitYields++;controller.abort();}else topologyYields++;}),signal:controller.signal}),{name:'AbortError'});
 assert.ok(topologyYields>1);assert.equal(fitYields,1);
 // A fresh task still produces the authoritative full result after cancellation.
 assert.deepEqual(await auditExportMeshAsync(document,surface),auditExportMesh(document,surface));
});

test('cooperative fit rejects malformed metadata and never accepts caller supplied stale topology',async()=>{
 const document=linked(model(),{axis:'z',direction:-1,travel:12}),surface=cube([4,4,4],[50,0,0]);
 for(const opening of [{axis:'z',direction:1,travel:NaN},{axis:'q',direction:1,travel:12},{axis:'z',direction:0,travel:12},{axis:'z',direction:1,travel:-1}]){
  const malformed={...document,componentClearances:[{...document.componentClearances[0],opening}]};
  assert.throws(()=>auditExportMesh(malformed,surface),/insertion/);await assert.rejects(auditExportMeshAsync(malformed,surface),/insertion/);
 }
 const invalidPose={...document,assets:[{...document.assets[0],rx:NaN}]};await assert.rejects(auditExportMeshAsync(invalidPose,surface),/transform/);
 const stale=auditMesh(surface),open={...surface,indices:surface.indices.slice()};open.indices[0]=open.indices[1];
 const actual=await auditExportMeshAsync(document,open,stale);assert.equal(actual.componentFit.meshVerified,false);assert.equal(actual.componentFit.components[0].status,'unverified');
});

test('default cooperative tasks deliver timer cancellation while auditing a large captured mesh',async()=>{
 const surface=combine(...Array.from({length:600},(_,index)=>cube([4,4,4],[50+index*10,0,0]))),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),0);
 try{await assert.rejects(auditExportMeshAsync(model(),surface,{signal:controller.signal,budgetMs:.001}),{name:'AbortError'});}finally{clearTimeout(timer);}
});
