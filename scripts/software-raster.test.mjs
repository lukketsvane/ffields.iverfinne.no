import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterizeSoftwareSurface,softwareRasterSteps} from '../lib/software-raster.ts';
import {drainSteps} from '../lib/cooperative-task.ts';
const options={ratio:1,background:[0,0,0],color:[255,255,255]},rgba=(frame,x,y)=>Array.from(frame.pixels.slice((y*frame.width+x)*4,(y*frame.width+x)*4+4));
const square={points:[{x:0,y:0,depth:0},{x:4,y:0,depth:0},{x:4,y:4,depth:0},{x:0,y:4,depth:0}],triangles:[{a:0,b:1,c:2,depth:0,shade:.5},{a:0,b:2,c:3,depth:0,shade:.5}],shades:new Float32Array([.2,.8,.8,.2])};

test('barycentric software raster is smooth and watertight across the shared diagonal',()=>{
 const image=rasterizeSoftwareSurface(square,4,4,options);
 assert.equal(image.testedTriangles,2);assert.equal(image.width,4);assert.equal(image.height,4);
 for(let y=0;y<4;y++)for(let x=0;x<4;x++){
  const expected=255*(.2+.6*(x+.5)/4),pixel=rgba(image,x,y);
  assert.ok(Math.abs(pixel[0]-expected)<=1);assert.equal(pixel[0],pixel[1]);assert.equal(pixel[1],pixel[2]);assert.equal(pixel[3],255);
 }
 const reordered=rasterizeSoftwareSurface({...square,triangles:square.triangles.toReversed()},4,4,options);
 assert.deepEqual(reordered.pixels,image.pixels,'shared edge shade does not depend on painter order');
});

test('four depth samples retain partial silhouette coverage and front faces win independently of triangle order',()=>{
 const triangle={points:[{x:0,y:0,depth:0},{x:2,y:0,depth:0},{x:0,y:2,depth:0}],triangles:[{a:0,b:1,c:2,depth:0,shade:1}],shades:new Float32Array([1,1,1])};
 const image=rasterizeSoftwareSurface(triangle,2,2,options);
 assert.equal(rgba(image,0,0)[0],255);assert.equal(rgba(image,1,1)[0],0);assert.ok(rgba(image,1,0)[0]>0&&rgba(image,1,0)[0]<255);
 const layered={points:[...square.points,...square.points.map(p=>({...p,depth:1e-6}))],triangles:[...square.triangles,...square.triangles.map(t=>({...t,a:t.a+4,b:t.b+4,c:t.c+4,depth:1e-6}))],shades:new Float32Array([.2,.2,.2,.2,1,1,1,1])};
 const first=rasterizeSoftwareSurface(layered,4,4,options),second=rasterizeSoftwareSurface({...layered,triangles:layered.triangles.toReversed()},4,4,options);
 assert.deepEqual(first.pixels,second.pixels);assert.equal(rgba(first,2,2)[0],255,'largest orthographic depth is the visible surface');
});

test('dense fine geometry visits every face and cooperative cancellation reaches a huge screen triangle',async()=>{
 const count=50_000,projection={...square,triangles:Array.from({length:count},(_,i)=>square.triangles[i%2])};
 const image=rasterizeSoftwareSurface(projection,4,4,options);assert.equal(image.testedTriangles,count);assert.deepEqual(image.pixels,rasterizeSoftwareSurface(square,4,4,options).pixels);
 const huge={...square,points:square.points.map(p=>({...p,x:p.x*150,y:p.y*150}))},controller=new AbortController();let tick=0,yields=0;
 const initializationYields=1+Math.floor(600*600*4/4096),abortAfter=initializationYields+4;
 await assert.rejects(drainSteps(softwareRasterSteps(huge,600,600,options),{signal:controller.signal,budgetMs:1,now:()=>tick++,yieldControl:async()=>{if(++yields>=abortAfter)controller.abort();}}),{name:'AbortError'});
 assert.equal(yields,abortAfter,'cancellation reaches scanlines inside the first enormous face after pixel initialization');
});

test('raster respects exact high-DPI canvas dimensions and skips only extra supersampling on large native canvases',()=>{
 const image=rasterizeSoftwareSurface(square,4,4,{...options,ratio:2});assert.equal(image.width,8);assert.equal(image.height,8);assert.equal(image.pixels.length,8*8*4);
 const desktop=rasterizeSoftwareSurface(square,1280,800,{...options,ratio:2});assert.equal(desktop.width,2560);assert.equal(desktop.height,1600);assert.equal(desktop.pixels.length,2560*1600*4,'ordinary high-DPI desktop dimensions do not throw or silently lower output resolution');
 assert.throws(()=>rasterizeSoftwareSurface(square,4,4,{...options,ratio:NaN}),/positive and finite/);
 assert.throws(()=>rasterizeSoftwareSurface(square,0,4,options),/positive and finite/);
});
