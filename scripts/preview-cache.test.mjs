import test from 'node:test';
import assert from 'node:assert/strict';
import {getCachedPreview,putCachedPreview,previewCacheKey} from '../lib/preview-cache.ts';
import {generateMesh,DEFAULT_MODEL,cloneModel} from '../lib/form-engine.ts';

test('fine preview cache is exact-revision/quality scoped and works with storage unavailable',async()=>{
 const model={...cloneModel(DEFAULT_MODEL),influences:[],asymmetry:0},mesh=generateMesh(model,24);
 const key=previewCacheKey(JSON.stringify(model),128),value={mesh};
 assert.equal(await getCachedPreview(key),undefined);
 await putCachedPreview(key,value);assert.equal(await getCachedPreview(key),value);
 assert.equal(await getCachedPreview(previewCacheKey(JSON.stringify(model),160)),undefined);
 assert.equal(await getCachedPreview(previewCacheKey(JSON.stringify(model),128,.01)),undefined);
 assert.equal(await getCachedPreview(previewCacheKey(JSON.stringify({...model,width:model.width+1}),128)),undefined);
 const newer=previewCacheKey('newer geometry',128);await putCachedPreview(newer,value);
 assert.equal(await getCachedPreview(key),undefined,'only the latest final surface is retained');
});

test('invalid or excessive cached geometry cannot replace the last usable fine surface',async()=>{
 const mesh=generateMesh({...cloneModel(DEFAULT_MODEL),influences:[],asymmetry:0},24),key=previewCacheKey('valid surface',128);
 const valid={mesh};await putCachedPreview(key,valid);
 for(const broken of [
  {mesh:{...mesh,normals:new Float32Array(1)}},
  {mesh:{...mesh,indices:new Uint32Array([0,1,mesh.positions.length])}},
  {mesh:{...mesh,bounds:[NaN,...mesh.bounds.slice(1)]}},
  {mesh:{...mesh,positions:new Float32Array([NaN,0,0]),normals:new Float32Array(3),indices:new Uint32Array([0,0,0])}},
  {mesh,ao:new Float32Array(1)},
  {mesh:{...mesh,positions:new Float32Array(4000000),normals:new Float32Array(4000000)}}
 ]){await putCachedPreview(previewCacheKey('corrupt',128),broken);assert.equal(await getCachedPreview(key),valid);}
});
