import test from 'node:test';
import assert from 'node:assert/strict';
import {PROJECT_TEMPLATES,createProjectTemplate} from '../lib/project-templates.ts';
import {validateModel,evaluateBase,generateMesh,binarySTL,sectionContours} from '../lib/form-engine.ts';
import {MAX_SHAPES} from '../lib/shapes.ts';

test('eight distinct templates are valid editable documents, not saved user variants',()=>{
 assert.equal(PROJECT_TEMPLATES.length,8);
 assert.equal(new Set(PROJECT_TEMPLATES.map(t=>t.id)).size,8);
 assert.equal(new Set(PROJECT_TEMPLATES.map(t=>JSON.stringify(t.model.shapes))).size,8);
 assert.equal(new Set(PROJECT_TEMPLATES.map(t=>t.model.lattice.kind)).size,4);
 for(const template of PROJECT_TEMPLATES){
  const model=validateModel(createProjectTemplate(template.id));
  assert.ok(model.shapes.length>=4&&model.shapes.length<=MAX_SHAPES);
  assert.ok(model.shapes.some(shape=>shape.operation==='subtract'));
  assert.equal(model.baseEnabled,false);
  assert.equal(model.lattice.enabled,true);
  assert.deepEqual(model.influences,[]);
 }
});

test('loading and editing a template never changes the reusable source document',()=>{
 const first=createProjectTemplate('counterflow'),second=createProjectTemplate('counterflow');
 first.shapes[0].width=120;first.lattice.cellSize=30;first.lattice.region.width=100;
 assert.notEqual(first.shapes[0].width,second.shapes[0].width);
 assert.notEqual(first.lattice.cellSize,second.lattice.cellSize);
 assert.notEqual(first.lattice.region.width,second.lattice.region.width);
 assert.deepEqual(second,createProjectTemplate('counterflow'));
 assert.throws(()=>createProjectTemplate('missing'),/Unknown/);
});

test('every template produces finite nonempty geometry and a real STL',()=>{
 for(const template of PROJECT_TEMPLATES){
  const mesh=generateMesh(template.model,54);
  assert.ok(mesh.indices.length>300,template.id+' has a visible surface');
  assert.ok(mesh.positions.every(Number.isFinite),template.id+' vertices are finite');
  assert.ok(mesh.normals.every(Number.isFinite),template.id+' normals are finite');
  assert.ok(mesh.volume>0,template.id+' encloses material');
  const stl=binarySTL(mesh);
  assert.equal(stl.byteLength,84+mesh.indices.length/3*50);
 }
});

test('template ports stay open and sections expose actual cellular geometry',()=>{
 const counterflow=createProjectTemplate('counterflow');
 assert.ok(evaluateBase(counterflow,-20,86,0)>0,'left upper port is open');
 assert.ok(evaluateBase(counterflow,20,-86,0)>0,'right lower port is open');
 const rotor=createProjectTemplate('vortex');
 assert.ok(evaluateBase(rotor,0,0,0)>0,'rotor shaft is open');
 const panel=createProjectTemplate('auxetic');
 assert.ok(evaluateBase(panel,-65,-41,0)>0,'panel mounting bore is open');
 assert.ok(sectionContours(panel,0,110).segments.length>100,'panel has many cell contours');
 const open=createProjectTemplate('counterflow'),closed=createProjectTemplate('counterflow');
 closed.lattice.reveal=0;
 assert.ok(generateMesh(open,48).volume<generateMesh(closed,48).volume,'cutaway removes real material');
});
