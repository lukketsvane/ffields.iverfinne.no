import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MODEL,cloneModel,makeInfluence,evaluateBase,validateModel} from '../lib/form-engine.ts';
import {makeShape,evaluateShape} from '../lib/shapes.ts';
import {selectedHandle,projectedHandleHit,pickShapeAtPoint,directTransformPatch,directGripOffset,directScaleFactor,directRotationDelta} from '../lib/direct-manipulation.ts';
import {applyConstructionCommand} from '../lib/construction.ts';
import {attachmentLocalToWorld} from '../lib/attachments.ts';
import {sweepScaleLimits} from '../lib/quick-modelling.ts';

const sphere=(id,x=0,radius=10)=>({...makeShape('sphere'),id,x,y:0,z:0,width:radius*2,height:radius*2,depth:radius*2,blend:0});
const model=(shapes,extra={})=>({...cloneModel(DEFAULT_MODEL),baseEnabled:false,asymmetry:0,influences:[],shapes,...extra});
const point=(x,y=0,z=0)=>({x,y,z});

test('selected handles use authored origins and the correct validation ranges',()=>{
 const shape={...sphere('shape'),x:280,y:-290,z:300,rz:75};
 const asset={id:'asset',sourceId:'fixture',name:'Fixture',visible:true,x:600,y:-800,z:900,rx:0,ry:0,rz:0,scale:1};
 const influence={...makeInfluence('bulge'),id:'field'};
 const m=model([shape],{assets:[asset],influences:[influence]});
 assert.deepEqual(selectedHandle(m,'shape'),{id:'shape',kind:'shape',x:280,y:-290,z:300,ranges:{x:[-300,300],y:[-300,300],z:[-300,300]}});
 assert.deepEqual(selectedHandle(m,'asset').ranges,{x:[-1000,1000],y:[-1000,1000],z:[-1000,1000]});
 assert.deepEqual(selectedHandle(m,'field').ranges,{x:[-120,120],y:[-65,65],z:[-70,70]});
 shape.enabled=false;asset.visible=false;influence.enabled=false;
 for(const id of ['shape','asset','field','body','missing'])assert.equal(selectedHandle(m,id),undefined);
});

test('touch targets use CSS pixel distance and reject camera clipping',()=>{
 assert.equal(projectedHandleHit({x:124,y:100},{x:100,y:100,z:0}),true);
 assert.equal(projectedHandleHit({x:124.01,y:100},{x:100,y:100,z:0}),false);
 assert.equal(projectedHandleHit({x:117,y:117},{x:100,y:100}),false);
 assert.equal(projectedHandleHit({x:100,y:100},{x:100,y:100,z:1.1}),false);
 assert.equal(projectedHandleHit({x:100,y:100},{x:100,y:100,z:-1.1}),false);
 assert.equal(projectedHandleHit({x:NaN,y:100},{x:100,y:100}),false);
 assert.equal(projectedHandleHit({x:100,y:100},{x:100,y:100},-1),false);
});

test('linked clearance cuts cannot detach through a direct drag handle',()=>{
 const cut={...sphere('linked-cut'),operation:'subtract'};
 const asset={id:'component',sourceId:'fixture',name:'Component',visible:true,x:20,y:10,z:0,rx:0,ry:0,rz:0,scale:1};
 const m=model([cut],{assets:[asset],componentClearances:[{assetId:asset.id,shapeId:cut.id,clearance:{x:1,y:1,z:1}}]});
 assert.equal(selectedHandle(m,cut.id),undefined);
 assert.equal(selectedHandle(m,asset.id)?.kind,'asset','the visible component remains draggable');
 assert.equal(selectedHandle(m,asset.id)?.x,20);
});

test('surface selection rejects buried primitives and unrelated base surfaces',()=>{
 const m=model([sphere('outer'),sphere('buried',0,5),sphere('distant',100)]),before=cloneModel(m);
 assert.equal(pickShapeAtPoint(m,point(10)),'outer');
 assert.equal(pickShapeAtPoint(m,point(100,10)),'distant');
 assert.equal(pickShapeAtPoint(m,point(0)),undefined,'interior is not a surface hit');
 const base=model([sphere('far',200)],{baseEnabled:true,width:100});
 assert.equal(pickShapeAtPoint(base,point(50)),undefined,'the base is not attributed to a distant shape');
 assert.deepEqual(m,before,'picking must leave authored geometry unchanged');
});

test('cuts and intersections select the operation that makes the visible wall',()=>{
 const box={...makeShape('box'),id:'block',x:0,y:0,z:0,width:40,height:40,depth:40,roundness:0,blend:0};
 const cut={...sphere('bore'),operation:'subtract'};
 const cutModel=model([box,cut,sphere('inactive-cut',100)]);
 assert.ok(Math.abs(evaluateBase(cutModel,10,0,0))<1e-9);
 assert.equal(pickShapeAtPoint(cutModel,point(10)),'bore');
 assert.equal(pickShapeAtPoint(cutModel,point(20)),'block');
 const clip={...sphere('clip'),operation:'intersect'};
 assert.equal(pickShapeAtPoint(model([box,clip]),point(10)),'clip');
 const hiddenCut={...sphere('hidden-cut',100),operation:'subtract'};
 assert.equal(pickShapeAtPoint(model([box,hiddenCut]),point(20)),'block');
});

test('smooth blended and coincident surfaces remain selectable',()=>{
 const a=sphere('left',-10,20),b={...sphere('right',10,20),blend:8};
 const m=model([a,b]),p=point(0,Math.sqrt(22*22-10*10));
 assert.ok(Math.abs(evaluateBase(m,p.x,p.y,p.z))<1e-9);
 assert.ok(['left','right'].includes(pickShapeAtPoint(m,p)),'both blend contributors are valid authored selections');
 assert.equal(pickShapeAtPoint(model([sphere('first'),sphere('last')]),point(10)),'last','coincident fields must not be treated as buried');
});

test('rotated boxes, rotated sweeps and deformed surfaces pick in model space',()=>{
 const box={...makeShape('box'),id:'turned',x:0,y:0,z:0,width:40,height:20,depth:12,roundness:0,blend:0,rz:90};
 assert.equal(pickShapeAtPoint(model([box]),point(0,20)),'turned');
 const sweep={...makeShape('sweep'),id:'curve',x:30,y:5,z:0,rz:90,blend:0,path:[{x:-15,y:0,z:0,radius:4},{x:15,y:0,z:0,radius:4}]};
 assert.equal(pickShapeAtPoint(model([sweep]),point(26,5)),'curve');
 const bulge={...makeInfluence('bulge'),id:'fullness',x:0,y:0,z:0,strength:3,falloff:'constant'};
 assert.equal(pickShapeAtPoint(model([sphere('mass',0,20)],{influences:[bulge]}),point(23)),'mass');
 assert.equal(pickShapeAtPoint(model([sphere('shell',0,20)],{shell:true,wall:2.6}),point(17.4)),'shell');
});

test('invalid or stale surface intersections do not select an arbitrary object',()=>{
 const m=model([sphere('mass')]);
 assert.equal(pickShapeAtPoint(m,point(40)),undefined);
 assert.equal(pickShapeAtPoint(m,point(NaN)),undefined);
 assert.equal(pickShapeAtPoint(m,point(10),-1),undefined);
 assert.equal(pickShapeAtPoint(model([{...sphere('disabled'),enabled:false}]),point(10)),undefined);
});

test('direct size uses one immutable snapshot and preserves actual rounded geometry and origin',()=>{
 const source={...makeShape('box'),id:'rounded',x:36,y:-12,z:25,rx:24,ry:-32,rz:67,width:40,height:30,depth:20,roundness:6,blend:8};
 const initial=model([source]),before=cloneModel(initial),factor=1.6;
 const patch=directTransformPatch(initial,source.id,'size',factor).shape,scaled={...source,...patch};
 assert.deepEqual([scaled.x,scaled.y,scaled.z,scaled.rx,scaled.ry,scaled.rz],[source.x,source.y,source.z,source.rx,source.ry,source.rz]);
 assert.equal(scaled.roundness,source.roundness*factor);assert.equal(scaled.blend,source.blend*factor);
 for(const p of [[44,5,30],[65,-21,12],[35,-12,25]]){
  const enlarged=p.map((value,index)=>[source.x,source.y,source.z][index]+factor*(value-[source.x,source.y,source.z][index]));
  assert.ok(Math.abs(evaluateShape(scaled,...enlarged)-factor*evaluateShape(source,...p))<1e-8);
 }
 assert.equal(directTransformPatch(initial,source.id,'size',1.2).shape.width,48,'later drag frames scale the initial width');
 assert.deepEqual(initial,before);
 validateModel(model([scaled]));
});

test('uniform size bounds preserve proportions, torus tube ratio and capped blend values',()=>{
 const source={...makeShape('box'),id:'limited',x:0,y:0,z:0,width:120,height:80,depth:40,roundness:20,blend:35};
 const large={...source,...directTransformPatch(model([source]),source.id,'size',100).shape};
 assert.equal(large.width,240);assert.equal(large.height,160);assert.equal(large.depth,80);assert.equal(large.roundness,40);assert.equal(large.blend,40);
 const small={...source,...directTransformPatch(model([source]),source.id,'size',.0001).shape};
 assert.equal(small.width,12);assert.equal(small.height,8);assert.equal(small.depth,4);
 const torus={...makeShape('torus'),id:'ring',x:0,y:0,z:0},ring={...torus,...directTransformPatch(model([torus]),torus.id,'size',2).shape};
 assert.equal(ring.roundness,torus.roundness,'torus rounding is a ratio rather than millimetres');
 for(const shape of [large,small,ring])validateModel(model([shape]));
});

test('direct sweep size scales path and radii, including transported closed curves and limits',()=>{
 const source={...makeShape('sweep'),id:'sweep',x:41,y:-22,z:17,rx:18,ry:-34,rz:12,closed:true,sectionMode:'transported',depthRatio:.5,path:[{x:-30,y:0,z:4,radius:4},{x:0,y:25,z:12,radius:8},{x:30,y:0,z:-5,radius:5},{x:0,y:-25,z:-9,radius:6}]};
 const initial=model([source]),before=cloneModel(initial),factor=1.5,scaled={...source,...directTransformPatch(initial,source.id,'size',factor).shape};
 assert.deepEqual([scaled.x,scaled.y,scaled.z],[source.x,source.y,source.z]);
 assert.equal(scaled.depthRatio,.5);assert.equal(scaled.sectionMode,'transported');assert.equal(scaled.closed,true);
 for(let i=0;i<source.path.length;i++)for(const key of ['x','y','z','radius'])assert.equal(scaled.path[i][key],source.path[i][key]*factor);
 for(const local of [point(-22,3,4),point(35,11,4),point(5,2,24)]){
  const beforeWorld=attachmentLocalToWorld(source,local),afterWorld=attachmentLocalToWorld(scaled,{x:local.x*factor,y:local.y*factor,z:local.z*factor});
  assert.ok(Math.abs(evaluateShape(scaled,afterWorld.x,afterWorld.y,afterWorld.z)-factor*evaluateShape(source,beforeWorld.x,beforeWorld.y,beforeWorld.z))<1e-7);
 }
 const limits=sweepScaleLimits(source);
 for(const [amount,expected] of [[.00001,limits[0]],[10000,limits[1]]]){
  const resized={...source,...directTransformPatch(initial,source.id,'size',amount).shape};
  validateModel(model([resized]));assert.ok(Math.abs(resized.path[0].radius-source.path[0].radius*expected)<1e-8);
 }
 assert.deepEqual(initial,before);
});

test('direct transforms preserve endpoint and component links while protecting independent linked cuts',()=>{
 const target={...makeShape('box'),id:'anchor',x:0,y:0,z:0};
 const curve={...makeShape('sweep'),id:'linked-curve',x:0,y:0,z:0};
 const attached=applyConstructionCommand(model([target,curve]),{action:'attach',sweepId:curve.id,endpoint:'start',targetShapeId:target.id,anchor:'center',offset:{x:0,y:0,z:0}});
 assert.equal(selectedHandle(attached,curve.id),undefined);
 for(const mode of ['move','size','rotate'])assert.equal(directTransformPatch(attached,curve.id,mode,2),undefined);
 const patch=directTransformPatch(attached,target.id,'move',12,'x');
 const moved=applyConstructionCommand(attached,{action:'update',id:target.id,patch:patch.shape});
 assert.equal(moved.attachments.length,1);assert.equal(moved.shapes.find(s=>s.id===curve.id).path[0].x,12);
 assert.equal(directTransformPatch(attached,target.id,'move',300,'x'),undefined,'a target cannot push its curve outside the path range');
 const component={id:'component',sourceId:'gopro-optical-assembly',name:'Camera',visible:true,x:20,y:10,z:0,rx:0,ry:0,rz:0,scale:1};
 let linked=applyConstructionCommand(model([target]),{action:'add-component',asset:component});
 linked=applyConstructionCommand(linked,{action:'component-clearance',assetId:component.id,shapeId:'fit-cut',clearance:{x:1,y:1,z:1}});
 for(const mode of ['move','size','rotate'])assert.equal(directTransformPatch(linked,'fit-cut',mode,2),undefined);
 const scaled=applyConstructionCommand(linked,{action:'update-component',id:component.id,patch:directTransformPatch(linked,component.id,'size',2).asset});
 assert.equal(scaled.componentClearances.length,1);assert.equal(scaled.shapes.find(s=>s.id==='fit-cut').width,46);
 assert.equal(directTransformPatch(linked,component.id,'move',600,'x'),undefined,'a linked cavity stays within shape transform limits');
});

test('translation and size clamp to constraints while rotations retain an equivalent Euler angle',()=>{
 const source={...sphere('shape'),x:290,rx:355,ry:-350,rz:15},m=model([source]);
 assert.deepEqual(directTransformPatch(m,source.id,'move',100,'x'),{shape:{x:300}});
 assert.deepEqual(directTransformPatch(m,source.id,'rotate',50,'x'),{shape:{rx:45}});
 assert.deepEqual(directTransformPatch(m,source.id,'rotate',-50,'y'),{shape:{ry:-40}});
 assert.deepEqual(directTransformPatch(m,source.id,'rotate',25),{shape:{rz:40}});
 const asset={id:'asset',sourceId:'gopro-optical-assembly',name:'Camera',visible:true,x:995,y:0,z:0,rx:0,ry:0,rz:990,scale:2},components=model([],{assets:[asset]});
 assert.deepEqual(directTransformPatch(components,asset.id,'size',100),{asset:{scale:10}});
 assert.deepEqual(directTransformPatch(components,asset.id,'size',.00001),{asset:{scale:.05}});
 assert.deepEqual(directTransformPatch(components,asset.id,'rotate',50),{asset:{rz:-40}});
 assert.deepEqual(directTransformPatch(components,asset.id,'move',50,'x'),{asset:{x:1000}});
});

test('complete rotation loops stay equivalent and cross both angular seams without clipping',()=>{
 const source={...sphere('shape'),rz:179},asset={id:'asset',sourceId:'gopro-optical-assembly',name:'Camera',visible:true,x:0,y:0,z:0,rx:0,ry:0,rz:179,scale:1};
 const m=model([source],{assets:[asset]});
 assert.equal(directTransformPatch(m,source.id,'rotate',4).shape.rz,-177);
 assert.equal(directTransformPatch(m,asset.id,'rotate',4).asset.rz,-177);
 const negative=model([{...source,rz:-179}],{assets:[{...asset,rz:-179}]});
 assert.equal(directTransformPatch(negative,source.id,'rotate',-4).shape.rz,177);
 assert.equal(directTransformPatch(negative,asset.id,'rotate',-4).asset.rz,177);
 for(const amount of [-3600,-720,-360,0,360,720,3600]){
  const shape=directTransformPatch(m,source.id,'rotate',amount).shape,component=directTransformPatch(m,asset.id,'rotate',amount).asset;
  assert.equal(shape.rz,179);assert.equal(component.rz,179);
 }
 for(const amount of [Number.MAX_VALUE,-Number.MAX_VALUE]){
  const angle=directTransformPatch(m,source.id,'rotate',amount).shape.rz;
  assert.ok(Number.isFinite(angle)&&angle>=-180&&angle<=180);
 }
});

test('direct grips, exponential sizing and wrapped rotation remain finite and predictable',()=>{
 assert.deepEqual(directGripOffset('move'),{x:0,y:0});assert.deepEqual(directGripOffset('size'),{x:56,y:-40});assert.deepEqual(directGripOffset('rotate'),{x:0,y:-72});
 assert.equal(directScaleFactor(0,0),1);assert.ok(directScaleFactor(80,-40)>1);assert.ok(directScaleFactor(-80,40)<1);
 assert.equal(directScaleFactor(1e6,-1e6),4);assert.equal(directScaleFactor(-1e6,1e6),.25);
 assert.equal(directScaleFactor(NaN,0),1);assert.equal(directScaleFactor(0,Infinity),1);
 const anchor={x:100,y:100},right={x:120,y:100},up={x:100,y:80},down={x:100,y:120};
 assert.ok(Math.abs(directRotationDelta(right,up,anchor)-90)<1e-8);assert.ok(Math.abs(directRotationDelta(right,down,anchor)+90)<1e-8);
 const polar=angle=>({x:anchor.x+20*Math.cos(angle*Math.PI/180),y:anchor.y-20*Math.sin(angle*Math.PI/180)});
 assert.ok(Math.abs(directRotationDelta(polar(179),polar(-179),anchor)-2)<1e-8);
 assert.ok(Math.abs(directRotationDelta(polar(-179),polar(179),anchor)+2)<1e-8);
 assert.equal(directRotationDelta(anchor,up,anchor),0);assert.equal(directRotationDelta(right,{x:NaN,y:80},anchor),0);
});

test('invalid gesture values and unsupported objects never produce a transform patch',()=>{
 const source=sphere('mass'),influence={...makeInfluence('bulge'),id:'field'},m=model([source],{influences:[influence]});
 for(const mode of ['move','size','rotate'])for(const value of [NaN,Infinity,-Infinity])assert.equal(directTransformPatch(m,source.id,mode,value),undefined);
 for(const value of [0,-1])assert.equal(directTransformPatch(m,source.id,'size',value),undefined);
 assert.equal(directTransformPatch(m,source.id,'rotate',1,'w'),undefined);assert.equal(directTransformPatch(m,source.id,'stretch',1),undefined);
 for(const mode of ['move','size','rotate'])assert.equal(directTransformPatch(m,influence.id,mode,2),undefined);
 assert.equal(directTransformPatch(m,'missing','size',2),undefined);
 source.enabled=false;assert.equal(directTransformPatch(m,source.id,'size',2),undefined);
 const invalidSweep={...makeShape('sweep'),id:'broken',path:[{x:0,y:0,z:0,radius:0}]};
 assert.equal(directTransformPatch(model([invalidSweep]),invalidSweep.id,'size',2),undefined);
});
