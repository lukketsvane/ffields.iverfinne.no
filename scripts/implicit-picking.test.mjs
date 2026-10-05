import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_MODEL,DEFAULT_MODEL,cloneModel,evaluateBase,withoutRipples,lensCenters,lensY} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {DEFAULT_LATTICE} from '../lib/lattice.ts';
import {resolveAttachments} from '../lib/attachments.ts';
import {pickCurrentSurface} from '../lib/implicit-picking.ts';
import {pickShapeAtPoint} from '../lib/direct-manipulation.ts';
import {createStereoCameraStudy} from '../lib/stereo-camera-study.ts';

const point=(x=0,y=0,z=0)=>({x,y,z});
const sphere=(id='mass',x=0,radius=10)=>({...makeShape('sphere'),id,x,y:0,z:0,width:radius*2,height:radius*2,depth:radius*2,blend:0});
const box=(id='block')=>({...makeShape('box'),id,x:0,y:0,z:0,width:40,height:40,depth:40,roundness:0,blend:0});
const model=(shapes=[],extra={})=>({...cloneModel(DEFAULT_MODEL),baseEnabled:false,asymmetry:0,influences:[],shapes,...extra});
const ray=(origin=point(0,0,50),direction=point(0,0,-1))=>({origin,direction});
const deterministic={now:()=>0};
const pick=(m,r=ray(),options={})=>pickCurrentSurface(m,r,{...deterministic,...options});
const near=(actual,expected,tolerance=1e-4)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected}`);
const surface=(m,hit)=>{assert.ok(hit,'expected current model intersection');const staticModel=resolveAttachments(withoutRipples(m));assert.ok(Math.abs(evaluateBase(staticModel,hit.point.x,hit.point.y,hit.point.z))<=1e-5);};

test('new and moved forms are picked independently of empty or stale preview geometry',()=>{
 const old=model([sphere('old')]),moved=model([sphere('old',60)]),created=model([sphere('new',-70)]);
 assert.equal(pick(old).shapeId,'old');
 assert.equal(pick(moved),undefined,'the previous position cannot select its stale displayed mesh');
 const movedHit=pick(moved,ray(point(60,0,50)));surface(moved,movedHit);assert.equal(movedHit.shapeId,'old');near(movedHit.distance,40);
 const newHit=pick(created,ray(point(-70,0,50)));surface(created,newHit);assert.equal(newHit.shapeId,'new');near(newHit.point.z,10);
 assert.equal(pick(model()),undefined,'an empty authored model has no current material');
 assert.equal(pick(model([{...sphere(),enabled:false}])),undefined,'disabled geometry leaves no old hit');
});

test('direction normalization gives world millimetre distances without mutating input',()=>{
 const m=model([sphere()]),r=ray(point(0,0,50),point(0,0,-800)),before=structuredClone({m,r});
 const hit=pick(m,r);surface(m,hit);near(hit.distance,40);near(hit.point.z,10);
 assert.deepEqual({m,r},before);
 const tiny=pick(m,ray(point(0,0,50),point(0,0,-1e-150)));near(tiny.distance,40);
});

test('nearest forward material is selected rather than a later or buried union',()=>{
 const front={...sphere('front'),z:20},back={...sphere('back'),z:-20},buried={...sphere('buried',0,4),z:20};
 const m=model([back,front,buried]),hit=pick(m,ray(point(0,0,100)));
 surface(m,hit);near(hit.point.z,30);assert.equal(hit.shapeId,'front');
});

test('CSG through-holes do not intercept touches and their actual inner walls do',()=>{
 const bore={...makeShape('cylinder'),id:'bore',x:0,y:0,z:0,width:16,height:100,depth:16,rx:90,operation:'subtract',blend:0};
 const m=model([box(),bore]);
 assert.equal(pick(m,ray(point(0,0,100))),undefined,'ray passes through the actual opening');
 const hit=pick(m,ray(point(),point(1,0,0)));surface(m,hit);near(hit.distance,8);assert.equal(hit.shapeId,'bore');
 const outer=pick(m,ray(point(12,0,100)));surface(m,outer);near(outer.point.z,20);assert.equal(outer.shapeId,'block');
});

test('intersection operations use the clipped current solid',()=>{
 const clip={...sphere('clip'),operation:'intersect'},m=model([box(),clip]),hit=pick(m);
 surface(m,hit);near(hit.point.z,10);assert.equal(hit.shapeId,'clip');
 assert.equal(pick(m,ray(point(15,0,50))),undefined);
});

test('inside material picks its nearest forward exit; a shell cavity picks the inner wall',()=>{
 const solid=model([sphere('solid',0,20)]),exit=pick(solid,ray(point(),point(0,0,1)));
 surface(solid,exit);near(exit.distance,20);assert.equal(exit.shapeId,'solid');
 const shell=model([sphere('shell',0,20)],{shell:true,wall:2.6}),inner=pick(shell,ray(point(),point(0,0,1)));
 surface(shell,inner);near(inner.distance,17.4);assert.equal(inner.shapeId,'shell');
 const materialExit=pick(shell,ray(point(0,0,19),point(0,0,1)));surface(shell,materialExit);near(materialExit.distance,1);
 const onSurface=pick(solid,ray(point(0,0,20),point(0,0,1)));near(onSurface.distance,0);
});

test('rotations and anisotropic fields are sampled without assuming unit distance values',()=>{
 const rotated={...box('turned'),width:40,height:20,depth:12,rz:90},m=model([rotated]),hit=pick(m,ray(point(0,100,0),point(0,-4,0)));
 surface(m,hit);near(hit.point.y,20);assert.equal(hit.shapeId,'turned');
 const flat={...sphere('flat'),width:120,height:4,depth:90,rx:31,ry:47,rz:16},flatModel=model([flat]);
 const flatHit=pick(flatModel,ray(point(0,0,100)));surface(flatModel,flatHit);assert.equal(flatHit.shapeId,'flat');
});

test('attached sweeps are picked where the current target resolved them',()=>{
 const target={...sphere('anchor',30),enabled:false},sweep={...makeShape('sweep'),id:'curve',x:0,y:0,z:0,blend:0,path:[{x:-20,y:0,z:0,radius:4},{x:50,y:0,z:0,radius:4}]};
 const m=model([target,sweep],{attachments:[{sweepId:'curve',endpoint:'start',targetShapeId:'anchor',anchor:'center',offset:point()}]});
 const before=cloneModel(m),hit=pick(m,ray(point(30,0,50)));
 surface(m,hit);assert.equal(hit.shapeId,'curve');near(hit.point.z,4);
 assert.equal(pick(m,ray(point(-20,0,50))),undefined,'the stale stored endpoint does not leave a selectable surface');
 assert.deepEqual(m,before,'attachment resolution stays pure');
});

test('lattice voids and material use the complete static composed field',()=>{
 const m=model([box('core')],{lattice:{...DEFAULT_LATTICE,enabled:true,skin:0,thickness:1.2,gradient:.5,cellSize:8}}),r=ray(point(3.1,2.4,50)),hit=pick(m,r);
 surface(m,hit);assert.equal(hit.shapeId,undefined,'an internal periodic sheet may have no locally sensitive primitive contributor');
 // Independently scan at 0.005 mm and bisect the first sign bracket, rather
 // than mirroring the picker's spacing or trusting the bounding-box face.
 const staticModel=withoutRipples(m);let previousValue=evaluateBase(staticModel,3.1,2.4,50),previous=0,reference;
 for(let distance=.005;distance<=90;distance+=.005){const value=evaluateBase(staticModel,3.1,2.4,50-distance);if(value<0&&previousValue>=0){let lo=previous,hi=distance;for(let i=0;i<30;i++){const mid=(lo+hi)/2;if(evaluateBase(staticModel,3.1,2.4,50-mid)<0)hi=mid;else lo=mid;}reference=(lo+hi)/2;break;}previous=distance;previousValue=value;}
 assert.ok(reference!==undefined);near(hit.distance,reference,.001);
 const emptyColumn=model([box('honeycomb')],{lattice:{...DEFAULT_LATTICE,enabled:true,kind:'honeycomb',axis:'z',skin:0,thickness:1.2,cellSize:8}});
 assert.equal(pick(emptyColumn),undefined,'an open honeycomb cell does not act like an exterior solid face');
});

test('ripples stay in the static preview selection frame',()=>{
 const wave={...DEFAULT_MODEL.influences[0],enabled:true,strength:20,falloff:'constant',phase:90};
 const m=model([sphere('static')],{influences:[wave]}),hit=pick(m);
 surface(m,hit);near(hit.point.z,10);assert.equal(hit.shapeId,'static');
 const base={...cloneModel(DEFAULT_MODEL),influences:[wave],shapes:[],asymmetry:0};
 const baseHit=pick(base);surface(base,baseHit);near(baseHit.point.z,base.depth/2);assert.equal(baseHit.shapeId,undefined);
});

test('the current camera starter lens hole picks its rear inner shell, not the old front face',()=>{
 const camera=cloneModel(CAMERA_MODEL);camera.influences=camera.influences.filter(influence=>influence.kind==='wave');
 const x=lensCenters(camera)[0],y=lensY(camera),hit=pick(camera,ray(point(x,y,100)));
 surface(camera,hit);near(hit.point.z,-camera.depth/2+camera.wall);assert.equal(hit.shapeId,undefined);
});

test('the authored stereo collar is picked through resolved swept and component-cut geometry',()=>{
 const stereo=createStereoCameraStudy(),hit=pick(stereo,ray(point(-60,25.3,100)));
 surface(stereo,hit);assert.equal(hit.shapeId,'stereo-shoulder-left');near(hit.point.z,16.0488,.001);
 assert.equal(pick(stereo,ray(point(-36,0,100))),undefined,'the measured camera corridor remains open front to rear');
});

test('grazing surfaces remain selectable while a nearby ray misses',()=>{
 const m=model([sphere()]);
 const grazing=pick(m,ray(point(9.999,0,50)));surface(m,grazing);assert.ok(grazing.point.z>0,'front grazing root wins over the back root');
 const tangent=pick(m,ray(point(10,0,50)));surface(m,tangent);near(tangent.point.z,0,.001);
 assert.equal(pick(m,ray(point(10.0001,0,50))),undefined,'near surface alone is not an intersection');
 assert.equal(pick(m,ray(point(30,0,50))),undefined,'bounds miss');
 assert.equal(pick(m,ray(point(0,0,50),point(0,0,1))),undefined,'a ray facing away has no forward intersection');
});

test('field ceilings reserve provenance and never return a partially established surface',()=>{
 const m=model([sphere()]);
 // Bounds start four mm before the surface: nine half-mm samples plus three
 // provenance evaluations. This exact threshold includes provenance work.
 assert.equal(pick(m,ray(),{maxEvaluations:11}),undefined);
 const hit=pick(m,ray(),{maxEvaluations:12});surface(m,hit);assert.equal(hit.shapeId,'mass');
 for(const value of [0,-1,NaN,Infinity,.9])assert.equal(pick(m,ray(),{maxEvaluations:value}),undefined);
 assert.equal(pick(m,ray(point(9.999,0,50)),{maxEvaluations:20}),undefined,'bounded refinement cannot invent a grazing result');
});

test('elapsed ceilings include setup and provenance, with zero and invalid budgets rejected',()=>{
 const m=model([sphere()]);
 for(const value of [0,-1,NaN,Infinity])assert.equal(pick(m,ray(),{budgetMs:value}),undefined);
 let ticks=0;assert.equal(pickCurrentSurface(m,ray(),{budgetMs:2,now:()=>ticks++}),undefined);
 assert.equal(ticks,3,'setup cannot continue after its time budget');
 let clock=0,reads=0;const provenanceModel=model([sphere()]),shapes=provenanceModel.shapes;
 Object.defineProperty(provenanceModel,'shapes',{get(){if(++reads===3)clock=9;return shapes;},enumerable:true});
 assert.equal(pickCurrentSurface(provenanceModel,ray(),{now:()=>clock}),undefined,'provenance reads the input after sampling, and its late result is rejected too');
 assert.equal(pickCurrentSurface(m,ray(),{now:()=>NaN}),undefined);
 assert.equal(pickCurrentSurface(m,ray(),{now:()=>{throw Error('clock');}}),undefined);
});

test('provenance stops before each compilation and field sample when its guard runs out',()=>{
 const m=model([sphere('outer'),sphere('buried',0,4)]),p=point(0,0,10);
 let permitted=0,attempted=0,compiles=0;
 const limited={withinBudget(stage){if(stage==='compile'){compiles++;return true;}attempted++;if(permitted===2)return false;permitted++;return true;}};
 assert.equal(pickShapeAtPoint(m,p,1e-5,limited),undefined);assert.equal(permitted,2);assert.equal(attempted,3);assert.equal(compiles,3);
 const complete={withinBudget(stage){if(stage==='evaluate')permitted++;return true;}};
 permitted=0;assert.equal(pickShapeAtPoint(m,p,1e-5,complete),'outer');assert.equal(permitted,5);
 let fields=0,compileChecks=0;
 const expired={withinBudget(stage){if(stage==='evaluate'){fields++;return true;}return ++compileChecks<2;}};
 assert.equal(pickShapeAtPoint(m,p,1e-5,expired),undefined);assert.equal(fields,0,'no field work begins when compiling reaches the deadline');
});

test('invalid rays and broken current geometry fail quietly without arbitrary selection',()=>{
 const m=model([sphere()]);
 for(const r of [undefined,{},ray(point(),point()),ray(point(Infinity),point(1)),ray(point(),point(NaN)),ray(point(),point(Number.MAX_VALUE,Number.MAX_VALUE,Number.MAX_VALUE))])assert.equal(pickCurrentSurface(m,r,deterministic),undefined);
 const broken=model([{...makeShape('sweep'),path:[]}]);assert.equal(pick(broken),undefined);
});
