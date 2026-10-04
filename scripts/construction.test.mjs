import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConstructionCommand as apply,blankConstruction} from '../lib/construction.ts';
import {cloneModel,DEFAULT_MODEL,validateModel,evaluateBase,generateMesh} from '../lib/form-engine.ts';
import {createTrussStudy,TRUSS_STUDY_COMMANDS} from '../lib/truss-study.ts';

test('blank construction and commands preserve source documents and ordering',()=>{
 const source=cloneModel(DEFAULT_MODEL),saved=cloneModel(source);
 let model=apply(source,{action:'start',name:'Authored from scratch'});
 assert.deepEqual(source,saved);assert.equal(model.baseEnabled,false);assert.equal(model.influences.length,0);
 assert.equal(generateMesh(model,20).indices.length,0);
 model=apply(model,{action:'add',shape:{kind:'sphere',id:'first',x:0,y:0,z:0,width:30,height:30,depth:30,blend:0}});
 model=apply(model,{action:'add',shape:{kind:'box',id:'cut',operation:'subtract',x:0,y:0,z:0,width:10,height:40,depth:40,roundness:0,blend:0}});
 assert.ok(evaluateBase(model,0,0,0)>0);
 const earlier=cloneModel(model);
 model=apply(model,{action:'move',id:'cut',index:0});
 assert.ok(evaluateBase(model,0,0,0)<0,'CSG position changes the actual result');
 assert.equal(earlier.shapes[0].id,'first');
 model=apply(model,{action:'update',id:'first',patch:{name:'Changed',x:10}});
 model=apply(model,{action:'mirror',id:'first',axis:'x',newId:'reflected'});
 assert.equal(model.shapes[2].x,-10);assert.equal(model.shapes[1].x,10);
 model=apply(model,{action:'remove',id:'reflected'});assert.equal(model.shapes.length,2);
});

test('invalid construction commands fail atomically',()=>{
 const model=apply(blankConstruction(),{action:'add',shape:{kind:'sweep',id:'rib'}}),saved=cloneModel(model);
 for(const command of [
  {action:'start',name:17},{action:'start',unknown:true},
  {action:'add',shape:{kind:'sweep',id:'rib'}},
  {action:'add',shape:{kind:'sweep',path:[]}},
  {action:'add',shape:{kind:'sphere',untrusted:true}},
  {action:'update',id:'rib',patch:{id:'new'}},
  {action:'update',id:'rib',patch:{x:Infinity}},
  {action:'mirror',id:'rib',axis:'banana'},
  {action:'remove',id:'missing'},
  {action:'move',id:'rib',index:-1},{action:'move',id:'rib',index:8},
  {action:'unexpected'},null,
 ]){assert.throws(()=>apply(model,command));assert.deepEqual(model,saved);}
});

test('the one worked bracket is reproducible through public from-scratch commands',()=>{
 const study=createTrussStudy();
 assert.equal(TRUSS_STUDY_COMMANDS[0].action,'start');
 assert.ok(study.shapes.filter(s=>s.kind==='sweep').length>=8);
 assert.equal(study.baseEnabled,false);assert.deepEqual(study.influences,[]);
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(study))),study);
 assert.deepEqual(createTrussStudy(),study,'recipe has stable authored identities');
 for(const [x,y,z] of [[-92,-15,-30],[-68,-60,42],[92,70,0]])assert.ok(evaluateBase(study,x,y,z)>0,'all interface bores are open');
});
