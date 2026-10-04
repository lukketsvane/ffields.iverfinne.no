import {evaluateShape} from './shapes.ts';
import type {FormShape} from './shapes.ts';

export type LatticeKind = 'gyroid'|'diamond'|'honeycomb'|'octet';
export type LatticeAxis = 'x'|'y'|'z';
export type LatticeSettings = {
 enabled:boolean;kind:LatticeKind;cellSize:number;thickness:number;
 gradient:number;skin:number;axis:LatticeAxis;reveal:number;region?:FormShape;
};
export type LatticeDimensions = {width:number;height:number;depth:number};
export const LATTICE_LIMITS={cellSize:[8,40],thickness:[1.2,6],gradient:[-.8,.8],skin:[0,6],reveal:[0,1]} as const;
export const DEFAULT_LATTICE:LatticeSettings={enabled:false,kind:'gyroid',cellSize:18,thickness:2.4,gradient:0,skin:1.8,axis:'z',reveal:0};
export const LATTICE_NAMES:Record<LatticeKind,string>={gyroid:'Gyroid sheet',diamond:'Diamond sheet',honeycomb:'Honeycomb',octet:'Octet truss'};
const TAU=Math.PI*2,SQRT3=Math.sqrt(3),SQRT2=Math.sqrt(2);
const clamp=(value:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,value));
// Signed distance to the nearest parallel plane in an infinite periodic family.
const repeat=(value:number,period:number)=>value-period*Math.round(value/period);

/** Analytic periodic sheet. The calibrated value is distance-like, not an exact
 * SDF; thickness is nominal mm and varies slightly with local surface slope. */
export function gyroidField(x:number,y:number,z:number,cellSize:number,thickness:number){
 const k=TAU/cellSize,a=x*k,b=y*k,c=z*k;
 const field=Math.sin(a)*Math.cos(b)+Math.sin(b)*Math.cos(c)+Math.sin(c)*Math.cos(a);
 return Math.abs(field)/(k*1.5)-thickness/2;
}
export function diamondField(x:number,y:number,z:number,cellSize:number,thickness:number){
 const k=TAU/cellSize,a=x*k,b=y*k,c=z*k,sx=Math.sin(a),sy=Math.sin(b),sz=Math.sin(c),cx=Math.cos(a),cy=Math.cos(b),cz=Math.cos(c);
 const field=sx*sy*sz+sx*cy*cz+cx*sy*cz+cx*cy*sz;
 return Math.abs(field)/(k*SQRT2)-thickness/2;
}
/** Hexagonal Voronoi walls, extruded along the selected axis. Only two lattice
 * center candidates are needed, regardless of the number of cells. */
export function honeycombField(u:number,v:number,cellSize:number,thickness:number){
 const row=cellSize*SQRT3,ax=repeat(u,cellSize),ay=repeat(v,row),bx=repeat(u-cellSize/2,cellSize),by=repeat(v-row/2,row);
 const second=bx*bx+by*by<ax*ax+ay*ay,dx=second?bx:ax,dy=second?by:ay;
 const support=Math.max(Math.abs(dx),Math.abs(dx*.5+dy*SQRT3/2),Math.abs(-dx*.5+dy*SQRT3/2));
 return Math.abs(cellSize/2-support)-thickness/2;
}
/** FCC nearest-neighbour struts: six diagonal directions in two staggered
 * layers. This is a constant-size analytic evaluation, never a cell loop. */
function octetPairSquared(a:number,b:number,c:number,cellSize:number){
 const layer0=repeat(c,cellSize),layer1=repeat(c-cellSize/2,cellSize),plus0=repeat(a+b,cellSize),minus0=repeat(a-b,cellSize),plus1=repeat(a+b-cellSize/2,cellSize),minus1=repeat(a-b-cellSize/2,cellSize);
 return Math.min(Math.min(plus0*plus0,minus0*minus0)/2+layer0*layer0,Math.min(plus1*plus1,minus1*minus1)/2+layer1*layer1);
}
export function octetField(x:number,y:number,z:number,cellSize:number,thickness:number){
 const distanceSquared=Math.min(octetPairSquared(x,y,z,cellSize),octetPairSquared(x,z,y,cellSize),octetPairSquared(y,z,x,cellSize));
 return Math.sqrt(distanceSquared)-thickness/2;
}
/** Negative material / positive void. Gradient changes thickness, preserving
 * cell phase so density transitions do not split or misalign the lattice. */
export function evaluateLatticeField(settings:LatticeSettings,x:number,y:number,z:number,dimensions:LatticeDimensions){
 const coordinate=settings.axis==='x'?x:settings.axis==='y'?y:z;
 const extent=settings.axis==='x'?dimensions.width:settings.axis==='y'?dimensions.height:dimensions.depth;
 const thickness=settings.thickness*(1+settings.gradient*clamp(coordinate/(extent/2),-1,1));
 switch(settings.kind){
  case 'gyroid':return gyroidField(x,y,z,settings.cellSize,thickness);
  case 'diamond':return diamondField(x,y,z,settings.cellSize,thickness);
  case 'honeycomb':return settings.axis==='x'?honeycombField(y,z,settings.cellSize,thickness):settings.axis==='y'?honeycombField(x,z,settings.cellSize,thickness):honeycombField(x,y,settings.cellSize,thickness);
  case 'octet':return octetField(x,y,z,settings.cellSize,thickness);
 }
}
/** Remove a positive-side quarter progressively: axis X reveals right/top,
 * Y reveals top/front, Z reveals front/right. A zero reveal removes nothing. */
export function latticeRevealField(settings:LatticeSettings,x:number,y:number,z:number,dimensions:LatticeDimensions){
 if(settings.reveal===0)return Infinity;
 const t=1-settings.reveal;
 if(settings.axis==='x')return Math.max(dimensions.width/2*t-x,dimensions.height/2*t-y);
 if(settings.axis==='y')return Math.max(dimensions.height/2*t-y,dimensions.depth/2*t-z);
 return Math.max(dimensions.depth/2*t-z,dimensions.width/2*t-x);
}
/** Clip the periodic core to the composed exterior. Outside an optional region
 * remains solid. The boundary skin follows that exterior, not primitive seams. */
export function applyLattice(exterior:number,settings:LatticeSettings,x:number,y:number,z:number,dimensions:LatticeDimensions){
 if(!settings.enabled||exterior===Infinity)return exterior;
 let material=Math.max(exterior,evaluateLatticeField(settings,x,y,z,dimensions));
 if(settings.region?.enabled)material=Math.min(material,Math.max(exterior,-evaluateShape(settings.region,x,y,z)));
 if(settings.skin>0)material=Math.min(material,Math.max(exterior,-exterior-settings.skin));
 return settings.reveal>0?Math.max(material,-latticeRevealField(settings,x,y,z,dimensions)):material;
}
