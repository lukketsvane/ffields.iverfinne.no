import assetCatalog from './asset-catalog.json' with {type:'json'};
import type {PlacedAsset} from './assets';
import {refineMeshSurface,refineMeshSurfaceAsync} from './mesh-refinement.ts';
import {drainSteps} from './cooperative-task.ts';
import {createMeshSamplingGrid} from './mesh-sampling.ts';
import type {MeshSamplingOptions,MeshSamplingStats} from './mesh-sampling.ts';
import type {MeshRefinementOptions,MeshRefinementStats} from './mesh-refinement.ts';
import {evaluateShape,compileShape,makeShape,shapeBounds,SHAPE_LIMITS,MAX_SHAPES,isValidSweepPath} from './shapes.ts';
import type {FormShape,ShapeEvaluator} from './shapes.ts';
import {applyLattice,LATTICE_LIMITS} from './lattice.ts';
import type {LatticeSettings} from './lattice.ts';
import {resolveAttachments,validateAttachments} from './attachments.ts';
import type {SweepAttachment} from './attachments.ts';
import {componentEnvelopeDimensions,resolveComponentClearances,validateComponentClearances} from './component-clearance.ts';
import type {ComponentClearance} from './component-clearance.ts';
export type InfluenceKind = 'wave'|'grip'|'bulge'|'pinch'|'flatten'|'twist';
export type Falloff = 'gaussian'|'linear'|'smooth'|'constant';
export type Influence = {id:string;name:string;kind:InfluenceKind;enabled:boolean;strength:number;radius:number;x:number;y:number;z:number;wavelength:number;phase:number;angle:number;falloff:Falloff};
export type FormModel = {version:1;name:string;width:number;height:number;depth:number;softness:number;asymmetry:number;lensSpacing:number;lensRadius:number;protect:boolean;lenses:boolean;shell:boolean;wall:number;usb:boolean;buttons:boolean;fingerGrooves:boolean;assets?:PlacedAsset[];shapes?:FormShape[];baseEnabled?:boolean;lattice?:LatticeSettings;attachments?:SweepAttachment[];componentClearances?:ComponentClearance[];influences:Influence[]};
export type Variant={id:string;name:string;model:FormModel;image?:string};
export type MeshData={positions:Float32Array;normals:Float32Array;indices:Uint32Array;volume:number;bounds:number[];refinement?:MeshRefinementStats;sampling?:MeshSamplingStats};
export const LIMITS={width:[90,220],height:[45,120],depth:[22,90],softness:[2,24],asymmetry:[-15,15],lensSpacing:[24,70],lensRadius:[8,18],wall:[1.6,6]} as const;
export const CAMERA_MODEL:FormModel={version:1,name:'Camera study',width:150,height:76,depth:42,softness:12,asymmetry:2,lensSpacing:52,lensRadius:13,protect:true,lenses:true,shell:true,wall:2.6,usb:true,buttons:true,fingerGrooves:true,influences:[{id:'wave-1',name:'Travelling wave',kind:'wave',enabled:true,strength:4.8,radius:140,x:0,y:0,z:21,wavelength:44,phase:103,angle:32,falloff:'gaussian'},{id:'grip-1',name:'Hand-contact mass',kind:'grip',enabled:true,strength:9,radius:35,x:51,y:-2,z:21,wavelength:60,phase:0,angle:0,falloff:'smooth'}]};
export const DEFAULT_MODEL:FormModel={...CAMERA_MODEL,name:'Entropy study',protect:false,lenses:false,shell:false,usb:false,buttons:false,fingerGrooves:false,baseEnabled:true,shapes:[],influences:[{...CAMERA_MODEL.influences[0]}]};
const LEGACY_CAMERA_STARTER={version:1,name:'Camera study',width:158,height:76,depth:44,softness:14,asymmetry:3,lensSpacing:34,lensRadius:13,protect:true,lenses:true,influences:[{id:'wave-1',name:'Travelling wave',kind:'wave',enabled:true,strength:7.5,radius:100,x:16,y:0,z:22,wavelength:61,phase:25,angle:18,falloff:'gaussian'},{id:'grip-1',name:'Hand-contact mass',kind:'grip',enabled:true,strength:12,radius:35,x:54,y:-2,z:22,wavelength:60,phase:0,angle:0,falloff:'smooth'}]};
function sameValue(a:unknown,b:unknown):boolean {if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>,keys=Object.keys(aa);return keys.length===Object.keys(bb).length&&keys.every(k=>Object.hasOwn(bb,k)&&sameValue(aa[k],bb[k]));}
/** Only unchanged shipped starters migrate; authored camera documents keep all edits. */
export function isShippedCameraStarter(input:unknown){if(!input||typeof input!=='object')return false;const {assets,shapes,baseEnabled,...candidate}=input as FormModel;if((assets&&assets.length)||(shapes&&shapes.length)||baseEnabled===false)return false;return sameValue(candidate,CAMERA_MODEL)||sameValue(candidate,LEGACY_CAMERA_STARTER);}
export const cloneModel=(m:FormModel):FormModel=>JSON.parse(JSON.stringify(m));
/** A repeatable arrangement of overlapping masses; a supplied seed reproduces it. */
export function makeEntropyModel(seed=Math.floor(Math.random()*0x100000000)):FormModel {
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/0x100000000};
 const m=cloneModel(DEFAULT_MODEL),count=3+Math.floor(random()*3);m.baseEnabled=false;m.name='Entropy study';m.asymmetry=0;m.shapes=[];
 for(let i=0;i<count;i++){const kind=i===1?'capsule':'sphere',shape=makeShape(kind);shape.id='entropy-'+(seed>>>0).toString(36)+'-'+i;shape.name=i===1?'Stretched mass':'Mass '+(i+1);shape.x=(i-(count-1)/2)*23+(random()-.5)*8;shape.y=(random()-.5)*23;shape.z=(random()-.5)*17;shape.width=48+random()*28;shape.height=kind==='capsule'?62+random()*28:40+random()*30;shape.depth=40+random()*27;shape.rx=(random()-.5)*35;shape.ry=(random()-.5)*35;shape.rz=(random()-.5)*50;shape.blend=10+random()*10;shape.roundness=kind==='capsule'?Math.min(shape.width,shape.depth)/2:0;m.shapes.push(shape);}
 m.influences[0]={...m.influences[0],strength:5+random()*3,wavelength:40+random()*22,angle:-45+random()*90,phase:random()*360};
 m.influences.push({...makeInfluence('twist'),id:'entropy-twist',name:'Entropy twist',strength:6+random()*8,radius:120,x:0,y:0,z:0});return m;
}
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const lensCenters=(m:FormModel)=>[-m.width*.14-m.lensSpacing/2,-m.width*.14+m.lensSpacing/2];
export function smoothstep(a:number,b:number,x:number){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)}
export function weight(f:Influence,x:number,y:number,z:number){const dx=x-f.x,dy=y-f.y,dz=(z-f.z)*.6;const d=Math.sqrt(dx*dx+dy*dy+dz*dz)/f.radius;switch(f.falloff){case 'constant':return 1;case 'linear':return Math.max(0,1-d);case 'smooth':return 1-smoothstep(0,1.4,d);default:return Math.exp(-d*d*1.6)}}
export const lensY=(m:FormModel)=>m.height*.13;
export const shutterPosition=(m:FormModel)=>[m.width*.34,m.height/2+1.3,0] as const;
export const portPosition=(m:FormModel)=>[m.width/2,-m.height*.25,-1] as const;
export function protection(m:FormModel,x:number,y:number,z:number){if(!m.protect||!m.lenses)return 1;let result=1;for(const cx of lensCenters(m)){const d=Math.hypot(x-cx,y-lensY(m));result*=smoothstep(m.lensRadius+1,m.lensRadius+22,d)}return result}
// Waves are an explicit deformation. The GPU preview and exported implicit field
// share this mapping; a phase change never requires remeshing the live viewport.
export function rippleOffset(m:FormModel,x:number,y:number,z:number,phaseOverride?:number){
 let sum=0,totalAmplitude=0,first=true;
 for(const f of m.influences){if(f.kind!=='wave')continue;const phase=first&&phaseOverride!==undefined?phaseOverride:f.phase;first=false;if(!f.enabled)continue;totalAmplitude+=Math.abs(f.strength);
  const a=f.angle*Math.PI/180,d=Math.hypot(x-f.x,y-f.y)/f.radius;
  const w=f.falloff==='constant'?1:f.falloff==='linear'?Math.max(0,1-d):f.falloff==='smooth'?1-smoothstep(0,1.4,d):Math.exp(-d*d*1.6);
  sum+=f.strength*w*Math.sin(((x-f.x)*Math.cos(a)+(y-f.y)*Math.sin(a))/f.wavelength*Math.PI*2+phase*Math.PI/180);
 }
 let mask=protection(m,x,y,z);
 if(m.buttons){const p=shutterPosition(m);mask*=smoothstep(9,21,Math.hypot(x-p[0],y-p[1]));}
 if(m.usb){const p=portPosition(m);mask*=smoothstep(8,19,Math.hypot(x-p[0],y-p[1]));}
 // Fade gently at the back; preserve a positive Jacobian even at max amplitude.
 return sum*mask*(.82+.18*Math.tanh(z/Math.max(m.depth,44,totalAmplitude*.36)));
}
export function withoutRipples(m:FormModel):FormModel{const {assets,componentClearances,...geometry}=resolveComponentClearances(m);void assets;void componentClearances;return {...geometry,influences:m.influences.filter(f=>f.kind!=='wave')}}
export function fieldStrength(m:FormModel,x:number,y:number,z:number){let total=0;for(const f of m.influences)if(f.enabled)total+=weight(f,x,y,z)*Math.abs(f.strength);return total*protection(m,x,y,z)}
function roundBox(x:number,y:number,z:number,hx:number,hy:number,hz:number,r:number){const qx=Math.abs(x)-hx+r,qy=Math.abs(y)-hy+r,qz=Math.abs(z)-hz+r;return Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0))+Math.min(Math.max(qx,qy,qz),0)-r}
function cylinderZ(x:number,y:number,z:number,r:number,h:number){const a=Math.hypot(x,y)-r,b=Math.abs(z)-h;return Math.min(Math.max(a,b),0)+Math.hypot(Math.max(a,0),Math.max(b,0))}
function smoothUnion(a:number,b:number,k:number){if(!Number.isFinite(a))return a===Infinity?b:a;if(!Number.isFinite(b))return b===Infinity?a:b;if(k<=0)return Math.min(a,b);const h=clamp(.5+.5*(b-a)/k,0,1);return b+(a-b)*h-k*h*(1-h)}
function capsule(x:number,y:number,z:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number,r:number){const vx=x-ax,vy=y-ay,vz=z-az,dx=bx-ax,dy=by-ay,dz=bz-az,t=clamp((vx*dx+vy*dy+vz*dz)/(dx*dx+dy*dy+dz*dz),0,1);return Math.hypot(vx-dx*t,vy-dy*t,vz-dz*t)-r}
export function evaluateBase(m:FormModel,x:number,y:number,z:number,compiledShapes?:readonly ShapeEvaluator[]){const px=x,py=y,pz=z,protect=protection(m,x,y,z);let radial=0,flattenAmount=0,flattenCentre=0,flattenWeight=0;for(const f of m.influences){if(!f.enabled||f.kind==='wave')continue;const w=weight(f,px,py,pz)*protect,s=f.strength*w;switch(f.kind){case 'grip':z-=s;x-=s*.12;break;case 'bulge':radial+=s;break;case 'pinch':radial-=s;break;case 'flatten':flattenAmount+=s;flattenCentre+=f.z*Math.abs(s);flattenWeight+=Math.abs(s);break;case 'twist':{const a=s*Math.PI/180,yy=y,zz=z;y=yy*Math.cos(a)-zz*Math.sin(a);z=yy*Math.sin(a)+zz*Math.cos(a);break}}}
 if(flattenWeight>0){const plane=flattenCentre/flattenWeight,compression=clamp(flattenAmount/28,-.5,.8);z=plane+(z-plane)/(1-compression)}
 y-=m.asymmetry*(x/m.width)*.25;const r=Math.min(m.softness,m.height/2-1,m.depth/2-1);let exterior=m.baseEnabled===false?Infinity:roundBox(x,y,z,m.width/2,m.height/2,m.depth/2,r);
 const shapes=m.shapes??[];for(let i=0;i<shapes.length;i++){const shape=shapes[i];if(!shape.enabled)continue;
  // A smooth union is exactly unchanged when sd >= current + blend. The same
  // bound applies to subtraction's negated current field. Intersection needs
  // an upper-bound test instead, so it keeps unrestricted evaluation.
  const limit=shape.operation==='union'?exterior+shape.blend:shape.operation==='subtract'?-exterior+shape.blend:Infinity;
  const sd=compiledShapes?compiledShapes[i](x,y,z,limit):evaluateShape(shape,x,y,z,limit);
  if(shape.operation==='union')exterior=smoothUnion(exterior,sd,shape.blend);else if(shape.operation==='subtract')exterior=-smoothUnion(-exterior,sd,shape.blend);else exterior=-smoothUnion(-exterior,-sd,shape.blend);
 }
 exterior-=radial;
 if(m.fingerGrooves){for(const yy of [-17,-3,11]){const groove=capsule(px,py,pz,m.width*.30,yy,m.depth/2+13.5,m.width*.51,yy+7,m.depth/2+8.5,5);exterior=-smoothUnion(-exterior,groove,5)}}
 // Annular seats are part of the enclosure, with small edge fillets.
 if(m.lenses){for(const cx of lensCenters(m)){const seat=cylinderZ(px-cx,py-lensY(m),pz-(m.depth/2-2.7),m.lensRadius-.1,2.5)-.6;exterior=smoothUnion(exterior,seat,2.8)}}
 // An enabled lattice builds a real core and uses its own outer skin. Disabled
 // and legacy documents retain their existing hollow-shell behavior.
 let d=m.lattice?.enabled?applyLattice(exterior,m.lattice,x,y,z,m):m.shell?Math.max(exterior,-exterior-m.wall):exterior;
 // Subtract apertures AFTER shelling: both connect to the internal cavity.
 if(m.lenses){for(const cx of lensCenters(m)){const bore=cylinderZ(px-cx,py-lensY(m),pz-m.depth/2,m.lensRadius-1,m.depth/2+1);d=Math.max(d,-bore)}}
 if(m.usb){const p=portPosition(m),port=roundBox(px-p[0],py-p[1],pz-p[2],12,1.9,4.8,1.2);d=Math.max(d,-port)}
 if(m.buttons){const p=shutterPosition(m),socket=cylinderZ(px-p[0],pz-p[2],py-p[1],6.6,5);d=Math.max(d,-socket)}
 return d;
}
export function evaluate(m:FormModel,x:number,y:number,z:number){
 if(!m.influences.some(f=>f.kind==='wave'&&f.enabled&&f.strength!==0))return evaluateBase(m,x,y,z);
 // Invert the monotonic Z displacement. Newton converges to sub-micron accuracy.
 let q=z-rippleOffset(m,x,y,z);
 for(let i=0;i<3;i++){const delta=rippleOffset(m,x,y,q),slope=(rippleOffset(m,x,y,q+.01)-delta)/.01;q-=(q+delta-z)/(1+slope)}
 return evaluateBase(m,x,y,q);
}
export function makeInfluence(kind:InfluenceKind):Influence {const names={wave:'Travelling wave',grip:'Grip field',bulge:'Local fullness',pinch:'Local pinch',flatten:'Planar zone',twist:'Local twist'};return {id:kind+'-'+Math.random().toString(36).slice(2,9),name:names[kind],kind,enabled:true,strength:kind==='twist'?18:7,radius:45,x:25,y:0,z:22,wavelength:60,phase:0,angle:0,falloff:'gaussian'}}
export function validateModel(input:unknown):FormModel {
 if(!input||typeof input!=='object')throw Error('This file does not contain a FORM model.');const raw=input as FormModel;
 const m={...raw,shell:raw.shell??raw.lenses,wall:raw.wall??2.6,usb:raw.usb??raw.lenses,buttons:raw.buttons??raw.lenses,fingerGrooves:raw.fingerGrooves??raw.lenses};
 if(m.version!==1||typeof m.name!=='string'||m.name.length>120||!Array.isArray(m.influences)||m.influences.length>20)throw Error('Unsupported model file.');
 for(const [key,range]of Object.entries(LIMITS)){const val=m[key as keyof typeof LIMITS];if(typeof val!=='number'||!Number.isFinite(val)||val<range[0]||val>range[1])throw Error('Invalid '+key+' value.');}
 if([m.protect,m.lenses,m.shell,m.usb,m.buttons,m.fingerGrooves].some(v=>typeof v!=='boolean')||(m.baseEnabled!==undefined&&typeof m.baseEnabled!=='boolean'))throw Error('Invalid region settings.');
 const ids=new Set<string>(['body','regions','enclosure','canvas','lattice','mesh-quality']);
 for(const f of m.influences){if(!f||typeof f.id!=='string'||!f.id.length||f.id.length>100||ids.has(f.id)||typeof f.name!=='string'||f.name.length>100||typeof f.enabled!=='boolean'||!['wave','grip','bulge','pinch','flatten','twist'].includes(f.kind)||!['gaussian','linear','smooth','constant'].includes(f.falloff))throw Error('Invalid influence.');ids.add(f.id);const ranges:Record<string,number[]>={strength:[-22,22],radius:[12,160],x:[-120,120],y:[-65,65],z:[-70,70],wavelength:[24,140],phase:[0,360],angle:[-90,90]};for(const [k,r]of Object.entries(ranges)){const v=f[k as keyof Influence];if(typeof v!=='number'||!Number.isFinite(v)||v<r[0]||v>r[1])throw Error('Invalid influence '+k+'.');}}
 if(m.shapes!==undefined){if(!Array.isArray(m.shapes)||m.shapes.length>MAX_SHAPES)throw Error('Invalid shape list.');for(const shape of m.shapes){if(!shape||typeof shape.id!=='string'||!shape.id.length||shape.id.length>100||ids.has(shape.id)||typeof shape.name!=='string'||shape.name.length>100||typeof shape.enabled!=='boolean'||!['sphere','box','capsule','cylinder','torus','sweep'].includes(shape.kind)||!['union','subtract','intersect'].includes(shape.operation))throw Error('Invalid shape.');ids.add(shape.id);for(const [key,range]of Object.entries(SHAPE_LIMITS)){const value=shape[key as keyof typeof SHAPE_LIMITS];if(typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])throw Error('Invalid shape '+key+'.');}if(shape.sectionMode!==undefined&&!['fixed','transported'].includes(shape.sectionMode))throw Error('Invalid sweep section mode.');if(shape.sectionRoll!==undefined&&(typeof shape.sectionRoll!=='number'||!Number.isFinite(shape.sectionRoll)||shape.sectionRoll< -360||shape.sectionRoll>360))throw Error('Invalid sweep section roll.');if(shape.depthRatio!==undefined&&(typeof shape.depthRatio!=='number'||!Number.isFinite(shape.depthRatio)||shape.depthRatio<.25||shape.depthRatio>1))throw Error('Invalid sweep section depth.');if(shape.closed!==undefined&&(typeof shape.closed!=='boolean'||(shape.closed&&shape.kind!=='sweep')))throw Error('Invalid sweep closure.');if((shape.kind==='sweep'||shape.path!==undefined)&&!isValidSweepPath(shape.path,shape.closed??false))throw Error('Invalid sweep path.');if(shape.kind==='torus'&&(shape.roundness<.05||shape.roundness>.45))throw Error('Invalid torus tube ratio.');}}
 if(m.lattice!==undefined){const lattice=m.lattice;if(!lattice||typeof lattice!=='object'||Array.isArray(lattice)||typeof lattice.enabled!=='boolean'||!['gyroid','diamond','honeycomb','octet'].includes(lattice.kind)||!['x','y','z'].includes(lattice.axis))throw Error('Invalid lattice settings.');for(const [key,range]of Object.entries(LATTICE_LIMITS)){const value=lattice[key as keyof typeof LATTICE_LIMITS];if(typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])throw Error('Invalid lattice '+key+'.');}if(lattice.region!==undefined){const region=lattice.region;if(!region||typeof region.id!=='string'||!region.id.length||region.id.length>100||ids.has(region.id)||typeof region.name!=='string'||region.name.length>100||typeof region.enabled!=='boolean'||!['sphere','box','capsule','cylinder','torus','sweep'].includes(region.kind)||!['union','subtract','intersect'].includes(region.operation))throw Error('Invalid lattice region.');ids.add(region.id);for(const [key,range]of Object.entries(SHAPE_LIMITS)){const value=region[key as keyof typeof SHAPE_LIMITS];if(typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])throw Error('Invalid lattice region '+key+'.');}if(region.sectionMode!==undefined&&!['fixed','transported'].includes(region.sectionMode))throw Error('Invalid lattice region sweep section mode.');if(region.sectionRoll!==undefined&&(typeof region.sectionRoll!=='number'||!Number.isFinite(region.sectionRoll)||region.sectionRoll< -360||region.sectionRoll>360))throw Error('Invalid lattice region sweep section roll.');if(region.depthRatio!==undefined&&(typeof region.depthRatio!=='number'||!Number.isFinite(region.depthRatio)||region.depthRatio<.25||region.depthRatio>1))throw Error('Invalid lattice region sweep section depth.');if(region.closed!==undefined&&(typeof region.closed!=='boolean'||(region.closed&&region.kind!=='sweep')))throw Error('Invalid lattice region sweep closure.');if((region.kind==='sweep'||region.path!==undefined)&&!isValidSweepPath(region.path,region.closed??false))throw Error('Invalid lattice region sweep path.');if(region.kind==='torus'&&(region.roundness<.05||region.roundness>.45))throw Error('Invalid lattice region torus tube ratio.');}}
 if(m.assets!==undefined){if(!Array.isArray(m.assets)||m.assets.length>80)throw Error('Invalid asset list.');for(const a of m.assets){if(!a||typeof a.id!=='string'||!a.id.length||a.id.length>100||ids.has(a.id)||typeof a.sourceId!=='string'||!assetCatalog.some(source=>source.id===a.sourceId)||typeof a.name!=='string'||a.name.length>100||typeof a.visible!=='boolean')throw Error('Invalid asset.');ids.add(a.id);for(const k of ['x','y','z','rx','ry','rz','scale'] as const){if(!Number.isFinite(a[k])||Math.abs(a[k])>(k==='scale'?10:1000)||(k==='scale'&&a[k]<.05))throw Error('Invalid asset transform.');}componentEnvelopeDimensions(a);}}
 validateComponentClearances(m);const resolved=resolveComponentClearances(m);validateAttachments(resolved);return cloneModel(resolveAttachments(resolved));
}
/** A lower bound on field scale outside the primitive, used only for safe
 * offset padding. Independent extrusion lengths do not distort a distance
 * field: a long circular cylinder/capsule still needs just 1 mm per mm. */
function shapeFieldAspect(s:FormShape){
 const hx=s.width/2,hy=s.height/2,hz=s.depth/2;
 if(s.kind==='sweep')return 1/(s.depthRatio??1);
 if(s.kind==='box')return 1;
 if(s.kind==='cylinder')return Math.max(hx,hz)/Math.min(hx,hz);
 if(s.kind==='capsule'){const cap=Math.min(s.roundness>0?s.roundness:Math.min(hx,hy,hz),hx,hy,hz);return Math.max(hx,cap,hz)/Math.min(hx,cap,hz);}
 if(s.kind==='torus'){const tube=Math.min(hx,hz)*s.roundness;return Math.max(hx,hz)/Math.min(hx,hz)*Math.max(tube,hy)/Math.min(tube,hy);}
 return Math.max(hx,hy,hz)/Math.min(hx,hy,hz);
}
/** Conservative modelling bounds, before/after the explicit ripple deformation. */
export function modelBounds(m:FormModel,includeRipples=true):number[]{
 const bounds=m.baseEnabled===false?[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]:[-m.width/2,-m.height/2,-m.depth/2,m.width/2,m.height/2,m.depth/2];let blend=0,aspect=1,hasMass=m.baseEnabled!==false;
 for(const s of m.shapes??[]){if(!s.enabled||s.operation!=='union')continue;const b=shapeBounds(s);for(let a=0;a<3;a++){bounds[a]=Math.min(bounds[a],b[a]);bounds[a+3]=Math.max(bounds[a+3],b[a+3]);}if(hasMass)blend+=s.blend/4;hasMass=true;aspect=Math.max(aspect,shapeFieldAspect(s));}
 if(m.lenses){for(const cx of lensCenters(m)){bounds[0]=Math.min(bounds[0],cx-m.lensRadius-1);bounds[3]=Math.max(bounds[3],cx+m.lensRadius+1);}bounds[1]=Math.min(bounds[1],lensY(m)-m.lensRadius-1);bounds[4]=Math.max(bounds[4],lensY(m)+m.lensRadius+1);bounds[2]=Math.min(bounds[2],m.depth/2-7);bounds[5]=Math.max(bounds[5],m.depth/2+1);}
 if(!Number.isFinite(bounds[0]))return [-4,-4,-4,4,4,4];
 let radial=0,grip=0,twist=false,flatten=false,ripple=0;for(const f of m.influences){if(!f.enabled)continue;if((f.kind==='bulge'&&f.strength>0)||(f.kind==='pinch'&&f.strength<0))radial+=Math.abs(f.strength);if(f.kind==='grip')grip+=Math.abs(f.strength);if(f.kind==='twist'&&f.strength)twist=true;if(f.kind==='flatten'&&f.strength)flatten=true;if(f.kind==='wave')ripple+=Math.abs(f.strength);}
 const growth=(blend+radial)*aspect;for(let a=0;a<3;a++){bounds[a]-=growth;bounds[a+3]+=growth;}
 // Invert the coordinate deformations conservatively, in their application order.
 const maxX=Math.max(Math.abs(bounds[0]),Math.abs(bounds[3])),asymmetry=Math.abs(m.asymmetry)*maxX/m.width*.25;bounds[1]-=asymmetry;bounds[4]+=asymmetry;
 if(flatten){const z=1.5*Math.max(Math.abs(bounds[2]),Math.abs(bounds[5]))+56;bounds[2]=-z;bounds[5]=z;}
 if(twist){const yz=Math.hypot(Math.max(Math.abs(bounds[1]),Math.abs(bounds[4])),Math.max(Math.abs(bounds[2]),Math.abs(bounds[5])))+grip;bounds[1]=-yz;bounds[4]=yz;bounds[2]=-yz;bounds[5]=yz;}else {bounds[2]-=grip;bounds[5]+=grip;}
 bounds[0]-=grip*.12;bounds[3]+=grip*.12;
 for(let a=0;a<3;a++){const margin=4+(a===2&&includeRipples?ripple:0);bounds[a]-=margin;bounds[a+3]+=margin;}return bounds;
}
/** One deterministic mesher shared by workers, synchronous exports and the
 * cooperative preview fallback. Steps yield between bounded sample/cell groups;
 * they never change the grid, field roots, topology or output ordering. */
function* meshSteps(m:FormModel,resolution=52,refinement?:MeshRefinementOptions,samplingOptions?:MeshSamplingOptions,rootRefinementPasses=24):Generator<void,MeshData,void> {m=resolveAttachments(m);const compiledShapes=(m.shapes??[]).map(s=>s.enabled?compileShape(s):()=>Infinity),field=(x:number,y:number,z:number)=>evaluateBase(m,x,y,z,compiledShapes);const b=modelBounds(m,false),{coordinates,sampling}=createMeshSamplingGrid(m,b,resolution,samplingOptions),nx=coordinates[0].length-1,ny=coordinates[1].length-1,nz=coordinates[2].length-1;const row=nx+1,layer=row*(ny+1);const values=new Float32Array(layer*(nz+1));let sampled=0;yield;for(let k=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const v=field(coordinates[0][i],coordinates[1][j],coordinates[2][k]);values[k*layer+j*row+i]=Math.abs(v)<1e-7?1e-7:v;if(++sampled%128===0)yield}const positions:number[]=[],normals:number[]=[],indices:number[]=[];const edges=new Map<string,number>();const offsets=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];const tets=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];const ids=new Array<number>(8),pts=new Array<number[]>(8);let volume=0;let direction=[0,0,1];
function vertex(a:number,b:number){const ia=ids[a],ib=ids[b],key=ia<ib?ia+':'+ib:ib+':'+ia;const found=edges.get(key);if(found!==undefined)return found;const va=values[ia],vb=values[ib],pa=pts[a],pb=pts[b];let t=va/(va-vb),lo=0,hi=1,vlo=va,vhi=vb,x=pa[0]+(pb[0]-pa[0])*t,y=pa[1]+(pb[1]-pa[1])*t,z=pa[2]+(pb[2]-pa[2])*t;
// Refine against the actual field while remaining on the shared tetrahedron
// edge. This improves circular bores and sharp CSG seams without moving a
// vertex off its sampling edge, changing topology, or defining a new surface.
for(let refine=0;refine<rootRefinementPasses;refine++){
 const value=field(x,y,z);if(!Number.isFinite(value)||Math.abs(value)<1e-5)break;
 if((value<0)===(vlo<0)){lo=t;vlo=value}else{hi=t;vhi=value}
 // Hard CSG corners can leave regula falsi stuck against one endpoint. Use
 // periodic bisection and reject endpoint-hugging secants so the sign bracket
 // contracts even when the active surface changes within a sampling edge.
 const span=hi-lo,candidate=lo+span*vlo/(vlo-vhi);
 t=refine%2===1||candidate<=lo+span*.1||candidate>=hi-span*.1?(lo+hi)/2:candidate;
 x=pa[0]+(pb[0]-pa[0])*t;y=pa[1]+(pb[1]-pa[1])*t;z=pa[2]+(pb[2]-pa[2])*t;
}
const n=positions.length/3;positions.push(x,y,z);const e=.06,dx=field(x+e,y,z)-field(x-e,y,z),dy=field(x,y+e,z)-field(x,y-e,z),dz=field(x,y,z+e)-field(x,y,z-e),len=Math.hypot(dx,dy,dz)||1;normals.push(dx/len,dy/len,dz/len);edges.set(key,n);return n}
function triangle(a:number,b:number,c:number){const ax=positions[a*3],ay=positions[a*3+1],az=positions[a*3+2],ux=positions[b*3]-ax,uy=positions[b*3+1]-ay,uz=positions[b*3+2]-az,vx=positions[c*3]-ax,vy=positions[c*3+1]-ay,vz=positions[c*3+2]-az;const cx=uy*vz-uz*vy,cy=uz*vx-ux*vz,cz=ux*vy-uy*vx;if(cx*direction[0]+cy*direction[1]+cz*direction[2]<0){const temp=b;b=c;c=temp}indices.push(a,b,c);const b0=b*3,c0=c*3;volume+=(ax*(positions[b0+1]*positions[c0+2]-positions[b0+2]*positions[c0+1])+ay*(positions[b0+2]*positions[c0]-positions[b0]*positions[c0+2])+az*(positions[b0]*positions[c0+1]-positions[b0+1]*positions[c0]))/6}
let visited=0;for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){if(++visited%32===0)yield;let inside=0;for(let c=0;c<8;c++){const o=offsets[c];ids[c]=(k+o[2])*layer+(j+o[1])*row+i+o[0];pts[c]=[coordinates[0][i+o[0]],coordinates[1][j+o[1]],coordinates[2][k+o[2]]];if(values[ids[c]]<0)inside++}if(inside===0||inside===8)continue;for(const tet of tets){const inn=tet.filter(c=>values[ids[c]]<0),out=tet.filter(c=>values[ids[c]]>=0);if(!inn.length||!out.length)continue;direction=[0,1,2].map(axis=>out.reduce((sum,c)=>sum+pts[c][axis],0)/out.length-inn.reduce((sum,c)=>sum+pts[c][axis],0)/inn.length);if(inn.length===1)triangle(vertex(inn[0],out[0]),vertex(inn[0],out[1]),vertex(inn[0],out[2]));else if(inn.length===3)triangle(vertex(out[0],inn[0]),vertex(out[0],inn[1]),vertex(out[0],inn[2]));else if(inn.length===2){const a=vertex(inn[0],out[0]),b=vertex(inn[0],out[1]),c=vertex(inn[1],out[0]),d=vertex(inn[1],out[1]);triangle(a,b,c);triangle(b,d,c)}}}// Apply the same explicit deformation used by the GPU, including its normal Jacobian.
if(m.influences.some(f=>f.kind==='wave'&&f.enabled)){
 for(let i=0;i<positions.length;i+=3){if(i%384===0)yield;const x=positions[i],y=positions[i+1],z=positions[i+2],e=.04,d=rippleOffset(m,x,y,z),dx=(rippleOffset(m,x+e,y,z)-rippleOffset(m,x-e,y,z))/(2*e),dy=(rippleOffset(m,x,y+e,z)-rippleOffset(m,x,y-e,z))/(2*e),dz=(rippleOffset(m,x,y,z+e)-rippleOffset(m,x,y,z-e))/(2*e);positions[i+2]+=d;const nx=normals[i]*(1+dz)-normals[i+2]*dx,ny=normals[i+1]*(1+dz)-normals[i+2]*dy,nz=normals[i+2],len=Math.hypot(nx,ny,nz)||1;normals[i]=nx/len;normals[i+1]=ny/len;normals[i+2]=nz/len;}
 volume=0;for(let i=0;i<indices.length;i+=3){if(i%3072===0)yield;const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;volume+=(positions[a]*(positions[b+1]*positions[c+2]-positions[b+2]*positions[c+1])+positions[a+1]*(positions[b+2]*positions[c]-positions[b]*positions[c+2])+positions[a+2]*(positions[b]*positions[c+1]-positions[b+1]*positions[c]))/6;}
}
const bounds=positions.length?[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]:[0,0,0,0,0,0];for(let i=0;i<positions.length;i+=3){if(i%3072===0)yield;for(let a=0;a<3;a++){bounds[a]=Math.min(bounds[a],positions[i+a]);bounds[a+3]=Math.max(bounds[a+3],positions[i+a])}}const mesh={positions:new Float32Array(positions),normals:new Float32Array(normals),indices:new Uint32Array(indices),volume:Math.abs(volume),bounds,sampling};
// Typed output owns its buffers. Release the much larger JS builder arrays and
// edge-key map before refinement or a retry can allocate another whole mesh.
positions.length=0;normals.length=0;indices.length=0;edges.clear();
// Tiny feature cells can put distinct roots on the same Float32 coordinate.
// Retain complete topology through bounded grid retries; do not delete
// collapsed faces or present discarded optional alignment as successful.
if(yield* collapsedFaceSteps(mesh)){
 if(sampling.featureAligned){
  // Retain dimensional face planes where possible: move only the ordinary
  // nodes first. If that still collapses a narrow cell, make one wider-bracket
  // aligned attempt before falling back to uniform sampling. The explicit
  // offset makes the retry finite and is carried in the returned metadata.
  const retry:MeshSamplingOptions=!samplingOptions?.gridPhase?{featurePlanes:true,gridPhase:[.173,.223,.265],...(samplingOptions?.facePlaneOffset?{facePlaneOffset:samplingOptions.facePlaneOffset}:{})}:sampling.facePlaneOffset===.002?{featurePlanes:true,gridPhase:samplingOptions.gridPhase,facePlaneOffset:.02}:{featurePlanes:false};
  const fallback=yield* meshSteps(m,resolution,refinement,retry,rootRefinementPasses);
  return {...fallback,sampling:{...fallback.sampling!,quantizationLimited:true,...(!fallback.sampling!.featureAligned?{skippedReason:'quantization' as const}:{})}};
 }
 if(!samplingOptions?.gridPhase){
  // A surface can also pass almost exactly through an ordinary grid node.
  // One deterministic phase retry moves only the sampling nodes; the authored
  // field, extent endpoints and complete generated face topology remain intact.
  const fallback=yield* meshSteps(m,resolution,refinement,{featurePlanes:false,gridPhase:[.173,.223,.265]},rootRefinementPasses);
  return {...fallback,sampling:{...fallback.sampling!,quantizationLimited:true,skippedReason:'quantization'}};
 }
}
return refinement?{...refineMeshSurface(mesh,m.influences.some(f=>f.kind==='wave'&&f.enabled)?(x,y,z)=>evaluate(m,x,y,z):field,refinement),sampling}:mesh;}
/** Authoritative synchronous geometry path. Preview stepping does not lower
 * export resolution or bypass the existing quantization/refinement guards. */
export function generateMesh(m:FormModel,resolution=52,refinement?:MeshRefinementOptions,samplingOptions?:MeshSamplingOptions):MeshData {
 const steps=meshSteps(m,resolution,refinement,samplingOptions);let step=steps.next();while(!step.done)step=steps.next();return step.value;
}
/** Explicit interaction-only approximation. Export/audit callers continue to
 * use generateMesh: only the draft edge-root solve is capped at four passes. */
export function generatePreviewMesh(m:FormModel,resolution=52):MeshData {
 const steps=meshSteps(m,resolution,undefined,undefined,4);let step=steps.next();while(!step.done)step=steps.next();return step.value;
}
export type AsyncMeshOptions={
 /** Explicitly opts viewport editing into four-pass edge roots. */
 draft?:boolean;
 /** Superseded previews stop between sample/cell groups, including retries. */
 signal?:AbortSignal;
 /** Cooperative work budget; not a guaranteed wall-clock maximum per group. */
 budgetMs?:number;
 /** Injected in deterministic tests; production yields to browser task input. */
 yieldControl?:()=>Promise<void>;
 now?:()=>number;
};
const yieldMeshTask=():Promise<void>=>new Promise(resolve=>setTimeout(resolve,0));
/** Cooperative fallback for viewport previews when module workers are blocked.
 * With default options the mesh matches generateMesh byte-for-byte; explicitly
 * requesting a draft caps only edge-root iterations. Refinement is cooperative
 * too, preserving the complete authoritative algorithm and accepted patches. */
export async function generateMeshAsync(m:FormModel,resolution=52,refinement?:MeshRefinementOptions,samplingOptions?:MeshSamplingOptions,options:AsyncMeshOptions={}):Promise<MeshData> {
 const mesh=await drainSteps(meshSteps(m,resolution,undefined,samplingOptions,options.draft?4:24),options);
 if(!refinement)return mesh;
 const resolved=resolveAttachments(m),compiled=(resolved.shapes??[]).map(s=>s.enabled?compileShape(s):()=>Infinity),field=resolved.influences.some(f=>f.kind==='wave'&&f.enabled)?(x:number,y:number,z:number)=>evaluate(resolved,x,y,z):(x:number,y:number,z:number)=>evaluateBase(resolved,x,y,z,compiled);
 return {...await refineMeshSurfaceAsync(mesh,field,refinement,options),sampling:mesh.sampling};
}
function* collapsedFaceSteps(mesh:MeshData):Generator<void,boolean,void>{
 const p=mesh.positions,indices=mesh.indices;
 for(let i=0;i<indices.length;i+=3){
  if(i%1536===0)yield;const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
  const area2=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
  if(!Number.isFinite(area2)||area2<=1e-12)return true;
 }
 return false;
}
export type SectionContours={segments:number[][];width:number;height:number;minX:number;minY:number};
function* sectionSteps(m:FormModel,z:number,n=100):Generator<void,SectionContours,void>{
 if(!Number.isInteger(n)||n<4||n>512||!Number.isFinite(z))throw Error('Section sampling needs a finite plane and 4–512 cells.');
 const b=modelBounds(m),w=b[3]-b[0],h=b[4]-b[1],dx=w/n,dy=h/n,segments:number[][]=[];
 const compiled=(m.shapes??[]).map(s=>s.enabled?compileShape(s):()=>Infinity),base=(x:number,y:number,z:number)=>evaluateBase(m,x,y,z,compiled),hasWaves=m.influences.some(f=>f.kind==='wave'&&f.enabled&&f.strength!==0);
 const field=(x:number,y:number,z:number)=>{
  if(!hasWaves)return base(x,y,z);
  let q=z-rippleOffset(m,x,y,z);
  for(let i=0;i<3;i++){const delta=rippleOffset(m,x,y,q),slope=(rippleOffset(m,x,y,q+.01)-delta)/.01;q-=(q+delta-z)/(1+slope)}
  return base(x,y,q);
 };
 // Shared corners are sampled once. Float64 rows avoid quantizing field values
 // while removing four complete evaluator calls for every cell.
 let row=new Float64Array(n+1),next=new Float64Array(n+1),sampled=0;yield;
 for(let i=0;i<=n;i++){row[i]=field(b[0]+i*dx,b[1],z);if(++sampled%64===0)yield;}
 for(let j=0;j<n;j++){
  for(let i=0;i<=n;i++){next[i]=field(b[0]+i*dx,b[1]+(j+1)*dy,z);if(++sampled%64===0)yield;}
  for(let i=0;i<n;i++){
   const points=[[b[0]+i*dx,b[1]+j*dy],[b[0]+(i+1)*dx,b[1]+j*dy],[b[0]+(i+1)*dx,b[1]+(j+1)*dy],[b[0]+i*dx,b[1]+(j+1)*dy]],v=[row[i],row[i+1],next[i+1],next[i]],cuts:number[][]=[];
   for(let a=0;a<4;a++){const after=(a+1)%4;if((v[a]<0)!==(v[after]<0)){const t=v[a]/(v[a]-v[after]);cuts.push([points[a][0]+t*(points[after][0]-points[a][0]),points[a][1]+t*(points[after][1]-points[a][1])]);}}
   for(let a=0;a<cuts.length-1;a+=2)segments.push([...cuts[a],...cuts[a+1]]);
  }
  const old=row;row=next;next=old;yield;
 }
 return {segments,width:w,height:h,minX:b[0],minY:b[1]};
}
export function sectionContours(m:FormModel,z:number,n=100):SectionContours{const steps=sectionSteps(m,z,n);let step=steps.next();while(!step.done)step=steps.next();return step.value;}
/** Section sliders use the same field and contour ordering while yielding to
 * pointer input when no worker is available. Stale slices can be aborted. */
export async function sectionContoursAsync(m:FormModel,z:number,n=100,options:AsyncMeshOptions={}):Promise<SectionContours>{
 const now=options.now??(()=>performance.now()),yieldControl=options.yieldControl??yieldMeshTask,budgetMs=options.budgetMs??8;
 if(!Number.isFinite(budgetMs)||budgetMs<=0)throw Error('Section work budget must be positive and finite.');
 const check=()=>{if(options.signal?.aborted)throw new DOMException('Section preview was superseded.','AbortError');};
 check();const steps=sectionSteps(m,z,n);let started=now();
 try{for(;;){check();const step=steps.next();if(step.done){check();return step.value}if(now()-started>=budgetMs){await yieldControl();check();started=now()}}}
 finally{steps.return(undefined as unknown as SectionContours);}
}

export function silhouettePoints(m:FormModel,n=140){const b=modelBounds(m),w=b[3]-b[0],h=b[4]-b[1],d=b[5]-b[2],points:number[][]=[];for(let j=0;j<n;j++)for(let i=0;i<n;i++){const x=b[0]+(i+.5)/n*w,y=b[1]+(j+.5)/n*h;for(let k=0;k<=60;k++){if(evaluate(m,x,y,b[2]+k*d/60)<0){points.push([x,y]);break;}}}return {points,width:w,height:h,size:w/n,minX:b[0],minY:b[1]};}
function* stlSteps(data:MeshData):Generator<void,ArrayBuffer,void>{if(!data.indices.length)throw Error('This field has no solid to export.');const count=data.indices.length/3,buffer=new ArrayBuffer(84+count*50),view=new DataView(buffer);const header=new TextEncoder().encode('FORM field sketchbook | millimetres');new Uint8Array(buffer).set(header);view.setUint32(80,count,true);yield;for(let f=0;f<count;f++){if(f%512===0)yield;const o=84+f*50,ids=[data.indices[f*3],data.indices[f*3+1],data.indices[f*3+2]],p=data.positions;const a=ids[0]*3,b=ids[1]*3,c=ids[2]*3,ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];const n=[uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx],len=Math.hypot(...n)||1;for(let q=0;q<3;q++)view.setFloat32(o+q*4,n[q]/len,true);for(let v=0;v<3;v++)for(let q=0;q<3;q++)view.setFloat32(o+12+v*12+q*4,p[ids[v]*3+q],true)}return buffer}

export function binarySTL(data:MeshData):ArrayBuffer{const steps=stlSteps(data);let step=steps.next();while(!step.done)step=steps.next();return step.value;}
/** Same binary millimetre STL bytes, written in cancellable task groups. */
export function binarySTLAsync(data:MeshData,options:AsyncMeshOptions={}):Promise<ArrayBuffer>{return drainSteps(stlSteps(data),options);}
