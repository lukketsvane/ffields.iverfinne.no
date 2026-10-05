import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MODEL,cloneModel,makeInfluence,evaluateBase} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {selectedHandle,projectedHandleHit,pickShapeAtPoint} from '../lib/direct-manipulation.ts';

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
