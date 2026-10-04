import test from 'node:test';
import assert from 'node:assert/strict';
import {makeShape,evaluateShape,compileShape,shapeBounds,sweepSamples,sweepFrames,mirrorShape} from '../lib/shapes.ts';
import {orientShapeToward,shapeAxisDirection} from '../lib/orientation.ts';

const near=(a,b,message,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<=tolerance,`${message}: ${a} != ${b}`);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>v.map(x=>x/Math.hypot(...v));
const point=(x,y,z=0,radius=8)=>({x,y,z,radius});
const sweep=(path,patch={})=>({...makeShape('sweep'),path,blend:0,sectionMode:'transported',depthRatio:.4,...patch});
const spatial=()=>sweep([point(-40,-20,-8,6),point(-18,18,11,10),point(15,24,31,7),point(44,-10,38,5)],{sectionRoll:37});
const world=(s,p)=>{const axes=['x','y','z'].map(a=>{const v=shapeAxisDirection(s,a);return [v.x,v.y,v.z];});return [s.x,s.y,s.z].map((v,i)=>v+axes[0][i]*p[0]+axes[1][i]*p[1]+axes[2][i]*p[2]);};

test('legacy fixed fields remain identical and round transported sweeps use the old spherical field',()=>{
 const path=spatial().path;
 for(const depthRatio of [.25,.55,1]){
  const fixed=sweep(path,{sectionMode:undefined,sectionRoll:undefined,depthRatio}),explicit={...fixed,sectionMode:'fixed',sectionRoll:127};
  for(let i=0;i<150;i++){const p=[(i%11-5)*10,(i%13-6)*8,(i%9-4)*12];assert.equal(evaluateShape(fixed,...p),evaluateShape(explicit,...p),'fixed ignores stored roll');if(depthRatio===1)assert.equal(evaluateShape(fixed,...p),evaluateShape({...fixed,sectionMode:'transported',sectionRoll:77},...p),'circular sections are exactly unchanged');}
 }
});

test('straight endpoint caps and rolled transverse ellipses have authored dimensions',()=>{
 for(const roll of [0,90,37]){
  const s=sweep([point(-25,0,0,10),point(25,0,0,10)],{sectionRoll:roll}),frames=sweepFrames(s),sample=sweepSamples(s)[0],f=frames[0],origin=[sample.x,sample.y,sample.z];
  for(const [axis,radius] of [[f.minor,4],[f.major,10]]){const edge=origin.map((v,i)=>v+axis[i]*radius);near(evaluateShape(s,...edge),0,'transverse endpoint profile');assert.ok(evaluateShape(s,...origin.map((v,i)=>v+axis[i]*radius*.8))<0);assert.ok(evaluateShape(s,...origin.map((v,i)=>v+axis[i]*radius*1.2))>0);}
  near(evaluateShape(s,-35,0,0),0,'closed start cap retains tangent radius');near(evaluateShape(s,35,0,0),0,'closed end cap retains tangent radius');
 }
 const rolled=sweep([point(-25,0,0,10),point(25,0,0,10)],{sectionRoll:90});assert.ok(evaluateShape(rolled,0,8,0)>0,'roll turns the thin direction toward Y');assert.ok(evaluateShape(rolled,0,0,8)<0,'roll turns the wide direction toward Z');
});

test('parallel transport frames remain orthonormal along a spatial curve and joints stay solid',()=>{
 const s=spatial(),samples=sweepSamples(s),frames=sweepFrames(s);assert.equal(frames.length,samples.length);
 for(let i=0;i<frames.length;i++){
  const f=frames[i];for(const axis of [f.tangent,f.minor,f.major])near(Math.hypot(...axis),1,'unit frame');near(dot(f.tangent,f.minor),0,'minor perpendicular');near(dot(f.tangent,f.major),0,'major perpendicular');near(dot(f.major,f.minor),0,'section axes perpendicular');
  const handed=cross(f.tangent,f.minor);for(let j=0;j<3;j++)near(handed[j],f.major[j],'consistent handedness');if(i)assert.ok(dot(f.minor,frames[i-1].minor)>.85,'no frame flip between neighbouring samples');
  const p=samples[i];assert.ok(evaluateShape(s,p.x,p.y,p.z)<-1,'joint centre remains material');
  if(i){const before=samples[i-1];for(let j=0;j<=8;j++){const t=j/8;assert.ok(evaluateShape(s,before.x*(1-t)+p.x*t,before.y*(1-t)+p.y*t,before.z*(1-t)+p.z*t)<0,'continuous material between centreline samples');}}
 }
 for(const path of [[point(0,0,0),point(0,0,0)],[point(0,0,-30),point(0,0,0),point(0,0,30)],[point(-20,0),point(0,0),point(-20,0)]]){const degenerate=sweep(path);assert.ok(sweepFrames(degenerate).every(f=>[...f.tangent,...f.minor,...f.major].every(Number.isFinite)));assert.ok(Number.isFinite(evaluateShape(degenerate,3,4,5)));}
});

test('transported affine fields are world distance bounds and compiled limits never over-prune',()=>{
 const s=spatial(),compiled=compileShape(s);
 for(let i=0;i<200;i++){
  const p=[(i%17-8)*7,(i%11-5)*9,(i%13-6)*8],q=p.map((v,j)=>v+Math.sin(i*1.7+j)*.47),a=evaluateShape(s,...p),b=evaluateShape(s,...q);
  assert.ok(Math.abs(a-b)<=Math.hypot(...p.map((v,j)=>v-q[j]))+1e-8,'normalized field is 1-Lipschitz');near(compiled(...p),a,'compiled geometry');for(const limit of [-12,-1,0,3,20])near(Math.min(compiled(...p,limit),limit),Math.min(a,limit),'CSG branch limit');
 }
 const old=compiled(12,18,30),before=sweepFrames(s);s.sectionRoll+=25;assert.notEqual(sweepFrames(s),before,'roll invalidates frame cache');near(compiled(12,18,30),old,'compiled snapshot retains old roll');s.sectionMode='fixed';assert.equal(sweepFrames(s).length,0,'mode invalidates cache');
});

test('spatial sweeps rotate rigidly, bound their full caps, and mirror transported roll',()=>{
 const local=spatial(),s={...local,x:17,y:-12,z:23,rx:31,ry:-41,rz:67},bounds=shapeBounds(s);
 for(let i=0;i<100;i++){const p=[(i%11-5)*11,(i%13-6)*9,(i%9-4)*13];near(evaluateShape(s,...world(s,p)),evaluateShape(local,...p),'rigid rotation of section frames');}
 const samples=sweepSamples(s),frames=sweepFrames(s);
 for(let i=0;i<samples.length;i++)for(const axis of [frames[i].tangent,frames[i].major,frames[i].minor])for(const sign of [-1,1]){const sample=samples[i],p=world(s,[sample.x+sign*axis[0]*sample.radius,sample.y+sign*axis[1]*sample.radius,sample.z+sign*axis[2]*sample.radius]);for(let j=0;j<3;j++)assert.ok(p[j]>=bounds[j]-1e-8&&p[j]<=bounds[j+3]+1e-8,'bounds contain sphere envelope of each cap');}
 for(const axis of ['x','y','z']){const reflected=mirrorShape(s,axis);assert.equal(reflected.sectionRoll,-s.sectionRoll);for(let i=0;i<180;i++){const p=[(i%17-8)*9,(i%13-6)*8,(i%11-5)*11],q=[...p];q[['x','y','z'].indexOf(axis)]*=-1;near(evaluateShape(s,...p),evaluateShape(reflected,...q),'world reflection of frame and roll',1e-7);}}
});

test('direction orientation aims every local axis without changing shape data or losing roll',()=>{
 const shape={...makeShape('cylinder'),rx:31,ry:-41,rz:67};
 for(const axis of ['x','y','z']){
  const current=shapeAxisDirection(shape,axis);assert.deepEqual(orientShapeToward(shape,current,axis),{rx:shape.rx,ry:shape.ry,rz:shape.rz},'unchanged direction returns exact Euler values');
  for(const direction of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],[.37,-.41,.81]])for(const up of [undefined,direction]){
   const patch=orientShapeToward(shape,direction,axis,up),result=shapeAxisDirection({...shape,...patch},axis),wanted=unit(direction);for(let j=0;j<3;j++)near([result.x,result.y,result.z][j],wanted[j],'aimed axis',1e-7);
   const axes=['x','y','z'].map(a=>{const v=shapeAxisDirection({...shape,...patch},a);return [v.x,v.y,v.z];});near(dot(axes[0],axes[1]),0,'orthogonal result');near(dot(cross(axes[0],axes[1]),axes[2]),1,'right-handed result');assert.deepEqual(Object.keys(patch).sort(),['rx','ry','rz'],'Euler patch only');
  }
 }
 for(const invalid of [[0,0,0],[Infinity,0,1],[NaN,0,1]])assert.throws(()=>orientShapeToward(shape,invalid,'y'),RangeError);
});
