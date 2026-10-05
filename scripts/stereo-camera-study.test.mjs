import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConstructionCommand,blankConstruction} from '../lib/construction.ts';
import {createStereoCameraStudy,stereoCameraStudyCommands,inferStereoCameraStudyParameters,DEFAULT_STEREO_CAMERA_PARAMETERS as defaults} from '../lib/stereo-camera-study.ts';
import {evaluateBase,generateMesh,validateModel} from '../lib/form-engine.ts';
import {stereoEnvelopeCollisions} from './stereo-geometry-check.mjs';
import {evaluateShape,sweepSamples} from '../lib/shapes.ts';
import {auditExportMesh} from '../lib/component-fit.ts';

test('the independent export check catches crossing faces and rejects separated corner triangles',()=>{
 const triangle=(positions)=>({positions:new Float32Array(positions),indices:new Uint32Array([0,1,2])});
 const collision=stereoEnvelopeCollisions(triangle([-80,0,0,0,40,0,0,-40,0]));
 assert.equal(collision.triangleHardwareCollisions,1);
 assert.deepEqual(collision.firstCollision,{triangle:0,camera:'left'});
 // Its bounding box overlaps the left camera's corner, but x+y=56 lies
 // completely beyond the camera's maximum x+y=52.5 in local coordinates.
 assert.equal(stereoEnvelopeCollisions(triangle([-8,28,0,2,18,0,2,28,0])).triangleHardwareCollisions,0);
 assert.throws(()=>stereoEnvelopeCollisions(triangle([NaN,0,0,0,1,0,0,0,1])),/finite/);
});

test('the one stereo frame is reproducible from public construction actions',()=>{
 const commands=stereoCameraStudyCommands(),model=createStereoCameraStudy();
 assert.equal(commands[0].action,'start');assert.equal(model.baseEnabled,false);assert.deepEqual(model.influences,[]);
 assert.deepEqual(commands.reduce(applyConstructionCommand,blankConstruction()),model);
 assert.deepEqual(createStereoCameraStudy(),model);
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(model))),model);
 assert.ok(model.shapes.length<=32);assert.equal(model.assets.length,2);
 assert.equal(model.componentClearances.length,2);
 assert.equal(model.attachments.length,4);
 assert.deepEqual(inferStereoCameraStudyParameters(model),defaults);
});

test('the four camera collars close cyclically without duplicated editable endpoints',()=>{
 const model=createStereoCameraStudy(),ids=['stereo-shoulder-left','stereo-rear-shoulder-left','stereo-shoulder-right','stereo-rear-shoulder-right'];
 assert.equal(model.shapes.filter(shape=>shape.closed===true).length,4);
 for(const id of ids){
  const collar=model.shapes.find(shape=>shape.id===id),samples=sweepSamples(collar);
  assert.equal(collar.closed,true);assert.equal(collar.path.length,9);
  assert.notDeepEqual(collar.path.at(-1),collar.path[0],'the seam is generated, not a repeated editable control');
  assert.deepEqual(samples.at(-1),samples[0],'the generated loop meets at its first point and section');
  const path=collar.path.map(point=>({...point}));path[0].x+=3;path[0].y-=1;
  const edited=applyConstructionCommand(model,{action:'update',id,patch:{path}}).shapes.find(shape=>shape.id===id),editedSamples=sweepSamples(edited);
  assert.deepEqual(editedSamples.at(-1),editedSamples[0],'editing the seam moves both sides of the same loop');
  assert.equal(edited.path.length,9);assert.equal(edited.path[0].radius,defaults.wall*1.1);
 }
});

test('explicitly closing the collars preserves the authored reference interfaces',()=>{
 const model=createStereoCameraStudy();
 for(const collar of model.shapes.filter(shape=>shape.closed===true)){
  const legacy={...collar,closed:false,path:[...collar.path.map(point=>({...point})),{...collar.path[0]}]};
  for(const x of [-3,0,3])for(const y of [-3,0,3])for(const z of [-2,0,2]){
   const first=collar.path[0],point=[collar.x+first.x+x,collar.y+first.y+y,collar.z+first.z+z];
   assert.ok(Math.abs(evaluateShape(collar,...point)-evaluateShape(legacy,...point))<1e-8,'closure preserves the intentional lower seam profile');
  }
 }
});

test('the curved mounting bridges keep their authored shoulder connections',()=>{
 const original=createStereoCameraStudy();
 const moved=applyConstructionCommand(original,{action:'transform',ids:['stereo-shoulder-left','stereo-rear-shoulder-left'],translation:{x:-6,y:0,z:0},rotation:{x:0,y:0,z:0},pivot:{x:0,y:0,z:0}});
 for(const arch of ['front','rear']){
  const before=original.shapes.find(shape=>shape.id==='stereo-arch-'+arch),after=moved.shapes.find(shape=>shape.id===before.id);
  assert.equal(after.path[0].x,before.path[0].x-6);
  assert.deepEqual(after.path.slice(1),before.path.slice(1));
 }
});

test('both complete reference envelopes have clear frontal faces and rear insertion corridors',()=>{
 const model=createStereoCameraStudy();
 for(const xCenter of [-36,36])for(const x of [-30,-15,0,15,30])for(const y of [-21.6,-10,0,10,21.6])for(const z of [-45,-30,-16,-15,0,15,16,30]){
  assert.ok(evaluateBase(model,xCenter+x,y,z)>=.499,'clear reference envelope at '+[xCenter+x,y,z]);
 }
});

test('control windows, retention tunnels and central fixing bore reach open space',()=>{
 const model=createStereoCameraStudy();
 for(const center of [-36,36]){
  for(const y of [21.6,24,28])assert.ok(evaluateBase(model,center,y,0)>0,'top opening');
  const outside=Math.sign(center)*67;
  for(const x of [outside,outside+Math.sign(center)*5])assert.ok(evaluateBase(model,x,0,0)>0,'outer connector access');
  for(const x of [center-16,center,center+16])assert.ok(evaluateBase(model,x,-28.4,-6.6)>0,'rear retention tunnel is open through X');
  assert.ok(evaluateBase(model,center,-28.4,0)<0,'retention tunnel keeps an integral front wall');
  assert.ok(evaluateBase(model,center,-28.4,14)<0,'the route avoids the front optical face');
 }
 for(const y of [-46,-42,-38,-34,-30])assert.ok(evaluateBase(model,0,y,0)>0,'fixing bore is open');
 assert.ok(evaluateBase(model,10,-41,0)<0,'fixing pad remains solid around its bore');
});

test('changing the hardware envelope regenerates genuine clearances and baseline',()=>{
 const p={cameraWidth:68,cameraHeight:48,cameraDepth:38,baseline:86,clearance:.8,wall:4},model=createStereoCameraStudy(p);
 assert.deepEqual(inferStereoCameraStudyParameters(model),p);
 for(const center of [-43,43])for(const x of [-34,0,34])for(const y of [-24,0,24])for(const z of [-40,0,20])assert.ok(evaluateBase(model,center+x,y,z)>=.799,'updated camera corridor');
 assert.throws(()=>createStereoCameraStudy({baseline:60}),/Baseline/);
 assert.throws(()=>createStereoCameraStudy({wall:NaN}));
 assert.equal(inferStereoCameraStudyParameters(blankConstruction()),null);
});

test('the parameter editor does not misrepresent mismatched or independently moved hardware',()=>{
 const original=createStereoCameraStudy();
 for(const patch of [
  {envelope:[61,43.2,30]},{x:38},{y:2},{z:3},{ry:12},{scale:.8},
 ]){
  const edited=applyConstructionCommand(original,{action:'update-component',id:'stereo-camera-right',patch});
  assert.equal(inferStereoCameraStudyParameters(edited),null);
 }
 const asymmetric=applyConstructionCommand(original,{action:'component-clearance',assetId:'stereo-camera-right',shapeId:'stereo-pocket-right',clearance:{x:.6,y:.6,z:.6}});
 assert.equal(inferStereoCameraStudyParameters(asymmetric),null);
 const hidden=applyConstructionCommand(original,{action:'update-component',id:'stereo-camera-right',patch:{visible:false}});
 assert.deepEqual(inferStereoCameraStudyParameters(hidden),defaults,'visibility does not change authored dimensions');
});

test('actual stereo frame mesh is one closed connected body',()=>{
 const model=createStereoCameraStudy(),mesh=generateMesh(model,96),{audit,componentFit:fitted}=auditExportMesh(model,mesh);
 assert.equal(audit.components,1);assert.equal(audit.boundaryEdges,0);assert.equal(audit.nonManifoldEdges,0);
 assert.equal(audit.inconsistentWindingEdges,0);assert.equal(audit.degenerateTriangles,0);assert.equal(audit.invalidIndices,0);assert.equal(audit.finite,true);
 assert.ok(audit.volume>1000);assert.ok(audit.dimensions[0]>143&&audit.dimensions[0]<154);
 const seatCheck=stereoEnvelopeCollisions(mesh);
 assert.equal(seatCheck.triangleHardwareCollisions,0,'mesh preserves at least .45 mm per-side reference clearance');
 assert.equal(seatCheck.requiredPerSideClearance,.45);
 assert.equal(fitted.meshVerified,true);assert.equal(fitted.components.length,2);
 for(const component of fitted.components){
  assert.equal(component.status,'clear');assert.equal(component.seat.status,'clear');assert.equal(component.seat.surfaceTriangleCount,0);
  assert.equal(component.insertion?.status,'clear');assert.equal(component.insertion.surfaceTriangleCount,0);
 }
});
