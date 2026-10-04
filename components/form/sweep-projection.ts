import type {SweepFrame,SweepPoint} from '@/lib/shapes';

export type SketchAxis='x'|'y'|'z';
export type SketchPlane='xy'|'xz'|'yz';
export type SectionProjection={x:number;y:number;radius:number;rx:number;ry:number;angle:number;xx:number;xy:number;yy:number;extentX:number;extentY:number};
export type SketchBounds={x:number;y:number;size:number};
export const SKETCH_PLANES:Record<SketchPlane,readonly [SketchAxis,SketchAxis]>={xy:['x','y'],xz:['x','z'],yz:['y','z']};
const AXIS_INDEX={x:0,y:1,z:2} as const;

/** Orthographic projection of a section cap. The covariance keeps its physical
 * center fixed and includes the transported ellipsoid's tangent extent. */
export function projectSweepSection(point:SweepPoint,plane:SketchPlane,depthRatio=1,frame?:SweepFrame):SectionProjection{
 const [horizontal,vertical]=SKETCH_PLANES[plane],radiusSquared=point.radius*point.radius;
 let xx=radiusSquared,xy=0,yy=radiusSquared*(vertical==='z'?depthRatio*depthRatio:1);
 if(frame){
  const h=AXIS_INDEX[horizontal],v=AXIS_INDEX[vertical];
  xx=0;xy=0;yy=0;
  for(const [direction,scale] of [[frame.tangent,1],[frame.major,1],[frame.minor,depthRatio*depthRatio]] as const){
   xx+=radiusSquared*scale*direction[h]*direction[h];
   xy-=radiusSquared*scale*direction[h]*direction[v];
   yy+=radiusSquared*scale*direction[v]*direction[v];
  }
 }
 const halfTrace=(xx+yy)/2,spread=Math.hypot((xx-yy)/2,xy);
 return {x:point[horizontal],y:-point[vertical],radius:point.radius,rx:Math.sqrt(Math.max(0,halfTrace+spread)),ry:Math.sqrt(Math.max(0,halfTrace-spread)),angle:Math.atan2(2*xy,xx-yy)*90/Math.PI,xx,xy,yy,extentX:Math.sqrt(Math.max(0,xx)),extentY:Math.sqrt(Math.max(0,yy))};
}

export function fitSweepProjection(sections:readonly SectionProjection[]):SketchBounds{
 const minX=Math.min(...sections.map(section=>section.x-section.extentX)),maxX=Math.max(...sections.map(section=>section.x+section.extentX));
 const minY=Math.min(...sections.map(section=>section.y-section.extentY)),maxY=Math.max(...sections.map(section=>section.y+section.extentY));
 const size=Math.max(200,(maxX-minX)*1.24,(maxY-minY)*1.24);
 return {x:(minX+maxX-size)/2,y:(minY+maxY-size)/2,size};
}

/** Support points join adjacent preview caps without changing their projected
 * radii or orientation. They are a visual envelope, not an export mesh. */
export function projectedSectionJoin(a:SectionProjection,b:SectionProjection):string|null{
 const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(length<1e-8)return null;
 const nx=-dy/length,ny=dx/length;
 const support=(section:SectionProjection)=>{const divisor=Math.sqrt(Math.max(0,section.xx*nx*nx+2*section.xy*nx*ny+section.yy*ny*ny));return divisor?{x:(section.xx*nx+section.xy*ny)/divisor,y:(section.xy*nx+section.yy*ny)/divisor}:{x:0,y:0}};
 const av=support(a),bv=support(b);
 return `${a.x+av.x},${a.y+av.y} ${b.x+bv.x},${b.y+bv.y} ${b.x-bv.x},${b.y-bv.y} ${a.x-av.x},${a.y-av.y}`;
}
