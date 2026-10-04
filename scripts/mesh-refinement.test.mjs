import test from 'node:test';
import assert from 'node:assert/strict';
import {refineMeshSurface} from '../lib/mesh-refinement.ts';
import {DEFAULT_MODEL,cloneModel,generateMesh,evaluateBase,binarySTL} from '../lib/form-engine.ts';
import {makeShape,compileShape} from '../lib/shapes.ts';
import {createTrussStudy} from '../lib/truss-study.ts';
import {resolveAttachments} from '../lib/attachments.ts';
import {shapeAxisDirection} from '../lib/orientation.ts';

const topology=(mesh)=>{
 const edges=new Map(),vertices=new Set();
 for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){
  const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;
  vertices.add(a);const edge=edges.get(key)??{count:0,direction:0};edge.count++;edge.direction+=a<b?1:-1;edges.set(key,edge);
 }
 return {boundary:[...edges.values()].filter(edge=>edge.count===1).length,nonmanifold:[...edges.values()].filter(edge=>edge.count>2).length,winding:[...edges.values()].filter(edge=>edge.count===2&&edge.direction!==0).length,euler:vertices.size-edges.size+mesh.indices.length/3};
};
const octahedron=()=>{
 const positions=new Float32Array([10,0,0,-10,0,0,0,10,0,0,-10,0,0,0,10,0,0,-10]);
 return {positions,normals:Float32Array.from(positions,value=>value/10),indices:new Uint32Array([0,2,4,2,1,4,1,3,4,3,0,4,2,0,5,1,2,5,3,1,5,0,3,5]),bounds:[-10,-10,-10,10,10,10],volume:4000/3};
};
const sphere=(x,y,z)=>Math.hypot(x,y,z)-10;
const finite=(mesh)=>assert.ok(mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite)&&Number.isFinite(mesh.volume));
const rayHits=(mesh,origin,direction,maxDistance=Infinity)=>{
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];let hits=0;
 for(let i=0;i<mesh.indices.length;i+=3){
  const vertices=[...mesh.indices.slice(i,i+3)].map(index=>[...mesh.positions.slice(index*3,index*3+3)]),[a,b,c]=vertices,e1=b.map((value,axis)=>value-a[axis]),e2=c.map((value,axis)=>value-a[axis]),h=cross(direction,e2),det=dot(e1,h);
  if(Math.abs(det)<1e-10)continue;
  const s=origin.map((value,axis)=>value-a[axis]),u=dot(s,h)/det;if(u<0||u>1)continue;
  const q=cross(s,e1),v=dot(direction,q)/det;if(v<0||u+v>1)continue;
  const distance=dot(e2,q)/det;if(distance>1e-8&&distance<maxDistance)hits++;
 }
 return hits;
};

test('conforming projection improves actual spherical surface residual and retains topology',()=>{
 const original=octahedron(),before=JSON.parse(JSON.stringify({positions:[...original.positions],indices:[...original.indices]})),refined=refineMeshSurface(original,sphere,{tolerance:.04,maxPasses:3,maxTriangles:1000});
 assert.equal(refined.refinement.passes,3);assert.equal(refined.refinement.outputTriangles,512);
 assert.ok(refined.refinement.maxMidpointResidualAfter<refined.refinement.maxMidpointResidualBefore*.05);
 assert.ok(refined.refinement.maxFaceResidualAfter<refined.refinement.maxFaceResidualBefore*.05);
 assert.deepEqual(topology(refined),topology(original),'Euler characteristic, closedness and winding survive every shared split');
 assert.equal(refined.refinement.degenerateOutputTriangles,0);
 for(let i=0;i<refined.positions.length;i+=3)assert.ok(Math.abs(sphere(refined.positions[i],refined.positions[i+1],refined.positions[i+2]))<.001);
 assert.deepEqual([...refined.positions.slice(0,original.positions.length)],[...original.positions],'original surface roots stay fixed');
 assert.deepEqual([...original.positions],before.positions);assert.deepEqual([...original.indices],before.indices,'the caller mesh is immutable');
 assert.ok(refined.volume>original.volume&&refined.volume<4*Math.PI*1000/3);
 assert.deepEqual(refined.bounds,original.bounds);finite(refined);
 assert.equal(binarySTL(refined).byteLength,84+512*50);
});

test('partial budgeted edge splits do not create T junctions or inconsistent winding',()=>{
 const original=octahedron(),refined=refineMeshSurface(original,sphere,{tolerance:.001,maxPasses:4,maxTriangles:73});
 assert.ok(refined.indices.length/3<=73);assert.equal(refined.refinement.budgetLimited,true);
 assert.ok(refined.indices.length>original.indices.length);assert.deepEqual(topology(refined),topology(original));
 assert.equal(refined.refinement.degenerateOutputTriangles,0);finite(refined);
});

test('a tilted flange and through-bore retain their openings with lower triangle residual',()=>{
 const sleeve={...makeShape('cylinder'),id:'sleeve',x:0,y:0,z:0,width:32,height:22,depth:32,blend:0,rx:31,rz:-28};
 const flange={...sleeve,id:'flange',width:42,height:6,depth:42,y:9*Math.cos(31*Math.PI/180),z:9*Math.sin(31*Math.PI/180),blend:0};
 const bore={...sleeve,id:'bore',width:19,height:70,depth:19,operation:'subtract'};
 const model={...cloneModel(DEFAULT_MODEL),baseEnabled:false,shapes:[sleeve,flange,bore],influences:[],asymmetry:0},compiled=model.shapes.map(compileShape),field=(x,y,z)=>evaluateBase(model,x,y,z,compiled),original=generateMesh(model,36);
 const refined=refineMeshSurface(original,field,{tolerance:.04,maxPasses:2,maxTriangles:160000,maxProjectionDistance:1.5});
 assert.deepEqual(topology(refined),topology(original));assert.equal(topology(refined).boundary,0);assert.equal(topology(refined).nonmanifold,0);
 assert.ok(refined.refinement.maxMidpointResidualAfter<refined.refinement.maxMidpointResidualBefore,JSON.stringify(refined.refinement));
 assert.ok(refined.refinement.maxFaceResidualAfter<refined.refinement.maxFaceResidualBefore,JSON.stringify(refined.refinement));
 assert.ok(refined.refinement.meanMidpointResidualAfter<refined.refinement.meanMidpointResidualBefore*.35,JSON.stringify(refined.refinement));
 assert.ok(refined.refinement.meanFaceResidualAfter<refined.refinement.meanFaceResidualBefore*.35,JSON.stringify(refined.refinement));
 assert.equal(refined.refinement.degenerateOutputTriangles,refined.refinement.degenerateInputTriangles);
 assert.ok(refined.refinement.maxDisplacement<=1.500001);
 assert.ok(field(0,0,0)>0,'the implicit bore remains empty');
 const rx=sleeve.rx*Math.PI/180,rz=sleeve.rz*Math.PI/180,axis=[-Math.sin(rz),Math.cos(rx)*Math.cos(rz),Math.sin(rx)*Math.cos(rz)];
 assert.equal(rayHits(refined,axis.map(value=>value*-40),axis),0,'the refined triangle surface does not cap the actual through-bore');
 // Accepted projections target the actual field. Rejected projections remain
 // on their old mesh edges and are explicitly counted, rather than being
 // presented as exact feature roots.
 let maximum=0;for(let i=0;i<refined.positions.length;i+=3)maximum=Math.max(maximum,Math.abs(field(refined.positions[i],refined.positions[i+1],refined.positions[i+2])));
 assert.ok(maximum<refined.refinement.maxMidpointResidualBefore,`retained vertex field residual ${maximum}`);finite(refined);
});

test('limited projections preserve connectivity instead of jumping to distant features',()=>{
 const original=octahedron(),refined=refineMeshSurface(original,sphere,{tolerance:.01,maxPasses:1,maxProjectionDistance:.01,maxTriangles:40});
 assert.equal(refined.refinement.projectedVertices,0,'an unreachable root is not silently approximated');
 assert.ok(refined.refinement.rejectedProjections>0);assert.deepEqual(topology(refined),topology(original));assert.equal(refined.refinement.maxDisplacement,0);
 const oldCount=original.positions.length/3;for(let i=oldCount;i<refined.positions.length/3;i++)assert.ok(sphere(...refined.positions.slice(i*3,i*3+3))<0,'failed projections stay linear midpoints');
 finite(refined);
});

test('zero-area input faces and nonfinite fields remain finite without deleting topology',()=>{
 const mesh={positions:new Float32Array([0,0,0,1,0,0,2,0,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2]),volume:0,bounds:[0,0,0,2,0,0]};
 const refined=refineMeshSurface(mesh,()=>NaN,{tolerance:.1,maxPasses:2});
 assert.equal(refined.refinement.degenerateInputTriangles,1);assert.equal(refined.refinement.degenerateOutputTriangles,1);assert.deepEqual([...refined.indices],[...mesh.indices]);assert.ok(refined.refinement.nonfiniteFieldValues>0);finite(refined);
 const empty=refineMeshSurface({positions:new Float32Array(),normals:new Float32Array(),indices:new Uint32Array(),volume:0,bounds:[0,0,0,0,0,0]},sphere,{tolerance:.1});
 assert.equal(empty.indices.length,0);assert.deepEqual(empty.bounds,[0,0,0,0,0,0]);
});

test('invalid quality settings and corrupted mesh arrays are rejected explicitly',()=>{
 for(const tolerance of [0,-1,NaN,Infinity])assert.throws(()=>refineMeshSurface(octahedron(),sphere,{tolerance}));
 for(const maxEdgeDisplacement of [0,-1,.76,NaN])assert.throws(()=>refineMeshSurface(octahedron(),sphere,{tolerance:.1,maxEdgeDisplacement}));
 assert.throws(()=>refineMeshSurface({...octahedron(),indices:new Uint32Array([0,1,20])},sphere,{tolerance:.1}));
 assert.throws(()=>refineMeshSurface({...octahedron(),normals:new Float32Array(2)},sphere,{tolerance:.1}));
 assert.throws(()=>refineMeshSurface(octahedron(),sphere,{tolerance:.1,maxPasses:7}));
});

test('the actual spatial truss retains safe patches while improving whole-mesh sampled residual',()=>{
 const model=resolveAttachments(createTrussStudy()),compiled=model.shapes.map(compileShape),field=(x,y,z)=>evaluateBase(model,x,y,z,compiled),original=generateMesh(model,96);
 const refined=refineMeshSurface(original,field,{tolerance:.04,maxPasses:1,maxTriangles:250000,maxProjectionDistance:1.5}),stats=refined.refinement;
 assert.equal(stats.passes,1,'a few difficult sharp-feature patches must not discard all safe improvements');
 assert.equal(stats.qualityLimited,true,'the unresolved patches are reported rather than concealed');
 assert.ok(stats.meanMidpointResidualAfter<stats.meanMidpointResidualBefore*.8,JSON.stringify(stats));
 assert.ok(stats.meanFaceResidualAfter<stats.meanFaceResidualBefore*.8,JSON.stringify(stats));
 assert.ok(stats.maxMidpointResidualAfter<=stats.maxMidpointResidualBefore+.00004,JSON.stringify(stats));
 assert.ok(stats.maxFaceResidualAfter<=stats.maxFaceResidualBefore+.00004,JSON.stringify(stats));
 assert.equal(stats.degenerateOutputTriangles,stats.degenerateInputTriangles);
 assert.deepEqual(topology(refined),topology(original),'partial patch freezing preserves closedness, winding and Euler characteristic');
 assert.equal(topology(refined).boundary,0);assert.equal(topology(refined).nonmanifold,0);
 assert.deepEqual([...refined.positions.slice(0,original.positions.length)],[...original.positions],'all old surface roots stay fixed');
 for(const id of ['a-bore','b-bore','c-bore']){
  const bore=model.shapes.find(s=>s.id===id),axis=shapeAxisDirection(bore,id==='c-bore'?'y':'z'),direction=[axis.x,axis.y,axis.z],length=(id==='c-bore'?bore.height:bore.depth)-1,origin=[bore.x,bore.y,bore.z].map((value,i)=>value-direction[i]*length/2);
  assert.equal(rayHits(refined,origin,direction,length),0,'no refined triangle obstructs the authored '+id+' interior');
 }
 finite(refined);
});
