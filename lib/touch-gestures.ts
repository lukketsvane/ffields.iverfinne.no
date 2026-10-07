/** Touch contacts to meaning. The viewport feeds raw pointer positions in and
 * receives whole gestures out; nothing here knows about Three.js or React.
 *
 *  one finger   orbit after a short dead zone; a still hold grabs, a tap picks
 *  two fingers  pan, pinch and twist as independent channels; the host decides
 *               whether the pair belongs to the camera or to the selection
 *  tap counts   two-finger tap undoes, three-finger tap redoes, double tap frames
 *
 * A late second finger never jumps the camera and the survivor of a pair does
 * nothing until every finger is up, so a lifted thumb cannot start an orbit. */
export type Pt={x:number;y:number};
export type PairOwner={kind:'camera'|'object';panPx?:number;twistRad?:number;pinch?:number};
export type PairGesture={
 owner:PairOwner;
 start:Pt;
 centroid:Pt;
 /** Cumulative since each channel woke up. Waking a channel never jumps. */
 pan:Pt;scale:number;rotation:number;
 active:{pan:boolean;scale:boolean;rotate:boolean};
 /** Change since the previous event, for continuous camera moves. */
 step:{pan:Pt;scale:number;rotation:number};
};
export type GestureHandlers={
 orbit?:(dx:number,dy:number)=>void;
 tap?:(x:number,y:number)=>void;
 doubleTap?:(x:number,y:number)=>void;
 /** A finger held still. Return true to take the contact for a grab. */
 hold?:(x:number,y:number)=>boolean;
 grabMove?:(x:number,y:number)=>void;
 grabEnd?:()=>void;
 pairStart?:(centroid:Pt)=>PairOwner;
 pair?:(gesture:PairGesture)=>void;
 pairEnd?:(owner:PairOwner)=>void;
 twoFingerTap?:()=>void;
 threeFingerTap?:()=>void;
};
export type Timers={set:(fn:()=>void,ms:number)=>unknown;clear:(handle:unknown)=>void};
export const GESTURE={
 dragPx:8,holdMs:380,holdSlop:9,tapMs:320,tapSlop:9,doubleTapMs:300,doubleTapSlop:32,multiTapMs:260,
 camera:{panPx:4,twistRad:.1,pinch:.03},
 object:{panPx:12,twistRad:.14,pinch:.04},
} as const;
const defaultTimers:Timers={set:(fn,ms)=>setTimeout(fn,ms),clear:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>)};
type Contact={id:number;x:number;y:number;x0:number;y0:number};
type Mode='idle'|'armed'|'orbit'|'grab'|'pair'|'multi'|'dead';
type Channels={
 owner:PairOwner;start:Pt;d0:number;a0:number;previous:{c:Pt;d:number;a:number};
 pan?:{from:Pt};scale?:{from:number};rotate?:{from:number;turns:number;last:number};
};
/** Shortest signed turn between two angles, so crossing the seam never jumps. */
export const wrapAngle=(value:number)=>Math.atan2(Math.sin(value),Math.cos(value));

export class GestureRecognizer{
 private contacts=new Map<number,Contact>();
 private ignored=new Set<number>();
 private mode:Mode='idle';
 private started=0;private most=0;private travel=0;private consumed=false;
 private hold:unknown;private last:Pt={x:0,y:0};
 private lastTap:{x:number;y:number;t:number}|undefined;
 private channels:Channels|undefined;
 private handlers:GestureHandlers;private timers:Timers;
 constructor(handlers:GestureHandlers,timers:Timers=defaultTimers){this.handlers=handlers;this.timers=timers}

 get active(){return this.mode!=='idle'}
 get state(){return this.mode}
 get count(){return this.contacts.size}
 /** Taking the contact elsewhere (a handle, a menu) cancels taps and holds. */
 consume(){this.consumed=true;this.stopHold()}

 down(id:number,x:number,y:number,t:number){
  if(!this.contacts.size){this.mode='armed';this.started=t;this.most=0;this.travel=0;this.consumed=false;this.ignored.clear()}
  if(this.mode==='grab'){this.ignored.add(id);return}
  this.contacts.set(id,{id,x,y,x0:x,y0:y});
  this.most=Math.max(this.most,this.contacts.size);
  const n=this.contacts.size;
  if(n===1){this.last={x,y};this.armHold(id)}
  else if(n===2){this.stopHold();this.beginPair()}
  else{this.stopHold();this.endPair();this.mode='multi'}
 }

 move(id:number,x:number,y:number){
  const contact=this.contacts.get(id);
  if(!contact){return}
  contact.x=x;contact.y=y;
  this.travel=Math.max(this.travel,Math.hypot(x-contact.x0,y-contact.y0));
  if(this.mode==='armed'){
   if(Math.hypot(x-contact.x0,y-contact.y0)>GESTURE.dragPx){this.stopHold();this.mode='orbit';this.last={x,y}}
  }else if(this.mode==='orbit'){
   const dx=x-this.last.x,dy=y-this.last.y;this.last={x,y};
   if(dx||dy)this.handlers.orbit?.(dx,dy);
  }else if(this.mode==='grab'){
   this.handlers.grabMove?.(x,y);
  }else if(this.mode==='pair'){
   this.updatePair();
  }
 }

 up(id:number,t:number,cancel=false){
  if(this.ignored.delete(id))return;
  if(!this.contacts.has(id))return;
  if(cancel)this.consume();
  const was=this.contacts.get(id)!;
  this.contacts.delete(id);
  if(this.mode==='grab'){this.mode='dead';this.handlers.grabEnd?.()}
  else if(this.mode==='pair'){this.endPair();this.mode='dead'}
  else if(this.mode==='orbit'||this.mode==='armed')this.stopHold();
  if(this.contacts.size)return;
  const armed=this.mode==='armed',duration=t-this.started,still=this.travel<=GESTURE.tapSlop&&!this.consumed;
  if(still&&this.most===1&&armed&&duration<GESTURE.tapMs)this.tap(was.x,was.y,t);
  else if(still&&this.most===2&&duration<GESTURE.multiTapMs)this.handlers.twoFingerTap?.();
  else if(still&&this.most===3&&duration<GESTURE.multiTapMs)this.handlers.threeFingerTap?.();
  this.mode='idle';this.most=0;this.ignored.clear();
 }

 /** The tab was hidden, a sheet opened, or the browser took the touches. */
 reset(){
  this.stopHold();
  if(this.mode==='grab')this.handlers.grabEnd?.();
  if(this.mode==='pair')this.endPair();
  this.contacts.clear();this.ignored.clear();this.mode='idle';this.consumed=true;this.lastTap=undefined;
 }

 private tap(x:number,y:number,t:number){
  const previous=this.lastTap;
  if(previous&&t-previous.t<GESTURE.doubleTapMs&&Math.hypot(x-previous.x,y-previous.y)<GESTURE.doubleTapSlop){this.lastTap=undefined;this.handlers.doubleTap?.(x,y);return}
  this.lastTap={x,y,t};
  this.handlers.tap?.(x,y);
 }
 private armHold(id:number){
  this.stopHold();
  this.hold=this.timers.set(()=>{
   this.hold=undefined;
   const contact=this.contacts.get(id);
   if(!contact||this.mode!=='armed'||this.contacts.size!==1||this.consumed)return;
   if(Math.hypot(contact.x-contact.x0,contact.y-contact.y0)>GESTURE.holdSlop)return;
   if(this.handlers.hold?.(contact.x,contact.y)){this.mode='grab';this.consumed=true}
  },GESTURE.holdMs);
 }
 private stopHold(){if(this.hold!==undefined){this.timers.clear(this.hold);this.hold=undefined}}

 private measure(){
  const [a,b]=[...this.contacts.values()];
  return {c:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},d:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),a:Math.atan2(-(b.y-a.y),b.x-a.x)};
 }
 private beginPair(){
  this.mode='pair';
  const m=this.measure(),owner=this.handlers.pairStart?.(m.c)??{kind:'camera'};
  const preset=owner.kind==='object'?GESTURE.object:GESTURE.camera;
  this.channels={owner:{...preset,...owner},start:m.c,d0:m.d,a0:m.a,previous:m};
 }
 private updatePair(){
  const ch=this.channels;if(!ch||this.contacts.size!==2)return;
  const m=this.measure(),owner=ch.owner,panPx=owner.panPx??GESTURE.camera.panPx,twist=owner.twistRad??GESTURE.camera.twistRad,pinch=owner.pinch??GESTURE.camera.pinch;
  if(!ch.pan&&Math.hypot(m.c.x-ch.start.x,m.c.y-ch.start.y)>panPx)ch.pan={from:m.c};
  if(!ch.scale&&Math.abs(m.d/ch.d0-1)>pinch)ch.scale={from:m.d};
  // Twist accumulates through the shortest turn each step, so it can exceed a half turn.
  const turn=wrapAngle(m.a-ch.previous.a);
  if(ch.rotate){ch.rotate.turns+=turn;ch.rotate.last=ch.rotate.turns}
  else{
   const total=wrapAngle(m.a-ch.a0);
   if(Math.abs(total)>twist)ch.rotate={from:total,turns:total,last:total};
  }
  const rotation=ch.rotate?ch.rotate.turns-ch.rotate.from:0,scale=ch.scale?m.d/ch.scale.from:1;
  const pan=ch.pan?{x:m.c.x-ch.pan.from.x,y:m.c.y-ch.pan.from.y}:{x:0,y:0};
  const stepPan=ch.pan?{x:m.c.x-ch.previous.c.x,y:m.c.y-ch.previous.c.y}:{x:0,y:0};
  const stepScale=ch.scale&&ch.previous.d>0?m.d/ch.previous.d:1;
  const stepRotation=ch.rotate?turn:0;
  ch.previous=m;
  if(!ch.pan&&!ch.scale&&!ch.rotate)return;
  this.handlers.pair?.({owner,start:ch.start,centroid:m.c,pan,scale,rotation,active:{pan:!!ch.pan,scale:!!ch.scale,rotate:!!ch.rotate},step:{pan:stepPan,scale:stepScale,rotation:stepRotation}});
 }
 private endPair(){
  const ch=this.channels;this.channels=undefined;
  if(ch)this.handlers.pairEnd?.(ch.owner);
 }
}

/** Is a screen point inside the projected outline of a box, or within slop of it?
 * The outline is the convex hull of the projected corners, so a turned or
 * foreshortened frame takes exactly the fingers that land on what is drawn. */
export function nearHull(points:readonly Pt[],p:Pt,slop=0):boolean{
 const sorted=[...points].sort((a,b)=>a.x-b.x||a.y-b.y);
 const cross=(o:Pt,a:Pt,b:Pt)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
 const lower:Pt[]=[],upper:Pt[]=[];
 for(const q of sorted){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],q)<=0)lower.pop();lower.push(q)}
 for(const q of sorted.reverse()){while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],q)<=0)upper.pop();upper.push(q)}
 const hull=lower.slice(0,-1).concat(upper.slice(0,-1));
 if(hull.length>=3&&hull.every((a,i)=>cross(a,hull[(i+1)%hull.length],p)>=0))return true;
 for(let i=0;i<hull.length;i++){
  const a=hull[i],b=hull[(i+1)%hull.length],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  if(Math.hypot(a.x+dx*t-p.x,a.y+dy*t-p.y)<=slop)return true;
 }
 return false;
}
