import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSweepProjection,projectedSectionJoin,projectSweepSection} from '../components/form/sweep-projection.ts';
import {makeShape,sweepFrames,sweepSamples} from '../lib/shapes.ts';

const point={x:31,y:-17,z:23,radius:10};
const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);
const recoverCovariance=section=>{const angle=section.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),major=section.rx**2,minor=section.ry**2;return {xx:major*c*c+minor*s*s,xy:(major-minor)*c*s,yy:major*s*s+minor*c*c}};

test('fixed sections retain their original plane projections and physical centers',()=>{
 const xy=projectSweepSection(point,'xy',.4),xz=projectSweepSection(point,'xz',.4),yz=projectSweepSection(point,'yz',.4);
 assert.deepEqual([xy.x,xy.y],[31,17]);assert.deepEqual([xz.x,xz.y],[31,-23]);assert.deepEqual([yz.x,yz.y],[-17,-23]);
 for(const section of [xy,xz,yz]){near(section.extentX,10);near(section.angle,0)}
 near(xy.extentY,10);near(xy.rx,10);near(xy.ry,10);
 for(const section of [xz,yz]){near(section.extentY,4);near(section.rx,10);near(section.ry,4)}
});

test('transported caps project to rotated ellipses rather than fixed local-Z ellipses',()=>{
 const k=Math.SQRT1_2,frame={tangent:[-k,k,0],major:[0,0,1],minor:[k,k,0]};
 const xy=projectSweepSection(point,'xy',.25,frame);
 near(xy.rx,10);near(xy.ry,2.5);near(xy.angle,45);
 near(xy.extentX,Math.sqrt(53.125));near(xy.extentY,Math.sqrt(53.125));
 assert.deepEqual([xy.x,xy.y],[31,17]);
 const reconstructed=recoverCovariance(xy);near(reconstructed.xx,xy.xx);near(reconstructed.xy,xy.xy);near(reconstructed.yy,xy.yy);
 const rolled={tangent:[0,1,0],major:[0,0,1],minor:[1,0,0]},xz=projectSweepSection(point,'xz',.25,rolled);
 near(xz.extentX,2.5);near(xz.extentY,10);near(xz.rx,10);near(xz.ry,2.5);near(Math.abs(xz.angle),90);
});

test('transported spatial sections and fit bounds contain projected ellipsoid caps in every sketch plane',()=>{
 const shape={...makeShape('sweep'),sectionMode:'transported',sectionRoll:37,depthRatio:.35,path:[{x:-90,y:-20,z:-50,radius:8},{x:-20,y:70,z:30,radius:12},{x:80,y:20,z:90,radius:6}]};
 const samples=sweepSamples(shape),frames=sweepFrames(shape);assert.equal(samples.length,frames.length);
 for(const plane of ['xy','xz','yz']){
  const sections=samples.map((sample,index)=>projectSweepSection(sample,plane,shape.depthRatio,frames[index])),bounds=fitSweepProjection(sections);
  for(let index=0;index<sections.length;index++){
   const section=sections[index],covariance=recoverCovariance(section);near(covariance.xx,section.xx);near(covariance.xy,section.xy);near(covariance.yy,section.yy);
   assert.ok(section.x-section.extentX>=bounds.x&&section.x+section.extentX<=bounds.x+bounds.size);
   assert.ok(section.y-section.extentY>=bounds.y&&section.y+section.extentY<=bounds.y+bounds.size);
   const [h,v]=plane.split('').map(axis=>({x:0,y:1,z:2}[axis])),frame=frames[index],sample=samples[index],det=section.xx*section.yy-section.xy**2;
   for(let step=0;step<24;step++){
    const a=step*Math.PI/12,b=step*Math.PI/7,weights=[Math.sin(a)*Math.cos(b),Math.sin(a)*Math.sin(b),Math.cos(a)],axes=[frame.tangent,frame.major,frame.minor],radii=[sample.radius,sample.radius,sample.radius*shape.depthRatio];
    const dx=axes.reduce((sum,axis,i)=>sum+weights[i]*radii[i]*axis[h],0),dy=-axes.reduce((sum,axis,i)=>sum+weights[i]*radii[i]*axis[v],0);
    const ellipseDistance=(section.yy*dx*dx-2*section.xy*dx*dy+section.xx*dy*dy)/det;
    assert.ok(ellipseDistance<=1+1e-8,'a projected ellipsoid point stays inside its displayed ellipse');
   }
  }
 }
});

test('preview joins remain finite for turned sections and coincident caps',()=>{
 const a=projectSweepSection(point,'xy',.25,{tangent:[0,1,0],major:[0,0,1],minor:[1,0,0]}),b=projectSweepSection({...point,x:55,y:30},'xy',.25,{tangent:[1,0,0],major:[0,0,1],minor:[0,1,0]});
 assert.ok(projectedSectionJoin(a,b).split(/[ ,]/).map(Number).every(Number.isFinite));
 assert.equal(projectedSectionJoin(a,a),null);
});
