import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {makeShape,isValidSweepPath,sweepSamples,sweepFrames,evaluateShape,compileShape,shapeBounds,mirrorShape} from '../lib/shapes.ts';
import {applyConstructionCommand as apply,blankConstruction} from '../lib/construction.ts';
import {cloneModel,validateModel,generateMesh,binarySTL} from '../lib/form-engine.ts';
import {canAttachTo,reconcileAttachments,resolveAttachments,attachmentLocalToWorld,attachmentWorldToLocal} from '../lib/attachments.ts';
import {auditMesh} from '../lib/mesh-audit.ts';

const point=(x,y,z=0,radius=5)=>({x,y,z,radius});
const xyz=p=>[p.x,p.y,p.z];
const dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>v.map(x=>x/Math.hypot(...v));
const near=(a,b,message,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} != ${b}`);
const vectorNear=(a,b,message,tolerance=1e-8)=>a.forEach((v,i)=>near(v,b[i],message,tolerance));
const shape=(path,patch={})=>({...makeShape('sweep'),id:'loop',path,blend:0,closed:true,...patch});
const solid=s=>({...blankConstruction(),lenses:false,shell:false,usb:false,buttons:false,fingerGrooves:false,shapes:[s]});
const get=(model,id)=>model.shapes.find(s=>s.id===id);
const spatial=()=>shape(Array.from({length:8},(_,i)=>{const t=i*Math.PI/4;return point(42*Math.cos(t),30*Math.sin(t),13*Math.sin(2*t)+7*Math.cos(3*t+.3),4.4+1.1*Math.cos(t+.4));}),{sectionMode:'transported',sectionRoll:29,depthRatio:.45});

// Independent cubic coefficient evaluation, including its analytical derivative.
function cyclicCurve(path,i,t){
 const n=path.length,a=path[i%n],b=path[(i+1)%n],before=path[(i+n-1)%n],after=path[(i+2)%n],position=[],derivative=[];
 for(const axis of ['x','y','z']){const v0=(b[axis]-before[axis])/2,v1=(after[axis]-a[axis])/2,c2=3*(b[axis]-a[axis])-2*v0-v1,c3=2*(a[axis]-b[axis])+v0+v1;position.push(a[axis]+t*(v0+t*(c2+t*c3)));derivative.push(v0+t*(2*c2+3*t*c3));}
 return {position,derivative,radius:a.radius+(b.radius-a.radius)*(3*t*t-2*t*t*t)};
}

// Rodrigues transport in an independent axis-angle implementation. This
// reference measures the seam holonomy before applying any periodic correction.
function transport(v,from,to){
 const axis=cross(from,to),sine=Math.hypot(...axis),cosine=Math.max(-1,Math.min(1,dot(from,to)));let result=v;
 if(sine>1e-8){const k=unit(axis),perpendicular=cross(k,v),angle=Math.atan2(sine,cosine);result=v.map((x,i)=>x*Math.cos(angle)+perpendicular[i]*Math.sin(angle)+k[i]*dot(k,v)*(1-Math.cos(angle)));}
 return unit(result.map((x,i)=>x-dot(result,to)*to[i]));
}
const rotate=(v,tangent,angle)=>v.map((x,i)=>x*Math.cos(angle)+cross(tangent,v)[i]*Math.sin(angle));

test('open transported evaluator remains byte-identical to its pre-closure fixture',()=>{
 const s=shape([point(-44,-19,-8,5.4),point(-17,21,12,10.2),point(19,26,34,7.6),point(43,-12,38,4.7)],{id:'fixture',closed:undefined,depthRatio:.43,sectionMode:'transported',sectionRoll:37,x:17,y:-13,z:23,rx:31,ry:-41,rz:67});
 const payload=JSON.stringify({samples:sweepSamples(s),frames:sweepFrames(s),bounds:shapeBounds(s),fields:Array.from({length:200},(_,i)=>evaluateShape(s,(i%17-8)*7,(i%11-5)*9,(i%13-6)*8))});
 // Recorded directly from HEAD's legacy evaluator before this feature existed.
 assert.equal(createHash('sha256').update(payload).digest('hex'),'1f25a29dcad78f55b54eac878bef957d944b5862570d43954561677e0c9cd835');
 assert.deepEqual(sweepSamples({...s,closed:false}),sweepSamples(s));assert.deepEqual(sweepFrames({...s,closed:false}),sweepFrames(s));
 for(let i=0;i<40;i++)assert.equal(evaluateShape({...s,closed:false},i-20,13,-9),evaluateShape(s,i-20,13,-9));
 const two=shape([point(-20,0),point(20,0)],{closed:false});assert.ok(isValidSweepPath(two.path,false));assert.equal(sweepSamples(two).length,9);
});

test('closed imports require unique coordinates and boolean mode; commands fail atomically',()=>{
 const s=spatial(),model=solid(s),saved=cloneModel(model);assert.ok(isValidSweepPath(s.path,true));assert.deepEqual(validateModel(JSON.parse(JSON.stringify(model))),model);
 for(const path of [s.path.slice(0,2),[...s.path,s.path[0]],[...s.path,{...s.path[0],radius:9}],[s.path[0],s.path[1],s.path[0],s.path[3]]]){assert.equal(isValidSweepPath(path,true),false);assert.throws(()=>validateModel(solid({...s,path})));}
 for(const closed of [null,0,1,'true',{},[]]){assert.throws(()=>validateModel(solid({...s,closed})));assert.throws(()=>apply(model,{action:'update',id:s.id,patch:{closed}}));assert.deepEqual(model,saved);}
 assert.throws(()=>validateModel(solid({...makeShape('box'),closed:true})));assert.throws(()=>apply(model,{action:'update',id:s.id,patch:{path:[s.path[0],s.path[1]],closed:true}}));assert.deepEqual(model,saved);
 assert.equal(isValidSweepPath(s.path,'true'),false);const added=apply(blankConstruction(),{action:'add',shape:s});assert.equal(get(added,s.id).closed,true);
});

test('cyclic Hermite centreline and monotone radii interpolate every unique control and close smoothly',()=>{
 const s=spatial(),samples=sweepSamples(s),n=s.path.length;assert.equal(samples.length,n*8+1);assert.deepEqual(samples[0],samples.at(-1));
 for(let i=0;i<n;i++){
  assert.deepEqual(samples[i*8],s.path[i]);const endpoint=cyclicCurve(s.path,i,1),next=cyclicCurve(s.path,(i+1)%n,0);vectorNear(endpoint.position,next.position,'cyclic position');vectorNear(endpoint.derivative,next.derivative,'cyclic tangent');near(endpoint.radius,next.radius,'radius wraps');
  for(let j=0;j<=8;j++){const t=j/8,reference=cyclicCurve(s.path,i,t),sample=samples[i*8+j];vectorNear(xyz(sample),reference.position,'independent cubic sample');near(sample.radius,reference.radius,'independent monotone radius');assert.ok(sample.radius>=Math.min(s.path[i].radius,s.path[(i+1)%n].radius)-1e-12&&sample.radius<=Math.max(s.path[i].radius,s.path[(i+1)%n].radius)+1e-12);}
  for(const t of [1e-6,1-1e-6]){const a=s.path[i].radius,b=s.path[(i+1)%n].radius,derivative=(b-a)*6*t*(1-t);assert.ok(Math.abs(derivative)<.0001,'radius derivative tends to zero at every control, including seam');}
 }
 const snapshot=compileShape(s),old=sweepSamples(s),oldValue=snapshot(42,0,0);s.path[0].y+=7;s.path[0].radius+=1;assert.notEqual(sweepSamples(s),old);assert.deepEqual(sweepSamples(s)[0],sweepSamples(s).at(-1),'moving one author seam control cannot open a loop');near(snapshot(42,0,0),oldValue,'compiled snapshot stays immutable');
 s.closed=false;assert.equal(sweepSamples(s).length,(n-1)*8+1,'mode invalidates cache');
});

test('transported non-planar loop distributes nonzero holonomy by arc length and closes both ellipse axes',()=>{
 const s=spatial(),samples=sweepSamples(s),frames=sweepFrames(s),n=samples.length-1,tangents=[],raw=[],arc=[0];
 for(let i=0;i<=n;i++){
  const before=samples[(i+n-1)%n],after=samples[(i+1)%n],t=unit(xyz(after).map((v,j)=>v-xyz(before)[j]));tangents.push(t);
  raw.push(i?transport(raw[i-1],tangents[i-1],t):unit([0,0,1].map((v,j)=>v-t[2]*t[j])));
  if(i)arc.push(arc[i-1]+Math.hypot(...xyz(samples[i]).map((v,j)=>v-xyz(samples[i-1])[j])));
 }
 const twist=Math.atan2(dot(tangents[0],cross(raw[n],raw[0])),dot(raw[n],raw[0]));assert.ok(Math.abs(twist)>.05,'test loop has meaningful transport holonomy');
 assert.deepEqual(frames[0],frames.at(-1),'tangent, minor and major seam frames coincide exactly');
 for(let i=0;i<=n;i++){
  const f=frames[i],reference=rotate(raw[i],tangents[i],s.sectionRoll*Math.PI/180+twist*arc[i]/arc[n]);vectorNear(f.minor,reference,'independent arc-length twist correction');vectorNear(f.tangent,tangents[i],'periodic central-difference tangent');
  for(const axis of [f.tangent,f.minor,f.major])near(Math.hypot(...axis),1,'unit axis');near(dot(f.tangent,f.minor),0,'minor orthogonal');near(dot(f.tangent,f.major),0,'major orthogonal');near(dot(f.minor,f.major),0,'section axes orthogonal');vectorNear(cross(f.tangent,f.minor),f.major,'right-handed frame');
  if(i)assert.ok(dot(f.minor,frames[i-1].minor)>.9,'no frame flip at joints or seam');const sample=samples[i];assert.ok(evaluateShape(s,...xyz(sample))<0,'periodic material at every centreline sample');
 }
 for(const path of [[point(-20,0),point(0,0),point(20,0)],[point(0,0,-20),point(0,0,20),point(0,20,0)]])assert.ok(sweepFrames(shape(path,{sectionMode:'transported',depthRatio:.4})).every(f=>[...f.tangent,...f.minor,...f.major].every(Number.isFinite)),'reversal and reference-axis cases stay finite');
});

test('closed loop frames, fields and conservative bounds reflect and rotate through space',()=>{
 const local=spatial(),s={...local,x:17,y:-13,z:23,rx:31,ry:-41,rz:67},bounds=shapeBounds(s),compiled=compileShape(s);
 for(let i=0;i<s.path.length;i++)for(let j=0;j<=97;j++){
  const c=cyclicCurve(s.path,i,j/97),radius=Math.max(s.path[i].radius,s.path[(i+1)%s.path.length].radius);
  for(const axis of [0,1,2])for(const sign of [-1,1]){const p=[...c.position];p[axis]+=sign*radius;const w=attachmentLocalToWorld(s,{x:p[0],y:p[1],z:p[2]});for(const [k,key] of ['x','y','z'].entries())assert.ok(w[key]>=bounds[k]-1e-8&&w[key]<=bounds[k+3]+1e-8,'Bezier hull contains unsampled dense sphere envelope');}
 }
 for(const axis of ['x','y','z']){
  const reflected=mirrorShape(s,axis);assert.equal(reflected.closed,true);assert.equal(reflected.sectionRoll,-s.sectionRoll);assert.deepEqual(sweepFrames(reflected)[0],sweepFrames(reflected).at(-1));
  for(let i=0;i<200;i++){const p=[(i%17-8)*7,(i%11-5)*9,(i%13-6)*8],q=[...p];q[['x','y','z'].indexOf(axis)]*=-1;near(evaluateShape(s,...p),evaluateShape(reflected,...q),'world reflected periodic field',1e-7);near(compiled(...p),evaluateShape(s,...p),'compiled closed field');for(const limit of [-12,-1,0,3,20])near(Math.min(compiled(...p,limit),limit),Math.min(evaluateShape(s,...p),limit),'safe compiled BVH bound');}
 }
 for(let i=0;i<80;i++){const p=[(i%11-5)*9,(i%13-6)*8,(i%9-4)*7],world=attachmentLocalToWorld(s,{x:p[0],y:p[1],z:p[2]});near(evaluateShape(s,world.x,world.y,world.z),evaluateShape(local,...p),'rotated closed frame field');}
});

test('coincident seam samples use a geometric tangent fallback that preserves reflection',()=>{
 const s=shape([[0,0,0],[7,0,7],[142,0,142],[-142,0,-142],[-7,0,-7]].map(p=>point(...p,2)),{sectionMode:'transported',depthRatio:.35,sectionRoll:29}),samples=sweepSamples(s),frames=sweepFrames(s);
 assert.deepEqual(samples[1],samples.at(-2),'regression has coincident periodic sample neighbours');vectorNear(frames[0].tangent,unit([14,0,14]),'fallback follows authored cyclic derivative');assert.deepEqual(frames[0],frames.at(-1));
 for(const axis of ['x','y','z']){const mirror=mirrorShape(s,axis);for(const p of [[-10,-3,12],...Array.from({length:80},(_,i)=>[(i%11-5)*11,(i%7-3)*3,(i%13-6)*9])]){const q=[...p];q[['x','y','z'].indexOf(axis)]*=-1;near(evaluateShape(s,...p),evaluateShape(mirror,...q),'geometric seam fallback reflects',1e-7);}}
});

test('closing detaches both resolved endpoints atomically while closed loops remain valid anchor targets',()=>{
 const socket={...makeShape('box'),id:'socket',x:0,y:0,z:0,blend:0},rib=shape([point(-20,0),point(0,17),point(20,0)],{id:'rib',closed:false});
 let model={...solid(rib),shapes:[socket,rib]};for(const endpoint of ['start','end'])model=apply(model,{action:'attach',sweepId:'rib',endpoint,targetShapeId:'socket',anchor:'center'});
 model=apply(model,{action:'update',id:'socket',patch:{x:12,y:-4,rz:29}});const saved=cloneModel(model),resolvedPath=get(model,'rib').path;
 const closed=apply(model,{action:'update',id:'rib',patch:{closed:true}});assert.deepEqual(get(closed,'rib').path,resolvedPath,'closing preserves resolved controls');assert.deepEqual(closed.attachments,[]);assert.deepEqual(model,saved,'closing is atomic and immutable');
 const moved=apply(closed,{action:'update',id:'socket',patch:{x:63,rz:-41}});assert.deepEqual(get(moved,'rib').path,resolvedPath,'closed loop no longer follows detached endpoints');assert.equal(canAttachTo(closed,'rib','socket'),false);
 for(const offset of [undefined,{x:0,y:0,z:0}])assert.throws(()=>apply(closed,{action:'attach',sweepId:'rib',endpoint:'start',targetShapeId:'socket',anchor:'center',offset}),/Closed sweeps/);
 assert.throws(()=>validateModel({...closed,attachments:saved.attachments}),/Closed sweeps/);assert.throws(()=>apply(closed,{action:'detach',sweepId:'rib',endpoint:'end'}),/open sweep/);
 // Reconciliation accepts a stale raw edit, but freezes already-resolved points
 // before discarding inherited links rather than attaching a closed source.
 const stale=cloneModel(saved);get(stale,'socket').x+=9;const raw=cloneModel(stale);get(raw,'rib').closed=true;const expected=resolveAttachments(stale),result=reconcileAttachments(stale,raw);assert.deepEqual(get(result,'rib').path,get(expected,'rib').path);assert.deepEqual(result.attachments,[]);
 const branch=shape([point(-10,-22),point(0,-27),point(10,-22)],{id:'branch',closed:false});let anchored={...closed,shapes:[...closed.shapes,branch]};assert.equal(canAttachTo(anchored,'branch','rib'),true);
 anchored=apply(anchored,{action:'attach',sweepId:'branch',endpoint:'start',targetShapeId:'rib',anchor:'x+',offset:{x:2,y:-1,z:3}});const oldWorld=attachmentLocalToWorld(get(anchored,'branch'),get(anchored,'branch').path[0]);const translated=apply(anchored,{action:'update',id:'rib',patch:{x:15}}),newWorld=attachmentLocalToWorld(get(translated,'branch'),get(translated,'branch').path[0]);near(newWorld.x-oldWorld.x,15,'incoming anchor follows a closed target');near(newWorld.y,oldWorld.y,'incoming Y');near(newWorld.z,oldWorld.z,'incoming Z');
 const targetLocal=attachmentWorldToLocal(get(translated,'rib'),newWorld);assert.ok(Number.isFinite(targetLocal.x));
});

test('closed round and transported ellipse rings export watertight toroidal surfaces with a central hole',()=>{
 for(const patch of [{},{sectionMode:'transported',depthRatio:.4,sectionRoll:41}]){
 const s=shape(Array.from({length:8},(_,i)=>point(31*Math.cos(i*Math.PI/4),31*Math.sin(i*Math.PI/4),0,4)),patch),model=solid(s),mesh=generateMesh(model,64),audit=auditMesh(mesh);
 assert.equal(audit.components,1);for(const key of ['boundaryEdges','nonManifoldEdges','inconsistentWindingEdges','degenerateTriangles','invalidIndices'])assert.equal(audit[key],0,key);assert.equal(audit.finite,true);assert.ok(audit.volume>0);assert.equal(binarySTL(mesh).byteLength,84+audit.triangles*50);
 const edges=new Set(),used=new Set();let centralRayHits=0,maximumResidual=0;
 for(let i=0;i<mesh.indices.length;i+=3){const ids=[...mesh.indices.slice(i,i+3)],vertices=ids.map(id=>[...mesh.positions.slice(id*3,id*3+3)]);for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3];used.add(a);edges.add(a<b?a+':'+b:b+':'+a);}
  // Independent XY barycentric containment tests whether the exported surface
  // blocks the line through the hole. Degenerate XY projections are ignored.
  const [a,b,c]=vertices,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)>1e-12){const u=((b[1]-c[1])*(-c[0])+(c[0]-b[0])*(-c[1]))/den,v=((c[1]-a[1])*(-c[0])+(a[0]-c[0])*(-c[1]))/den;if(u>=0&&v>=0&&u+v<=1)centralRayHits++;}
 }
 assert.equal(used.size-edges.size+audit.triangles,0,'closed toroidal mesh has Euler characteristic zero');assert.equal(centralRayHits,0,'exported triangles do not fill the central opening');assert.ok(evaluateShape(s,0,0,0)>20,'analytic hole stays empty');
 for(let i=0;i<mesh.positions.length;i+=3)maximumResidual=Math.max(maximumResidual,Math.abs(evaluateShape(s,...mesh.positions.slice(i,i+3))));assert.ok(maximumResidual<2e-5,'export field roots retain closed surface precision: '+maximumResidual);
 }
});
