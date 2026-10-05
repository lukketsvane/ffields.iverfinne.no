import test from 'node:test';
import assert from 'node:assert/strict';
import {blankConstruction,applyConstructionCommand as apply} from '../lib/construction.ts';
import {cloneModel,validateModel,evaluateBase} from '../lib/form-engine.ts';
import {DEFAULT_LATTICE} from '../lib/lattice.ts';
import {makeShape} from '../lib/shapes.ts';

const loop=()=>({...makeShape('sweep'),id:'loop',name:'Periodic collar',x:0,y:0,z:0,blend:0,closed:true,path:[
 {x:-20,y:-20,z:0,radius:3},{x:20,y:-20,z:0,radius:3},
 {x:20,y:20,z:0,radius:3},{x:-20,y:20,z:0,radius:3},
]});

test('closed model import retains editable controls and the closing segment',()=>{
 const model=apply(blankConstruction(),{action:'add',shape:loop()});
 const imported=validateModel(JSON.parse(JSON.stringify(model)));
 assert.deepEqual(imported,model);
 assert.equal(imported.shapes[0].path.length,4);
 assert.ok(evaluateBase(imported,-25,0,0)<0,'periodic left segment exists');
 assert.ok(evaluateBase(imported,0,0,0)>0,'loop interior stays open');
 const opened=apply(imported,{action:'update',id:'loop',patch:{closed:false}});
 assert.deepEqual(opened.shapes[0].path,imported.shapes[0].path);
 assert.ok(evaluateBase(opened,-25,0,0)>0,'opening removes the closing segment');
});

test('malformed closure imports and commands leave the prior model intact',()=>{
 const model=apply(blankConstruction(),{action:'add',shape:loop()}),saved=cloneModel(model);
 for(const closed of [1,'true',null,{},[]]){
  assert.throws(()=>validateModel({...model,shapes:[{...loop(),closed}]}),/closure/);
  assert.throws(()=>apply(model,{action:'update',id:'loop',patch:{closed}}),/closure/);
  assert.deepEqual(model,saved);
 }
 for(const path of [loop().path.slice(0,2),[...loop().path,loop().path[0]],[...loop().path,loop().path[1]]]){
  assert.throws(()=>validateModel({...model,shapes:[{...loop(),path}]}),/path/);
  assert.throws(()=>apply(model,{action:'update',id:'loop',patch:{path}}),/path/);
 }
 assert.throws(()=>validateModel({...model,shapes:[{...makeShape('box'),closed:true}]}),/closure/);
 assert.deepEqual(model,saved);
});

test('closed lattice-region imports follow the same authored-path rules',()=>{
 const base=blankConstruction(),region=loop();
 const model=validateModel({...base,lattice:{...DEFAULT_LATTICE,enabled:true,region}});
 assert.equal(model.lattice.region.closed,true);
 assert.equal(model.lattice.region.path.length,4);
 for(const patch of [{closed:'yes'},{path:[...region.path,region.path[0]]},{kind:'box',closed:true}]){
  assert.throws(()=>validateModel({...model,lattice:{...model.lattice,region:{...region,...patch}}}));
 }
});
