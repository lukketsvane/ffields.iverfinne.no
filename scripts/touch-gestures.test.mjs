import test from 'node:test';
import assert from 'node:assert/strict';
import {GestureRecognizer,GESTURE,wrapAngle} from '../lib/touch-gestures.ts';

function setup(overrides={}){
 const log=[],pending=new Set();
 const timers={set:(fn)=>{const h={fn};pending.add(h);return h},clear:h=>pending.delete(h)};
 const fire=()=>{for(const h of [...pending]){pending.delete(h);h.fn()}};
 const handlers={
  orbit:(dx,dy)=>log.push(['orbit',dx,dy]),
  tap:(x,y)=>log.push(['tap',x,y]),
  doubleTap:(x,y)=>log.push(['double',x,y]),
  hold:(x,y)=>{log.push(['hold',x,y]);return overrides.grab??true},
  grabMove:(x,y)=>log.push(['grab',x,y]),
  grabEnd:()=>log.push(['grabEnd']),
  pairStart:c=>{log.push(['pairStart',c.x,c.y]);return {kind:overrides.owner??'camera'}},
  pair:g=>log.push(['pair',g]),
  pairEnd:o=>log.push(['pairEnd',o.kind]),
  twoFingerTap:()=>log.push(['undo']),
  threeFingerTap:()=>log.push(['redo']),
 };
 return {g:new GestureRecognizer(handlers,timers),log,fire,kinds:()=>log.map(e=>e[0])};
}

test('a quick still touch is a tap, a second one nearby is a double tap',()=>{
 const {g,log}=setup();
 g.down(1,100,100,0);g.up(1,120);
 g.down(2,104,98,200);g.up(2,260);
 assert.deepEqual(log,[['tap',100,100],['double',104,98]]);
});

test('a lone finger orbits only after the dead zone and never jumps by it',()=>{
 const {g,log}=setup();
 g.down(1,0,0,0);g.move(1,5,0);assert.equal(log.length,0);
 g.move(1,GESTURE.dragPx+4,0);assert.equal(log.length,0,'crossing the dead zone emits nothing');
 g.move(1,GESTURE.dragPx+12,3);
 assert.deepEqual(log,[['orbit',8,3]]);
 g.up(1,400);assert.equal(log.length,1,'an orbit is never a tap');
});

test('holding still grabs; the grab owns the finger until it lifts',()=>{
 const {g,log,fire,kinds}=setup();
 g.down(1,50,60,0);fire();
 g.move(1,80,90);g.down(2,10,10,500);g.move(2,40,40);g.up(2,600);
 g.up(1,700);
 assert.deepEqual(kinds(),['hold','grab','grabEnd']);
 assert.deepEqual(log[1],['grab',80,90]);
});

test('a declined hold leaves the finger free to orbit, and a long press is not a tap',()=>{
 const {g,kinds,fire}=setup({grab:false});
 g.down(1,0,0,0);fire();g.up(1,500);
 assert.deepEqual(kinds(),['hold']);
 g.down(2,0,0,1000);fire();g.move(2,30,0);g.move(2,40,0);
 assert.deepEqual(kinds(),['hold','hold','orbit']);
});

test('moving before the hold time cancels the hold',()=>{
 const {g,kinds,fire}=setup();
 g.down(1,0,0,0);g.move(1,20,0);fire();g.move(1,30,0);
 assert.deepEqual(kinds(),['orbit']);
});

test('a pinch wakes without a jump and then follows the spread',()=>{
 const {g,log}=setup();
 g.down(1,100,100,0);g.down(2,200,100,10);
 g.move(2,210,100);
 const first=log.find(e=>e[0]==='pair')[1];
 assert.equal(first.active.scale,true);assert.equal(first.scale,1,'the waking frame is the baseline');
 g.move(2,320,100);
 const last=log.filter(e=>e[0]==='pair').at(-1)[1];
 assert.ok(Math.abs(last.scale-220/110)<1e-9);
 assert.equal(last.active.rotate,false);
 assert.ok(last.active.pan,'the centroid moved past the pan dead zone');
});

test('twist accumulates past a half turn without a seam jump',()=>{
 const {g,log}=setup();
 g.down(1,0,0,0);g.down(2,100,0,5);
 // Rotate finger 2 around finger 1 by 4 rad in small steps.
 for(let i=1;i<=40;i++){const a=i*.1;g.move(2,100*Math.cos(a),-100*Math.sin(a))}
 const last=log.filter(e=>e[0]==='pair').at(-1)[1];
 assert.ok(last.active.rotate);
 assert.ok(Math.abs(last.rotation-(4-.2))<1e-6,'rotation counts from the waking frame: '+last.rotation);
 assert.ok(Math.abs(wrapAngle(Math.PI*3))<=Math.PI);
});

test('the survivor of a pair does nothing and the pair ends once',()=>{
 const {g,kinds}=setup();
 g.down(1,0,0,0);g.down(2,100,0,5);g.move(2,160,0);g.up(2,300);
 g.move(1,60,60);g.move(1,90,90);g.up(1,500);
 assert.deepEqual(kinds().filter(k=>k!=='pair'),['pairStart','pairEnd']);
});

test('two- and three-finger taps undo and redo, even staggered',()=>{
 const {g,kinds}=setup();
 g.down(1,0,0,0);g.down(2,80,0,40);g.up(1,120);g.up(2,160);
 g.down(3,0,0,1000);g.down(4,50,0,1010);g.down(5,90,0,1020);g.up(3,1100);g.up(4,1110);g.up(5,1120);
 assert.deepEqual(kinds(),['pairStart','pairEnd','undo','pairStart','pairEnd','redo']);
});

test('a consumed or cancelled contact is never a tap',()=>{
 const {g,kinds}=setup();
 g.down(1,0,0,0);g.consume();g.up(1,50);
 g.down(2,0,0,100);g.up(2,150,true);
 g.down(3,0,0,200);g.down(4,40,0,210);g.move(4,80,0);g.up(3,260);g.up(4,270);
 assert.deepEqual(kinds().filter(k=>k!=='pair'),['pairStart','pairEnd']);
});

test('the host decides who owns a pair and object pairs need more travel',()=>{
 const {g,log}=setup({owner:'object'});
 g.down(1,0,0,0);g.down(2,100,0,5);
 // Fingers report one at a time, two pixels per frame, like a real slide.
 let at=0;const slide=to=>{for(;at<to;){at+=2;g.move(1,at,0);g.move(2,100+at,0)}};
 slide(8);
 assert.equal(log.filter(e=>e[0]==='pair').length,0,'8 px of drift does not move a selected object');
 slide(20);
 const last=log.filter(e=>e[0]==='pair').at(-1)[1];
 assert.equal(last.owner.kind,'object');assert.ok(last.active.pan);
 assert.equal(last.active.scale,false,'a slide is not a pinch');
});

test('reset ends a grab and swallows the release',()=>{
 const {g,kinds,fire}=setup();
 g.down(1,0,0,0);fire();g.reset();g.up(1,900);
 assert.deepEqual(kinds(),['hold','grabEnd']);
});

test('a frame takes only the fingers on its projected outline',async()=>{
 const {nearHull}=await import('../lib/touch-gestures.ts');
 // A diamond: its bounding rectangle would also take the corners of the square around it.
 const diamond=[{x:0,y:-10},{x:10,y:0},{x:0,y:10},{x:-10,y:0},{x:0,y:0}];
 assert.equal(nearHull(diamond,{x:0,y:0}),true);
 assert.equal(nearHull(diamond,{x:8,y:8}),false,'a bounding-box corner is not on the frame');
 assert.equal(nearHull(diamond,{x:8,y:8},6),true,'slop reaches past the edge');
 assert.equal(nearHull(diamond,{x:30,y:0},6),false);
});
