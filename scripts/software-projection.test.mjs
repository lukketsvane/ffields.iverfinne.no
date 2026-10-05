import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSoftwareCamera,pickSoftwareSurface,projectSoftwareMesh,projectSoftwarePoint,softwareBasis,softwarePlaneDelta,softwareView} from '../lib/software-projection.ts';

const frame={width:390,height:640},camera={center:{x:8,y:-3,z:11},yaw:.62,pitch:.34,scale:4};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} should equal ${b}`);

test('software orbit basis keeps finger movement on the camera plane without a snap',()=>{
 const {right,up,forward}=softwareBasis(camera),dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
 for(const axis of [right,up,forward])near(dot(axis,axis),1);
 near(dot(right,up),0);near(dot(right,forward),0);near(dot(up,forward),0);
 const anchor={x:35,y:9,z:-4},before=projectSoftwarePoint(anchor,camera,frame),delta=softwarePlaneDelta(camera,53,-27);
 const after=projectSoftwarePoint({x:anchor.x+delta.x,y:anchor.y+delta.y,z:anchor.z+delta.z},camera,frame);
 near(after.x-before.x,53);near(after.y-before.y,-27);near(after.depth,before.depth);
 assert.deepEqual(camera,{center:{x:8,y:-3,z:11},yaw:.62,pitch:.34,scale:4});
});

test('explicit fit frames every corner while preserving the requested orientation',()=>{
 const bounds=[-120,-30,-24,75,90,48],fitted=fitSoftwareCamera(camera,bounds,frame);
 assert.equal(fitted.yaw,camera.yaw);assert.equal(fitted.pitch,camera.pitch);assert.notEqual(fitted.scale,camera.scale);
 for(let bits=0;bits<8;bits++){
  const p=projectSoftwarePoint({x:bounds[bits&1?3:0],y:bounds[bits&2?4:1],z:bounds[bits&4?5:2]},fitted,frame);
  assert.ok(p.x>=frame.width*.11-1e-8&&p.x<=frame.width*.89+1e-8);
  assert.ok(p.y>=frame.height*.11-1e-8&&p.y<=frame.height*.89+1e-8);
 }
 assert.equal(fitSoftwareCamera(camera,[NaN,0,0,1,1,1],frame),camera);
});

test('front and top views use the same drag/projection transform',()=>{
 const front=softwareView(camera,'front'),top=softwareView(camera,'top');
 const a=projectSoftwarePoint(camera.center,front,frame),b=projectSoftwarePoint({...camera.center,x:camera.center.x+5,y:camera.center.y+3},front,frame);
 near(b.x-a.x,20);near(b.y-a.y,-12);
 const delta=softwarePlaneDelta(top,20,12);near(delta.x,5);near(delta.y,0);near(delta.z,3);
 assert.equal(front.scale,camera.scale);assert.equal(top.center,camera.center);
});

test('surface picking interpolates the visible triangle instead of nearest object origins',()=>{
 const mesh={positions:new Float32Array([-2,-2,0,2,-2,0,0,2,0,-2,-2,4,2,-2,4,0,2,4]),normals:new Float32Array([0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,1]),indices:new Uint32Array([0,1,2,3,4,5]),bounds:[-2,-2,0,2,2,4],volume:0};
 const cam={center:{x:0,y:0,z:0},yaw:0,pitch:0,scale:10},projected=projectSoftwareMesh(mesh,cam,{width:100,height:100});
 assert.equal(projected.triangles.length,2);assert.deepEqual(pickSoftwareSurface(mesh,projected.points,projected.triangles,50,50),{x:0,y:0,z:4});
 assert.equal(pickSoftwareSurface(mesh,projected.points,projected.triangles,0,0),undefined);
 const back={...mesh,normals:new Float32Array(mesh.normals.map(value=>-value))};
 assert.equal(projectSoftwareMesh(back,cam,{width:100,height:100}).triangles.length,0,'back faces do not intercept taps through the surface');
});

test('software projection preserves dense surface triangles for bounded painting chunks',()=>{
 const count=50003,mesh={positions:new Float32Array([-1,-1,0,1,-1,0,0,1,0]),normals:new Float32Array([0,0,1,0,0,1,0,0,1]),indices:new Uint32Array(count*3),bounds:[-1,-1,0,1,1,0],volume:0};
 for(let i=0;i<count;i++)mesh.indices.set([0,1,2],i*3);
 assert.equal(projectSoftwareMesh(mesh,softwareView(camera,'front'),frame).triangles.length,count,'no display face is dropped when more than one paint chunk is needed');
});
