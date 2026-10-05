import test from 'node:test';
import assert from 'node:assert/strict';
import {materialModePatch,quickShape,scaleSweep,sweepScaleLimits} from '../lib/quick-modelling.ts';
import {blankConstruction,applyConstructionCommand} from '../lib/construction.ts';
import {DEFAULT_MODEL,cloneModel,validateModel} from '../lib/form-engine.ts';
import {makeShape,evaluateShape,shapeBounds} from '../lib/shapes.ts';

test('first touch primitive starts at the working origin; every quick kind is a valid atomic command',()=>{
 const blank=blankConstruction(),before=structuredClone(blank);
 for(const kind of ['box','sphere','capsule','cylinder','torus','sweep']){
  const shape=quickShape(blank,kind,'union','body');
  assert.deepEqual([shape.x,shape.y,shape.z],[0,0,0]);
  const model=applyConstructionCommand(blank,{action:'add',shape});assert.equal(model.shapes.length,1);assert.equal(model.shapes[0].operation,'union');
 }
 assert.deepEqual(blank,before);
});

test('touch cuts begin inside the selected solid and cylinder holes pass front to back',()=>{
 const anchor={...makeShape('box'),x:-41,y:16,z:22,width:60,height:44,depth:30},model={...blankConstruction(),shapes:[anchor]},before=structuredClone(model);
 const cut=quickShape(model,'cylinder','subtract',anchor.id),b=shapeBounds(cut);
 assert.deepEqual([cut.x,cut.y,cut.z],[-41,16,22]);assert.equal(cut.blend,0);assert.equal(cut.rx,90);
 assert.ok(b[2]<anchor.z-anchor.depth/2);assert.ok(b[5]>anchor.z+anchor.depth/2);
 const next=applyConstructionCommand(model,{action:'add',shape:cut});
 assert.equal(next.shapes[1].operation,'subtract');assert.ok(evaluateShape(cut,anchor.x,anchor.y,anchor.z)<0);assert.deepEqual(model,before);
});

test('a quick union overlaps the selected primitive or base instead of starting far away',()=>{
 const model=cloneModel(DEFAULT_MODEL),added=quickShape(model,'box','union','body');
 assert.ok(added.x-added.width/2<model.width/2);
 const anchor={...makeShape('box'),x:50,width:70},selected={...blankConstruction(),shapes:[anchor]},next=quickShape(selected,'sphere','union',anchor.id);
 assert.ok(next.x-next.width/2<anchor.x+anchor.width/2);assert.equal(next.y,anchor.y);assert.equal(next.z,anchor.z);
});

test('quick sweep size scales authored geometry, radii and the resulting field rather than unused dimensions',()=>{
 const source={...makeShape('sweep'),x:0,y:0,z:0,rx:0,ry:0,rz:0,closed:true,sectionMode:'transported',depthRatio:.5,path:[{x:-30,y:0,z:4,radius:4},{x:0,y:25,z:12,radius:8},{x:30,y:0,z:-5,radius:5},{x:0,y:-25,z:-9,radius:6}]},before=structuredClone(source),factor=1.5,scaled={...source,...scaleSweep(source,factor)};
 validateModel({...blankConstruction(),shapes:[scaled]});
 assert.equal(scaled.closed,true);assert.equal(scaled.sectionMode,'transported');assert.equal(scaled.depthRatio,.5);
 for(const point of source.path)for(const axis of ['x','y','z','radius'])assert.equal(scaled.path[source.path.indexOf(point)][axis],point[axis]*factor);
 for(const point of [[-22,3,4],[35,11,4],[-8,-25,-8],[5,2,24]])assert.ok(Math.abs(evaluateShape(scaled,...point.map(value=>value*factor))-factor*evaluateShape(source,...point))<1e-7);
 assert.deepEqual(source,before);
});

test('minimum and maximum sweep size stay valid even at floating-point limits, and invalid factors do not mutate',()=>{
 const source={...makeShape('sweep'),path:[{x:-239,y:2,z:3,radius:1.7},{x:230,y:5,z:9,radius:23},{x:3,y:-171,z:4,radius:11}]},before=structuredClone(source),limits=sweepScaleLimits(source);
 for(const factor of limits)validateModel({...blankConstruction(),shapes:[{...source,...scaleSweep(source,factor)}]});
 for(const factor of [0,NaN,Infinity,limits[1]+1])assert.throws(()=>scaleSweep(source,factor));assert.deepEqual(source,before);
});

test('material mode changes preserve authored lattice settings and region while switching actual shell/core geometry',()=>{
 const region={...makeShape('box'),id:'lattice-region',width:50,height:50,depth:50},source={...blankConstruction(),shapes:[makeShape('box')],lattice:{enabled:true,kind:'diamond',cellSize:13.5,thickness:2.8,gradient:.45,skin:3.4,axis:'x',reveal:.72,region}},before=structuredClone(source);
 let current=source;
 for(const mode of ['solid','hollow','cellular']){
  current={...current,...materialModePatch(current,mode)};validateModel(current);
  assert.equal(current.shell,mode==='hollow');assert.equal(current.lattice.enabled,mode==='cellular');
  const {enabled,...settings}=current.lattice;assert.deepEqual(settings,(({enabled,...rest})=>rest)(source.lattice));
  assert.deepEqual(current.shapes,source.shapes);
 }
 assert.deepEqual(source,before);
 const first={...blankConstruction(),...materialModePatch(blankConstruction(),'cellular')};validateModel(first);assert.equal(first.lattice.reveal,.6);
});
