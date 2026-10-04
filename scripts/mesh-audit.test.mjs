import test from 'node:test';
import assert from 'node:assert/strict';
import {auditMesh} from '../lib/mesh-audit.ts';

const tetra=()=>({positions:new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1]),normals:new Float32Array(12),indices:new Uint32Array([0,2,1,0,1,3,0,3,2,1,2,3]),bounds:[0,0,0,1,1,1],volume:1/6});
test('audit distinguishes closed, disconnected, open and misoriented geometry',()=>{
 const source=tetra(),report=auditMesh(source);
 assert.deepEqual(report.dimensions,[1,1,1]);assert.equal(report.components,1);assert.equal(report.boundaryEdges,0);assert.equal(report.nonManifoldEdges,0);assert.equal(report.inconsistentWindingEdges,0);assert.equal(report.degenerateTriangles,0);assert.ok(Math.abs(report.volume-1/6)<1e-12);
 const disconnected={...source,positions:new Float32Array([...source.positions,...Array.from(source.positions,(v,i)=>i%3===0?v+3:v)]),normals:new Float32Array(24),indices:new Uint32Array([...source.indices,...Array.from(source.indices,v=>v+4)])};
 assert.equal(auditMesh(disconnected).components,2);
 assert.equal(auditMesh({...source,indices:source.indices.slice(0,9)}).boundaryEdges,3);
 const reversed=source.indices.slice();[reversed[0],reversed[1]]=[reversed[1],reversed[0]];
 assert.equal(auditMesh({...source,indices:reversed}).inconsistentWindingEdges,3);
 const duplicated={...source,indices:new Uint32Array([...source.indices,0,2,1])};assert.equal(auditMesh(duplicated).nonManifoldEdges,3);
});
test('audit handles empty, invalid and collapsed meshes without claiming closure',()=>{
 const empty=auditMesh({positions:new Float32Array(),normals:new Float32Array(),indices:new Uint32Array(),bounds:[0,0,0,0,0,0],volume:0});
 assert.equal(empty.triangles,0);assert.equal(empty.components,0);assert.deepEqual(empty.dimensions,[0,0,0]);
 const source=tetra(),invalid=source.positions.slice();invalid[0]=NaN;assert.equal(auditMesh({...source,positions:invalid}).finite,false);
 assert.equal(auditMesh({...source,indices:new Uint32Array([0,1,5])}).invalidIndices,1);
 assert.equal(auditMesh({...source,indices:new Uint32Array([0,0,1])}).degenerateTriangles,1);
});
