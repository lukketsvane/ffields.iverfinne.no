import type {ProjectedPoint,ProjectedTriangle} from './software-projection.ts';

export type SoftwareRasterProjection={points:readonly ProjectedPoint[];triangles:readonly ProjectedTriangle[];shades:Float32Array};
export type SoftwareRasterOptions={ratio:number;background:[number,number,number];color:[number,number,number];silhouette?:boolean;wireframe?:boolean;antialias?:boolean};
export type SoftwareRasterFrame={width:number;height:number;pixels:Uint8ClampedArray<ArrayBuffer>;testedTriangles:number;coveredSamples:number};

/** Orthographic depth and light are linear across a triangle. Rasterize into
 * one bounded pixel buffer instead of allocating a Canvas gradient/path and
 * issuing two native draw calls for every fine-mesh face. Every supplied face
 * is tested; screen sampling never changes or simplifies the model mesh.
 * Four subpixel depth samples antialias fine curved silhouettes and shared
 * edges. Work yields inside large triangles as well as between tiny faces. */
export function* softwareRasterSteps(projection:SoftwareRasterProjection,width:number,height:number,options:SoftwareRasterOptions):Generator<void,SoftwareRasterFrame,void>{
 const ratio=options.ratio;
 if(!Number.isFinite(ratio)||ratio<=0||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('Raster dimensions must be positive and finite.');
 const outWidth=Math.max(1,Math.round(width*ratio)),outHeight=Math.max(1,Math.round(height*ratio));
 // Large high-DPI desktop canvases retain their native requested dimensions.
 // One physical sample there already gives multiple samples per CSS pixel;
 // avoid multiplying that large buffer again solely for extra antialiasing.
 const factor=options.antialias===false||outWidth*outHeight>4_000_000?1:2;
 const sampleWidth=outWidth*factor,sampleHeight=outHeight*factor,depth=new Float32Array(sampleWidth*sampleHeight),samples=new Uint8ClampedArray(depth.length*3),pixels=new Uint8ClampedArray(outWidth*outHeight*4),scale=ratio*factor;
 const background=options.background,color=options.color;let work=0,coveredSamples=0,testedTriangles=0;
 yield;
 for(let i=0;i<depth.length;i++){
  depth[i]=-Infinity;const p=i*3;samples[p]=background[0];samples[p+1]=background[1];samples[p+2]=background[2];
  if(++work%4096===0)yield;
 }
 const points=projection.points,shades=projection.shades;
 for(const triangle of projection.triangles){
  testedTriangles++;if(testedTriangles%128===0)yield;
  const a=points[triangle.a],b=points[triangle.b],c=points[triangle.c];
  const ax=a.x*scale,ay=a.y*scale,bx=b.x*scale,by=b.y*scale,cx=c.x*scale,cy=c.y*scale;
  const area=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
  if(!Number.isFinite(area)||Math.abs(area)<1e-12)continue;
  const minX=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)),maxX=Math.min(sampleWidth-1,Math.floor(Math.max(ax,bx,cx)-.5));
  const minY=Math.max(0,Math.ceil(Math.min(ay,by,cy)-.5)),maxY=Math.min(sampleHeight-1,Math.floor(Math.max(ay,by,cy)-.5));
  if(minX>maxX||minY>maxY)continue;
  const ua=(by-cy)/area,va=(cx-bx)/area,ub=(cy-ay)/area,vb=(ax-cx)/area;
  const edgeA=options.wireframe?Math.hypot(ua,va):1,edgeB=options.wireframe?Math.hypot(ub,vb):1,edgeC=options.wireframe?Math.hypot(ua+ub,va+vb):1;
  const shadeA=shades[triangle.a],shadeB=shades[triangle.b],shadeC=shades[triangle.c];
  let rowA=ua*(minX+.5-cx)+va*(minY+.5-cy),rowB=ub*(minX+.5-cx)+vb*(minY+.5-cy);
  for(let y=minY;y<=maxY;y++){
   let u=rowA,v=rowB;
   for(let x=minX;x<=maxX;x++,u+=ua,v+=ub){
    if(++work%2048===0)yield;
    const w=1-u-v;if(u< -1e-8||v< -1e-8||w< -1e-8)continue;
    if(options.wireframe&&Math.min(u/edgeA,v/edgeB,w/edgeC)>scale*.4)continue;
    const index=y*sampleWidth+x,z=Math.fround(u*a.depth+v*b.depth+w*c.depth);if(z<depth[index])continue;
    depth[index]=z;coveredSamples++;const shade=options.silhouette||options.wireframe?1:u*shadeA+v*shadeB+w*shadeC,p=index*3;
    samples[p]=color[0]*shade;samples[p+1]=color[1]*shade;samples[p+2]=color[2]*shade;
   }
   rowA+=va;rowB+=vb;
  }
 }
 for(let y=0;y<outHeight;y++)for(let x=0;x<outWidth;x++){
  if(++work%2048===0)yield;
  const out=(y*outWidth+x)*4;let red=0,green=0,blue=0;
  for(let sy=0;sy<factor;sy++)for(let sx=0;sx<factor;sx++){
   const p=((y*factor+sy)*sampleWidth+x*factor+sx)*3;red+=samples[p];green+=samples[p+1];blue+=samples[p+2];
  }
  const count=factor*factor;pixels[out]=red/count;pixels[out+1]=green/count;pixels[out+2]=blue/count;pixels[out+3]=255;
 }
 return {width:outWidth,height:outHeight,pixels,testedTriangles,coveredSamples};
}

export function rasterizeSoftwareSurface(projection:SoftwareRasterProjection,width:number,height:number,options:SoftwareRasterOptions):SoftwareRasterFrame{
 const steps=softwareRasterSteps(projection,width,height,options);let step=steps.next();while(!step.done)step=steps.next();return step.value;
}
