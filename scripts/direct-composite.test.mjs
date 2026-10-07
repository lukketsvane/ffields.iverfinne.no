import test from 'node:test';
import assert from 'node:assert/strict';
import {composeDirectPatch,rotateAboutWorldAxis,eulerMatrix,selectionFrame} from '../lib/direct-manipulation.ts';
import {blankConstruction} from '../lib/construction.ts';
import {cloneModel,DEFAULT_MODEL,LIMITS} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';

const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} ≈ ${b}`);
const product=(q,r)=>{const m=[];for(let i=0;i<3;i++)for(let j=0;j<3;j++)m.push(q[i*3]*r[j]+q[i*3+1]*r[3+j]+q[i*3+2]*r[6+j]);return m};
const axisMatrix=({x,y,z},a)=>{const c=Math.cos(a),s=Math.sin(a),k=1-c;return [c+x*x*k,x*y*k-z*s,x*z*k+y*s,y*x*k+z*s,c+y*y*k,y*z*k-x*s,z*x*k-y*s,z*y*k+x*s,c+z*z*k]};

test('a twist about the view axis composes with any existing orientation',()=>{
 near(rotateAboutWorldAxis({rx:0,ry:0,rz:0},{x:0,y:0,z:1},Math.PI/2).rz,90);
 const start={rx:30,ry:-50,rz:20},axis={x:.3,y:.8,z:-.52},length=Math.hypot(axis.x,axis.y,axis.z),unit={x:axis.x/length,y:axis.y/length,z:axis.z/length};
 const turned=rotateAboutWorldAxis(start,axis,.7),expected=product(axisMatrix(unit,.7),eulerMatrix(start.rx,start.ry,start.rz)),actual=eulerMatrix(turned.rx,turned.ry,turned.rz);
 expected.forEach((value,i)=>near(actual[i],value,1e-6));
 for(const key of ['rx','ry','rz'])assert.ok(Math.abs(turned[key])<=180);
 assert.deepEqual(rotateAboutWorldAxis(start,{x:0,y:0,z:0},1),start,'a degenerate axis changes nothing');
});

test('pinch, pan and twist become one absolute patch from the gesture-start model',()=>{
 const shape={...makeShape('box'),x:10,y:5,z:0,width:40,height:30,depth:20,roundness:4,blend:6},model={...blankConstruction(),shapes:[shape]};
 const patch=composeDirectPatch(model,shape.id,{scale:1.5,move:{x:4,y:-2,z:1},turn:{axis:{x:0,y:0,z:1},radians:Math.PI/6}});
 assert.deepEqual({w:patch.shape.width,h:patch.shape.height,d:patch.shape.depth},{w:60,h:45,d:30});
 near(patch.shape.roundness,6);near(patch.shape.blend,9);
 assert.deepEqual({x:patch.shape.x,y:patch.shape.y,z:patch.shape.z},{x:14,y:3,z:1});
 near(patch.shape.rz,30);
 assert.equal(model.shapes[0].width,40,'the source model is never mutated');
 assert.equal(composeDirectPatch(model,shape.id,{scale:1}),undefined,'no change, no patch');
 assert.equal(composeDirectPatch(model,'missing',{scale:2}),undefined);
});

test('scaling is bounded by every dimension, so proportions survive the limit',()=>{
 const shape={...makeShape('sphere'),width:200,height:20,depth:20},model={...blankConstruction(),shapes:[shape]};
 const patch=composeDirectPatch(model,shape.id,{scale:3});
 near(patch.shape.width/patch.shape.height,10);
 assert.ok(patch.shape.width<=240);
});

test('the base mass only scales, inside its own limits',()=>{
 const model=cloneModel(DEFAULT_MODEL),patch=composeDirectPatch(model,'body',{scale:10,move:{x:5,y:0,z:0}});
 assert.ok(patch.base.width<=LIMITS.width[1]&&patch.base.height<=LIMITS.height[1]&&patch.base.depth<=LIMITS.depth[1]);
 near(patch.base.width/patch.base.height,model.width/model.height);
 assert.equal(composeDirectPatch(model,'body',{move:{x:5,y:0,z:0}}),undefined);
 assert.equal(composeDirectPatch({...model,baseEnabled:false},'body',{scale:1.2}),undefined);
});

test('a selection frame is the oriented box the person sees',()=>{
 const shape={...makeShape('box'),x:0,y:0,z:0,width:40,height:20,depth:10,rx:0,ry:0,rz:90},model={...blankConstruction(),shapes:[shape]};
 const frame=selectionFrame(model,shape.id);
 assert.equal(frame.corners.length,8);
 const xs=frame.corners.map(c=>c.x),ys=frame.corners.map(c=>c.y);
 near(Math.max(...xs),10);near(Math.max(...ys),20,1e-9);
 assert.equal(selectionFrame(model,'nothing'),undefined);
 assert.equal(selectionFrame(cloneModel(DEFAULT_MODEL),'body').corners.length,8);
});
