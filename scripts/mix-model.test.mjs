import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_MODEL,cloneModel,makeInfluence,validateModel} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {mixModelFields} from '../lib/mix-model.ts';

test('mixed fields avoid shape and asset IDs and survive JSON reload',()=>{
 const mass={...cloneModel(DEFAULT_MODEL),influences:[],shapes:[{...makeShape('box'),id:'wave-1'}],assets:[{id:'grip-1',sourceId:'pololu-usb-c',name:'USB-C',visible:true,x:0,y:0,z:0,rx:0,ry:0,rz:0,scale:1}]};
 const fields={...cloneModel(DEFAULT_MODEL),influences:[{...makeInfluence('wave'),id:'wave-1',name:'Source wave'},{...makeInfluence('grip'),id:'grip-1',name:'Source grip'},{...makeInfluence('twist'),id:'wave-1-mix-1'}]};
 const massBefore=cloneModel(mass),fieldsBefore=cloneModel(fields);
 validateModel(mass);validateModel(fields);
 const mixed=mixModelFields(mass,fields);
 assert.deepEqual(mixed.shapes,mass.shapes);
 assert.deepEqual(mixed.assets,mass.assets);
 assert.equal(mixed.influences[2].id,'wave-1-mix-1','a remapped field does not steal another source field ID');
 for(let i=0;i<fields.influences.length;i++){
  const {id:sourceId,...source}=fields.influences[i],{id:mixedId,...copied}=mixed.influences[i];
  assert.deepEqual(copied,source,'only field IDs may change');
  if(i<2)assert.notEqual(mixedId,sourceId);
 }
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(mixed))),mixed);
 assert.deepEqual(mass,massBefore,'mass source remains unchanged');
 assert.deepEqual(fields,fieldsBefore,'fields source remains unchanged');
 mixed.influences[0].strength=0;
 assert.notEqual(fields.influences[0].strength,0,'copied fields do not share references with their source');
});

test('reserved IDs and maximum-length collisions get unique bounded replacements',()=>{
 const longId='x'.repeat(100);
 const mass={...cloneModel(DEFAULT_MODEL),influences:[],shapes:[{...makeShape('sphere'),id:longId}]};
 const fields={...cloneModel(DEFAULT_MODEL),influences:['body','regions','enclosure','canvas',longId].map(id=>({...makeInfluence('wave'),id}))};
 const mixed=mixModelFields(mass,fields),ids=mixed.influences.map(f=>f.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(ids.every(id=>id.length<=100));
 assert.ok(ids.every(id=>!['body','regions','enclosure','canvas',longId].includes(id)));
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(mixed))),mixed);
});

test('mixing fields without collisions preserves their original IDs and mass settings',()=>{
 const mass={...cloneModel(DEFAULT_MODEL),name:'Chosen mass',width:180,baseEnabled:false,shapes:[makeShape('torus')],influences:[makeInfluence('pinch')]};
 const fields={...cloneModel(DEFAULT_MODEL),influences:[{...makeInfluence('twist'),id:'source-twist'}]};
 const mixed=mixModelFields(mass,fields);
 assert.deepEqual(mixed,{...mass,influences:fields.influences});
});
