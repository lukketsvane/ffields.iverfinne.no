import test from 'node:test';
import assert from 'node:assert/strict';
import {applyConstructionCommand as apply} from '../lib/construction.ts';
import {createTrussStudy} from '../lib/truss-study.ts';
import {evaluateBase,cloneModel} from '../lib/form-engine.ts';
import {attachmentLocalToWorld} from '../lib/attachments.ts';
const zero={x:0,y:0,z:0};
const near=(a,b)=>{for(const axis of ['x','y','z'])assert.ok(Math.abs(a[axis]-b[axis])<1e-8,axis)};

test('fixture sleeve, flange and holes move rigidly while attached ribs follow',()=>{
 const model=createTrussStudy(),before=cloneModel(model),ids=['a-sleeve','a-flange','a-bore','a-bolt-0','a-bolt-1','a-bolt-2','a-bolt-3'];
 const command={action:'transform',ids,translation:{x:6,y:0,z:0},rotation:{x:0,y:0,z:12},pivot:{x:-78,y:-15,z:-30}};
 const changed=apply(model,command),angle=12*Math.PI/180;
 const turn=(p)=>({x:-72+(p.x+78)*Math.cos(angle)-(p.y+15)*Math.sin(angle),y:-15+(p.x+78)*Math.sin(angle)+(p.y+15)*Math.cos(angle),z:p.z});
 for(const id of ids){
  const old=model.shapes.find(s=>s.id===id),next=changed.shapes.find(s=>s.id===id);
  near(attachmentLocalToWorld(next,{x:3,y:5,z:7}),turn(attachmentLocalToWorld(old,{x:3,y:5,z:7})));
 }
 const rib=model.shapes.find(s=>s.id==='upper-front'),nextRib=changed.shapes.find(s=>s.id==='upper-front');
 near(attachmentLocalToWorld(nextRib,nextRib.path[0]),turn(attachmentLocalToWorld(rib,rib.path[0])));
 assert.equal(changed.attachments.length,model.attachments.length);
 const bore=changed.shapes.find(s=>s.id==='a-bore');assert.ok(evaluateBase(changed,bore.x,bore.y,bore.z)>0,'the moved bore remains open');
 assert.deepEqual(model,before,'source remains unchanged');
});
test('group transforms validate atomically and preserve linked sweeps when both objects move',()=>{
 const model=createTrussStudy(),saved=cloneModel(model);
 const command={action:'transform',ids:model.shapes.map(s=>s.id),translation:{x:4,y:-3,z:2},rotation:{x:9,y:7,z:13},pivot:zero};
 const transformed=apply(model,command);assert.equal(transformed.attachments.length,10);
 for(const shape of transformed.shapes.filter(s=>s.kind==='sweep'))assert.deepEqual(shape.path,model.shapes.find(s=>s.id===shape.id).path);
 for(const invalid of [{...command,ids:[]},{...command,ids:['a-flange','a-flange']},{...command,ids:['missing']},{...command,translation:{x:NaN,y:0,z:0}},{...command,translation:{x:600,y:0,z:0}},{...command,pivot:{...zero,extra:1}}]){
  assert.throws(()=>apply(model,invalid));assert.deepEqual(model,saved);
 }
 assert.deepEqual(apply(model,{action:'transform',ids:['a-flange'],translation:zero,rotation:zero,pivot:zero}),model);
});
