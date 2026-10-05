import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Matrix4,Vector3} from 'three';
import {auditComponentFit,auditExportMesh,COMPONENT_FIT_SAMPLING_ALLOWANCE} from '../lib/component-fit.ts';
import {auditMesh} from '../lib/mesh-audit.ts';
import {applyConstructionCommand as apply,blankConstruction} from '../lib/construction.ts';
import {createStereoCameraStudy} from '../lib/stereo-camera-study.ts';
import {generateMesh} from '../lib/form-engine.ts';

const asset=(patch={})=>({id:'camera',sourceId:'gopro-hd-hero',name:'Measured camera',visible:true,x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1,envelope:[4,4,4],...patch});
const model=(camera=asset())=>apply(blankConstruction(),{action:'add-component',asset:camera});
const mesh=(positions,indices)=>({positions:new Float32Array(positions),normals:new Float32Array(positions.length),indices:new Uint32Array(indices),bounds:[0,0,0,0,0,0],volume:0});
const tetra=points=>mesh(points.flat(),[0,2,1,0,1,3,0,3,2,1,2,3]);
const row=(document,surface)=>auditComponentFit(document,surface).components[0];
function cube(dimensions=[10,10,10],position=[0,0,0],angles=[0,0,0]){
 const [x,y,z]=dimensions.map(value=>value/2),matrix=new Matrix4().makeRotationFromEuler(new Euler(...angles.map(value=>value*Math.PI/180),'XYZ'));
 const points=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]].flatMap(point=>new Vector3(...point).applyMatrix4(matrix).add(new Vector3(...position)).toArray());
 return mesh(points,[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
}
function combine(...parts){let offset=0;const positions=[],indices=[];for(const part of parts){positions.push(...part.positions);indices.push(...Array.from(part.indices,index=>index+offset));offset+=part.positions.length/3;}return mesh(positions,indices);}
function hollow(outer,inner,position=[0,0,0],angles=[0,0,0]){const cavity=cube(inner,position,angles);for(let index=0;index<cavity.indices.length;index+=3)[cavity.indices[index+1],cavity.indices[index+2]]=[cavity.indices[index+2],cavity.indices[index+1]];return combine(cube(outer,position,angles),cavity);}
function linked(document,clearance={x:.5,y:.5,z:.5},opening){return apply(document,{action:'component-clearance',assetId:'camera',shapeId:'pocket',clearance,...(opening?{opening}:{})});}

test('actual triangle/box SAT catches crossing faces with every vertex outside',()=>{
 const document=model(),surface=tetra([[-6,-6,0],[6,-6,0],[0,6,0],[0,0,10]]),before=Array.from(surface.positions),report=auditComponentFit(document,surface),fit=report.components[0];
 assert.equal(report.meshVerified,true);assert.equal(fit.status,'interference');assert.ok(fit.seat.surfaceTriangleCount>0);assert.equal(fit.seat.firstTriangle,0);
 for(const index of surface.indices.slice(0,3)){const point=surface.positions.slice(index*3,index*3+3);assert.ok(point.some(value=>Math.abs(value)>2),'all face vertices outside the hardware box');}
 assert.deepEqual(Array.from(surface.positions),before);assert.deepEqual(auditExportMesh(document,surface),{audit:auditMesh(surface),componentFit:report});
});

test('SAT rejects disjoint oblique faces even when their world bounding boxes overlap the component',()=>{
 const surface=tetra([[1,4,4],[4,1,4],[4,4,1],[5,5,5]]),fit=row(model(),surface);
 // Each triangle bounding box reaches the component AABB, but x+y+z>=9
 // throughout the tetrahedron while the hardware box has x+y+z<=6.
 assert.equal(fit.status,'clear');assert.equal(fit.seat.surfaceTriangleCount,0);assert.equal(fit.seat.firstTriangle,null);assert.equal(fit.seat.centreInside,false);
});

test('closed mesh winding distinguishes an entirely enclosed component from an empty shell cavity',()=>{
 const document=model(),filled=row(document,cube([12,12,12])),empty=row(document,hollow([12,12,12],[8,8,8]));
 assert.equal(filled.status,'interference');assert.equal(filled.seat.surfaceTriangleCount,0);assert.equal(filled.seat.centreInside,true);
 assert.equal(empty.status,'clear');assert.equal(empty.seat.surfaceTriangleCount,0);assert.equal(empty.seat.centreInside,false);
 // A disjoint component has zero winding even along a cube's vertices/edges.
 const vertexAligned=model(asset({x:20,y:6,z:6}));assert.equal(row(vertexAligned,cube([12,12,12])).status,'clear');
});

test('globally reversed and mirrored closed boundaries retain correct containment and face contact',()=>{
 const reverse=surface=>{const indices=surface.indices.slice();for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];return {...surface,indices};};
 assert.equal(row(model(),reverse(cube([12,12,12]))).seat.centreInside,true);assert.equal(row(model(),reverse(hollow([12,12,12],[8,8,8]))).status,'clear');
 const mirrored=hollow([12,14,16],[8,10,12],[5,2,-3]);for(let i=0;i<mirrored.positions.length;i+=3)mirrored.positions[i]=-mirrored.positions[i];
 const camera=model(asset({x:-5,y:2,z:-3}));assert.equal(row(camera,mirrored).status,'clear');
 const inside=row(model(),cube([1,1,1]));assert.equal(inside.status,'interference');assert.equal(inside.seat.surfaceTriangleCount,12);
 const touching=row(model(),tetra([[-6,-6,2],[6,-6,2],[0,6,2],[0,0,10]]));assert.equal(touching.status,'interference');assert.equal(touching.seat.centreInside,false);assert.equal(touching.seat.firstTriangle,0);
});

test('measured envelopes, XYZ Euler rotation, uniform scale and hidden references use the same captured geometry',()=>{
 for(const angles of [[23,41,-32],[90,0,0],[4,92,0],[743,-679,688]]){
  const camera=asset({x:61,y:-12,z:8,rx:angles[0],ry:angles[1],rz:angles[2],scale:1.7,envelope:[4,6,8],visible:false}),document=linked(model(camera)),effective=camera.envelope.map(value=>value*camera.scale),surface=hollow(effective.map(value=>value+8),effective.map(value=>value+1),[camera.x,camera.y,camera.z],angles),report=auditComponentFit(document,surface),fit=report.components[0];
  assert.equal(report.meshVerified,true);assert.equal(fit.visible,false);assert.deepEqual(fit.envelope,effective);assert.deepEqual(fit.testedClearance,[.45,.45,.45]);assert.equal(fit.status,'clear');assert.equal(fit.seat.surfaceTriangleCount,0);assert.equal(fit.seat.centreInside,false);
  // Move the referenced hardware through the actual rotated cavity wall.
  const delta=new Vector3(5,0,0).applyEuler(new Euler(...angles.map(value=>value*Math.PI/180),'XYZ')),moved=apply(document,{action:'update-component',id:'camera',patch:{x:camera.x+delta.x,y:camera.y+delta.y,z:camera.z+delta.z}});assert.equal(row(moved,surface).status,'interference');
 }
 const catalogOnly=model(asset({envelope:undefined,scale:.5})),fit=row(catalogOnly,cube([10,10,10],[50,0,0]));assert.deepEqual(fit.envelope,[30,21.6,15]);assert.deepEqual(fit.testedClearance,[0,0,0]);assert.equal(fit.samplingAllowance,0);
});

test('full straight insertion box detects a blocked corridor while the seated component is clear',()=>{
 const document=linked(model(),{x:.5,y:.5,z:.5},{axis:'z',direction:-1,travel:12}),surface=cube([4,4,4],[0,0,-8]),report=auditComponentFit(document,surface),fit=report.components[0];
 assert.equal(report.meshVerified,true);assert.equal(fit.seat.status,'clear');assert.equal(fit.seat.centreInside,false);assert.equal(fit.insertion.axis,'z');assert.equal(fit.insertion.direction,-1);assert.equal(fit.insertion.travel,12);assert.equal(fit.insertion.status,'interference');assert.equal(fit.insertion.surfaceTriangleCount,12);assert.equal(fit.status,'interference');
 // A one-sided path cannot silently extend through the other side.
 const opposite=linked(model(),{x:.5,y:.5,z:.5},{axis:'z',direction:1,travel:12});assert.equal(row(opposite,surface).insertion.status,'clear');
});

test('allowance reduces only authored per-side clearance and zero-travel openings are omitted',()=>{
 const document=linked(model(),{x:.5,y:.02,z:0},{axis:'y',direction:1,travel:0}),report=auditComponentFit(document,cube([4,4,4],[50,0,0])),fit=report.components[0];
 assert.equal(report.samplingAllowance,COMPONENT_FIT_SAMPLING_ALLOWANCE);assert.deepEqual(fit.envelope,[4,4,4]);assert.deepEqual(fit.testedClearance,[.45,0,0]);assert.equal(fit.samplingAllowance,.05);assert.equal(fit.insertion,undefined);
 const unlinked=row(model(),cube([4,4,4],[50,0,0]));assert.deepEqual(unlinked.testedClearance,[0,0,0]);assert.equal(unlinked.samplingAllowance,0);
 // Inclusive contact is interference; explicit zero clearance is not enlarged.
 assert.equal(row(model(),cube([4,4,4],[4,0,0])).status,'interference');
});

test('invalid/open/nonmanifold/degenerate/empty meshes require review and never claim clear',()=>{
 const document=linked(model(),{x:.5,y:.5,z:.5},{axis:'z',direction:-1,travel:12}),valid=cube([4,4,4],[50,0,0]),flipped=valid.indices.slice();[flipped[0],flipped[1]]=[flipped[1],flipped[0]];
 const badPosition=valid.positions.slice();badPosition[0]=NaN;
 const cases=[{...valid,indices:valid.indices.slice(3)},{...valid,indices:new Uint32Array([...valid.indices,...valid.indices.slice(0,3)])},{...valid,indices:flipped},{...valid,indices:new Uint32Array([...valid.indices,0,0,1])},{...valid,positions:badPosition},{...valid,indices:new Uint32Array([0,1,99])},mesh([],[])];
 for(const surface of cases){const report=auditComponentFit(document,surface),fit=report.components[0];assert.equal(report.meshVerified,false);assert.ok(report.reasons.length);assert.equal(fit.status,'unverified');assert.equal(fit.seat.status,'unverified');assert.equal(fit.seat.centreInside,null);assert.equal(fit.insertion.status,'unverified');}
 assert.equal(auditComponentFit(document,valid).meshVerified,true);
 const stale=auditMesh(valid),empty=auditComponentFit(document,mesh([],[]),stale);assert.equal(empty.meshVerified,false);assert.equal(empty.components[0].status,'unverified');
 const nonfinite=auditComponentFit(document,{...valid,positions:badPosition},stale);assert.equal(nonfinite.meshVerified,false);assert.equal(nonfinite.components[0].status,'unverified');
 const wrongIndices=auditComponentFit(document,{...valid,indices:new Uint32Array([0,1,99])},stale);assert.equal(wrongIndices.meshVerified,false);
 // Even a same-size stale clean report is ignored: the public checker audits
 // the captured arrays itself instead of accepting caller-supplied topology.
 const sameSizeOpen={...valid,indices:valid.indices.slice()};sameSizeOpen.indices[0]=sameSizeOpen.indices[1];assert.equal(auditComponentFit(document,sameSizeOpen,stale).meshVerified,false);
 const sameSizeDuplicated={...valid,indices:valid.indices.slice()};sameSizeDuplicated.indices.set(valid.indices.slice(-3),0);const duplicatedAudit=auditMesh(sameSizeDuplicated);assert.equal(duplicatedAudit.triangles,stale.triangles);assert.equal(duplicatedAudit.vertices,stale.vertices);assert.equal(duplicatedAudit.degenerateTriangles,0);assert.ok(duplicatedAudit.boundaryEdges>0);assert.ok(duplicatedAudit.nonManifoldEdges>0);assert.equal(auditComponentFit(document,sameSizeDuplicated,stale).components[0].status,'unverified');
});

test('malformed insertion metadata cannot silently omit a required path or claim clear',()=>{
 const document=linked(model(),{x:.5,y:.5,z:.5},{axis:'z',direction:-1,travel:12}),surface=cube([4,4,4],[50,0,0]);
 for(const opening of [{axis:'z',direction:1,travel:NaN},{axis:'q',direction:1,travel:12},{axis:'z',direction:0,travel:12},{axis:'z',direction:1,travel:-1}]){const malformed={...document,componentClearances:[{...document.componentClearances[0],opening}]};assert.throws(()=>auditComponentFit(malformed,surface),/insertion/);}
 const invalidPose={...document,assets:[{...document.assets[0],rx:NaN}]};assert.throws(()=>auditComponentFit(invalidPose,surface),/transform/);
});

test('both measured stereo references pass seat and full insertion checks against the generated export triangles',()=>{
 const document=createStereoCameraStudy(),surface=generateMesh(document,72),{componentFit:report}=auditExportMesh(document,surface);
 assert.equal(report.meshVerified,true);assert.equal(report.components.length,2);for(const fit of report.components){assert.equal(fit.status,'clear');assert.equal(fit.seat.surfaceTriangleCount,0);assert.equal(fit.seat.centreInside,false);assert.equal(fit.insertion.status,'clear');assert.equal(fit.insertion.surfaceTriangleCount,0);assert.equal(fit.insertion.centreInside,false);}
});
