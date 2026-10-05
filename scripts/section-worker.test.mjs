import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {cloneModel,DEFAULT_MODEL,sectionContours} from '../lib/form-engine.ts';
import {LatestPreviewScheduler} from '../lib/preview-scheduler.ts';

test('actual section worker aborts a superseded slice and latest queue preserves idle contour detail',async()=>{
 const workerUrl=new URL('../lib/section-worker.ts',import.meta.url),source=await readFile(workerUrl,'utf8');
 const resolved=source.replace(/from '\.\/([^']+)'/g,(_match,name)=>`from '${new URL(name+'.ts',workerUrl).href}'`);
 const output=ts.transpileModule(resolved,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
 const messages=[],surface={onmessage:null,postMessage:message=>messages.push(message)},previous=globalThis.self;
 globalThis.self=surface;
 try{
  await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));
  const model=cloneModel(DEFAULT_MODEL),queue=new LatestPreviewScheduler();
  const first={id:1,model,resolution:160,z:0};queue.enqueue(first);
  const pending=surface.onmessage({data:first});
  const activeId=queue.current.id;queue.invalidate(2);
  queue.enqueue({id:2,model,resolution:48,z:4});
  await surface.onmessage({data:{cancel:activeId}});await pending;
  assert.deepEqual(messages[0],{id:1,aborted:true});
  const next=queue.finish(1);assert.equal(next.accept,false);assert.equal(next.next.id,2);
  await surface.onmessage({data:next.next});assert.deepEqual(messages[1].contours,sectionContours(model,4,48));assert.equal(queue.finish(2).accept,true);
  // The settled evaluation of exactly this model uses its requested grid.
  const settled={id:3,model,resolution:100,z:4};queue.enqueue(settled);
  await surface.onmessage({data:settled});assert.deepEqual(messages[2].contours,sectionContours(model,4,100));assert.equal(queue.finish(3).accept,true);
 }finally{if(previous===undefined)delete globalThis.self;else globalThis.self=previous}
});
