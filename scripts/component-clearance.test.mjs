import test from 'node:test';
import assert from 'node:assert/strict';
import {componentEnvelopeDimensions,deriveComponentClearance,reconcileComponentClearances,resolveComponentClearances} from '../lib/component-clearance.ts';
import {applyConstructionCommand as apply,blankConstruction} from '../lib/construction.ts';
import {cloneModel,evaluateBase,generateMesh,validateModel,withoutRipples} from '../lib/form-engine.ts';
import {attachmentLocalToWorld as toWorld,attachmentWorldToLocal as toLocal} from '../lib/attachments.ts';
import {makeShape} from '../lib/shapes.ts';
import {auditMesh} from '../lib/mesh-audit.ts';

const asset=(patch={})=>({id:'camera',sourceId:'gopro-hd-hero',name:'Camera reference',visible:true,x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1,...patch});
const fixture=(patch={})=>apply(blankConstruction(),{action:'add-component',asset:asset(patch)});
const link=(patch={})=>({assetId:'camera',shapeId:'pocket',clearance:{x:.5,y:.5,z:.5},...patch});
const pocket=model=>model.shapes.find(shape=>shape.id==='pocket');
const near=(a,b,tolerance=1e-8)=>{for(const axis of ['x','y','z'])assert.ok(Math.abs(a[axis]-b[axis])<tolerance,axis+': '+a[axis]+' / '+b[axis]);};
const addPocket=(model,patch={})=>apply(model,{action:'component-clearance',...link(patch)});

test('clearance derives exact measured dimensions and a rotated one-sided insertion corridor',()=>{
 const camera=asset({x:20,y:-7,z:12,rx:34,ry:-29,rz:41,scale:1.2,envelope:[63,44,31]}),relationship=link({clearance:{x:.4,y:.7,z:.3},opening:{axis:'z',direction:-1,travel:18}}),shape=deriveComponentClearance(camera,relationship);
 assert.deepEqual(componentEnvelopeDimensions(camera),[63,44,31]);assert.equal(shape.width,76.39999999999999);assert.equal(shape.height,54.199999999999996);assert.equal(shape.depth,55.8);
 assert.equal(shape.kind,'box');assert.equal(shape.operation,'subtract');assert.equal(shape.roundness,0);assert.equal(shape.blend,0);
 near(toLocal({...shape,...camera},shape),{x:0,y:0,z:-9});
 // A local extension keeps the positive face in place, extending only the rear.
 for(const [sign,expectedZ] of [[1,18.9],[-1,-36.9]]){
  const point=toWorld(shape,{x:0,y:0,z:sign*shape.depth/2});near(toLocal({...shape,...camera},point),{x:0,y:0,z:expectedZ});
 }
 const rolled=deriveComponentClearance({...camera,rx:camera.rx+720,ry:camera.ry-720},relationship);near(rolled,shape);assert.equal(rolled.rx,shape.rx);assert.equal(rolled.ry,shape.ry);
});

test('public component commands retain links through movement, rotation, scaling, measurement and hiding',()=>{
 let model=addPocket(fixture(),{opening:{axis:'x',direction:1,travel:24}}),saved=cloneModel(model);
 model=apply(model,{action:'update-component',id:'camera',patch:{x:40,y:-16,z:8,rx:21,ry:32,rz:73,scale:1.1,envelope:[64,45,32],visible:false}});
 assert.equal(model.componentClearances.length,1);assert.equal(pocket(model).width,95.4);assert.equal(pocket(model).height,50.50000000000001);assert.equal(pocket(model).depth,36.2);
 near(toLocal({...pocket(model),...model.assets[0]},pocket(model)),{x:12,y:0,z:0});assert.equal(pocket(model).enabled,true);
 assert.equal(resolveComponentClearances(model),model);assert.deepEqual(saved.assets[0],asset());
 const reset=apply(model,{action:'update-component',id:'camera',patch:{envelope:null}});assert.equal(Object.hasOwn(reset.assets[0],'envelope'),false);assert.equal(pocket(reset).width,91);
 const noOpening=apply(reset,{action:'component-clearance',...link({clearance:{x:.7,y:.7,z:.7}})});near(pocket(noOpening),noOpening.assets[0]);assert.equal(pocket(noOpening).width,67.4);assert.equal(noOpening.componentClearances[0].opening,undefined);
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(noOpening))),noOpening);
 // The viewport removes CAD metadata before sending its resolved geometry worker.
 const workerModel=validateModel(withoutRipples(noOpening));assert.equal(Object.hasOwn(workerModel,'assets'),false);assert.equal(Object.hasOwn(workerModel,'componentClearances'),false);assert.deepEqual(pocket(workerModel),pocket(noOpening));
});

test('raw edits detach a cavity while deletion freezes resolved geometry and renaming retains its relationship',()=>{
 const model=addPocket(fixture({x:21,ry:25}),{opening:{axis:'z',direction:-1,travel:20}}),original=cloneModel(model);
 const renamed=apply(model,{action:'update',id:'pocket',patch:{name:'Rear insertion pocket'}});assert.equal(renamed.componentClearances.length,1);assert.equal(pocket(renamed).name,'Rear insertion pocket');
 for(const patch of [{x:40},{depth:75},{roundness:3},{blend:2},{operation:'union'}]){
  const edited=apply(model,{action:'update',id:'pocket',patch});assert.deepEqual(edited.componentClearances,[]);for(const [key,value] of Object.entries(patch))assert.equal(pocket(edited)[key],value);
  const moved=apply(edited,{action:'update-component',id:'camera',patch:{x:56}});assert.deepEqual(pocket(moved),pocket(edited));
 }
 const disabled=apply(model,{action:'update',id:'pocket',patch:{enabled:false}});assert.equal(disabled.componentClearances.length,1);const hiddenMoved=apply(disabled,{action:'update-component',id:'camera',patch:{x:36}});assert.equal(pocket(hiddenMoved).enabled,false);assert.equal(pocket(hiddenMoved).x,pocket(disabled).x+15);
 const removed=apply(model,{action:'remove-component',id:'camera'});assert.deepEqual(removed.componentClearances,[]);assert.deepEqual(pocket(removed),pocket(model));assert.deepEqual(removed.assets,[]);
 const raw=cloneModel(model);raw.assets=[];pocket(raw).x=100;const frozen=reconcileComponentClearances(model,raw);assert.deepEqual(pocket(frozen),pocket(model));
 assert.deepEqual(apply(model,{action:'remove',id:'pocket'}).componentClearances,[]);
 const mirrored=apply(model,{action:'mirror',id:'pocket',axis:'x',newId:'mirrored-pocket'});assert.equal(mirrored.componentClearances.length,1);const copy=mirrored.shapes.find(shape=>shape.id==='mirrored-pocket');assert.equal(copy.x,-pocket(model).x);
 const moved=apply(mirrored,{action:'update-component',id:'camera',patch:{x:41}});assert.deepEqual(moved.shapes.find(shape=>shape.id==='mirrored-pocket'),copy);assert.deepEqual(model,original);
});

test('imports resolve stale fit geometry and reject malformed, duplicate, reserved or unsupported links atomically',()=>{
 const model=addPocket(fixture()),saved=cloneModel(model),stale=cloneModel(model);stale.assets[0].x=20;stale.assets[0].envelope=[66,45,35];
 const imported=validateModel(stale);assert.equal(pocket(imported).x,20);assert.equal(pocket(imported).width,67);assert.equal(pocket(imported).depth,36);
 for(const relationship of [null,{...link(),shapeId:'missing'},{...link(),shapeId:'body'},{...link(),assetId:'missing'},{...link(),clearance:{x:-1,y:0,z:0}},{...link(),clearance:{x:NaN,y:0,z:0}},{...link(),clearance:{x:0,y:0,z:0,typo:1}},{...link(),opening:{axis:'q',direction:-1,travel:2}},{...link(),opening:{axis:'z',direction:0,travel:2}},{...link(),opening:{axis:'z',direction:1,travel:241}},{...link(),opening:{axis:'z',direction:1,travel:1,typo:1}}])assert.throws(()=>validateModel({...model,componentClearances:[relationship]}));
 assert.throws(()=>validateModel({...model,componentClearances:[link(),link()]}),/only one/);
 assert.throws(()=>validateModel({...model,componentClearances:'bad'}));
 for(const envelope of [[3,40,30],[60,201,30],[60,40],[60,40,Infinity],null])assert.throws(()=>validateModel({...model,assets:[asset({envelope})]}));
 for(const command of [{action:'add-component',asset:asset()},{action:'add-component',asset:asset({id:'body'})},{action:'update-component',id:'camera',patch:{sourceId:'camera-module-3'}},{action:'update-component',id:'camera',patch:{scale:10}},{action:'update-component',id:'camera',patch:{x:301}},{action:'component-clearance',...link({opening:{axis:'x',direction:1,travel:240}})},{action:'component-clearance',...link({shapeId:'new-pocket'})},{action:'remove-component',id:'missing'}]){assert.throws(()=>apply(model,command));assert.deepEqual(model,saved);}
 const legacy=validateModel(blankConstruction());assert.equal(Object.hasOwn(legacy,'componentClearances'),false);
 // Tiny CAD bounds are not silently inflated; users must choose representable clearance.
 assert.throws(()=>deriveComponentClearance(asset({sourceId:'gopro-shutter-button'}),link({clearance:{x:0,y:0,z:0}})),/height range/);
 assert.equal(deriveComponentClearance(asset({sourceId:'gopro-shutter-button'}),link({clearance:{x:0,y:1,z:0}})).height,4);
});

test('linked cavity supports downstream endpoint attachments, empty insertion space and a closed generated shell',()=>{
 let model=fixture();model=apply(model,{action:'add',shape:{...makeShape('box'),id:'housing',name:'Housing',x:0,y:0,z:0,width:76,height:59.2,depth:46,roundness:5,blend:0}});
 model=addPocket(model,{opening:{axis:'z',direction:-1,travel:25}});
 // The insertion corridor reaches past the rear face; the front wall remains solid.
 for(let z=-32;z<=14;z+=2)for(const x of [-29,0,29])for(const y of [-20,0,20])assert.ok(evaluateBase(model,x,y,z)>0,'free camera/insertion envelope');
 assert.ok(evaluateBase(model,0,0,20)<0,'front wall retained');assert.ok(evaluateBase(model,35,0,0)<0,'sidewall retained');
 const mesh=generateMesh(model,50),audit=auditMesh(mesh);assert.equal(audit.components,1);assert.equal(audit.boundaryEdges,0);assert.equal(audit.nonManifoldEdges,0);assert.equal(audit.inconsistentWindingEdges,0);assert.equal(audit.degenerateTriangles,0);
 // A linked cavity can itself serve as a modelling reference for an attached rail.
 model=apply(model,{action:'add',shape:{...makeShape('sweep'),id:'rail',name:'Rail',x:0,y:0,z:0,blend:0,path:[{x:35,y:-12,z:0,radius:3},{x:35,y:12,z:0,radius:3}]}});
 model=apply(model,{action:'attach',sweepId:'rail',endpoint:'start',targetShapeId:'pocket',anchor:'center'});
 const before=toWorld(model.shapes.find(shape=>shape.id==='rail'),model.shapes.find(shape=>shape.id==='rail').path[0]);model=apply(model,{action:'update-component',id:'camera',patch:{x:6}});const rail=model.shapes.find(shape=>shape.id==='rail');near(toWorld(rail,rail.path[0]),{...before,x:before.x+6});
});
