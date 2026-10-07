import test from 'node:test';
import assert from 'node:assert/strict';
import {cloneModel,DEFAULT_MODEL,generateMeshAsync,compileModelField,withoutRipples} from '../lib/form-engine.ts';
import {auditMesh} from '../lib/mesh-audit.ts';
import {quickShape} from '../lib/quick-modelling.ts';
import {sharpenCreases,splitSeamNormals,seamLock} from '../lib/crease-sharpening.ts';
import {generateExportMesh} from '../lib/export-progress.ts';

const holed=()=>{const m=withoutRipples(cloneModel(DEFAULT_MODEL));m.influences=[];m.shapes=[quickShape(m,'cylinder','subtract','body')];return m};

test('a hard cut rim is resolved onto the seam and stays closed',async()=>{
 const model=holed(),raw=await generateMeshAsync(model,40,undefined,undefined,{draft:true}),field=compileModelField(model);
 const sharp=sharpenCreases(raw,field);
 assert.ok(sharp.creases.creases+sharp.creases.snapped>40,'the rim has seam points: '+JSON.stringify(sharp.creases));
 const audit=auditMesh(sharp);
 assert.equal(audit.boundaryEdges,0,'splitting both faces of an edge keeps the surface watertight');
 assert.equal(audit.nonManifoldEdges,0);
 // Every seam point sits on the surface, not on a chord through it.
 for(const v of sharp.seams.vertices){const p=sharp.positions;assert.ok(Math.abs(field(p[v*3],p[v*3+1],p[v*3+2]))<.05)}
 assert.ok(Math.abs(sharp.volume-raw.volume)/raw.volume<.02,'the seam only trims chords');
 const lock=seamLock(sharp);assert.equal(lock.reduce((n,v)=>n+v,0),new Set(sharp.seams.vertices).size);
});

test('each side of a seam shades with its own normal, without opening the surface',async()=>{
 const model=holed(),raw=await generateMeshAsync(model,40,undefined,undefined,{draft:true}),sharp=sharpenCreases(raw,compileModelField(model)),shown=splitSeamNormals(sharp);
 assert.ok(shown.positions.length>sharp.positions.length,'seam vertices get a second copy');
 assert.equal(shown.indices.length,sharp.indices.length);
 assert.equal(shown.seams,undefined);
});

test('a smooth form is returned untouched and exports never change',async()=>{
 const smooth={...cloneModel(DEFAULT_MODEL),influences:[],asymmetry:0};
 const plain=await generateMeshAsync(smooth,28,undefined,undefined,{draft:true}),crisp=await generateMeshAsync(smooth,28,undefined,undefined,{draft:true,creases:true});
 assert.deepEqual(crisp,plain);
 const model=holed(),before=generateExportMesh(model,40);
 assert.equal(before.seams,undefined);assert.equal(before.creases,undefined);
});

test('the preview of a cut has seam points and fewer saw teeth than the raw grid',async()=>{
 const model=holed();
 const raw=await generateMeshAsync(model,48,undefined,undefined,{draft:true}),crisp=await generateMeshAsync(model,48,undefined,undefined,{draft:true,creases:true});
 // A sawtooth rim shows as triangles whose corners disagree about the normal.
 const straddling=m=>{let n=0;const N=m.normals,I=m.indices;for(let f=0;f<I.length;f+=3){let worst=1;for(let k=0;k<3;k++){const a=I[f+k]*3,b=I[f+(k+1)%3]*3;worst=Math.min(worst,N[a]*N[b]+N[a+1]*N[b+1]+N[a+2]*N[b+2])}if(worst<Math.cos(24*Math.PI/180))n++}return n};
 assert.ok(straddling(crisp)<straddling(raw)*.25,`straddling ${straddling(crisp)} vs ${straddling(raw)}`);
});
