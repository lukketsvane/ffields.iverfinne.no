import {applyConstructionCommand,blankConstruction} from './construction.ts';
import type {ConstructionCommand} from './construction.ts';
import type {FormModel} from './form-engine.ts';
import type {FormShape,ShapeKind,SweepPoint} from './shapes.ts';

/** Editable hardware envelopes, not a claim that a particular camera fits. */
export type StereoCameraStudyParameters={cameraWidth:number;cameraHeight:number;cameraDepth:number;baseline:number;clearance:number;wall:number};
export const DEFAULT_STEREO_CAMERA_PARAMETERS:StereoCameraStudyParameters={cameraWidth:60,cameraHeight:43.2,cameraDepth:30,baseline:72,clearance:.5,wall:3.2};
export const STEREO_CAMERA_PARAMETER_LIMITS={cameraWidth:[20,100],cameraHeight:[15,80],cameraDepth:[10,65],baseline:[40,180],clearance:[.1,2],wall:[2,8]} as const;

export function validateStereoCameraParameters(input:Partial<StereoCameraStudyParameters>={}):StereoCameraStudyParameters{
 const parameters={...DEFAULT_STEREO_CAMERA_PARAMETERS,...input};
 for(const [key,[min,max]] of Object.entries(STEREO_CAMERA_PARAMETER_LIMITS)){
  const value=parameters[key as keyof StereoCameraStudyParameters];
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error('Invalid stereo frame '+key+'.');
 }
 const minimum=parameters.cameraWidth+2*parameters.clearance+2*parameters.wall+2;
 if(parameters.baseline<minimum)throw Error('Baseline must be at least '+minimum.toFixed(1)+' mm for separate camera shoulders.');
 return parameters;
}

const add=(id:string,name:string,kind:ShapeKind,parameters:Partial<FormShape>):ConstructionCommand=>({action:'add',shape:{id,name,kind,x:0,y:0,z:0,rx:0,ry:0,rz:0,blend:0,...parameters}});
const sweep=(id:string,name:string,points:number[][],blend:number,depthRatio:number):ConstructionCommand=>add(id,name,'sweep',{path:points.map(([x,y,z,radius])=>({x,y,z,radius})) as SweepPoint[],blend,depthRatio});

/** One restrained, connected cradle. Every authored body is a public action.
 * Front and rear remain open across the complete rectangular envelope: no
 * guessed lens center, shutter position or connector arrangement is baked in.
 * The under-seat tunnels run across X near the rear, so a routed tie avoids
 * the front optical face. The central bore is an
 * unthreaded 6.8 mm interface for a separate fixing/insert, not a tripod thread.
 */
export function stereoCameraStudyCommands(input:Partial<StereoCameraStudyParameters>={}):ConstructionCommand[]{
 const p=validateStereoCameraParameters(input),{cameraWidth:w,cameraHeight:h,cameraDepth:d,baseline,clearance:c,wall}=p;
 const half=baseline/2,a=w/2+c+wall,b=h/2+c+wall,outerDepth=d+2*c;
 const floor=-b,mountY=floor-15.7,radius=wall+1,frontZ=d/2+c-wall*.4,spring=half+w*.28;
 const commands:ConstructionCommand[]=[{action:'start',name:'Stereo camera frame'}];
 for(const [side,sign] of [['left',-1],['right',1]] as const){
  commands.push({action:'add-component',asset:{id:'stereo-camera-'+side,sourceId:'gopro-hd-hero',name:side==='left'?'Left camera / reference envelope':'Right camera / reference envelope',visible:true,x:sign*half,y:0,z:0,rx:0,ry:0,rz:0,scale:1,envelope:[w,h,d]}});
  for(const [face,z] of [['front',frontZ],['rear',-frontZ]] as const){
   const collar=sweep(face==='front'?'stereo-shoulder-'+side:'stereo-rear-shoulder-'+side,(side==='left'?'Left':'Right')+' '+face+' tapered camera collar',[
    [0,-b,z,wall*1.1],[-a*.85,-b,z,wall*1.1],[-a,-b*.75,z,wall*1.2],[-a,b*.75,z,wall*.9],[-a*.85,b,z,wall*.8],
    [a*.85,b,z,wall*.8],[a,b*.75,z,wall*.9],[a,-b*.75,z,wall*1.2],[a*.85,-b,z,wall*1.1],
   ],wall*.35,.72);
   // Sweep coordinates are local to each camera, keeping a collar editable as
   // one object while its front and rear boundaries share the same envelope.
   if(collar.action==='add'){collar.shape.x=sign*half;collar.shape.closed=true;}
   commands.push(collar);
  }
  for(const [railSign,edge] of [[-1,'left'],[1,'right']] as const){
   commands.push(sweep('stereo-depth-spine-'+side+'-'+edge,(side==='left'?'Left':'Right')+' camera '+edge+' lower depth spine',[
    [sign*half+railSign*a,-h*.34,frontZ,wall*1.03],[sign*half+railSign*(a+.7),-h*.34-1.8,0,wall*.82],[sign*half+railSign*a,-h*.34,-frontZ,wall*1.03],
   ],wall*.5,.9));
  }
  commands.push(add('stereo-retention-'+side,side==='left'?'Left under-seat retention loop':'Right under-seat retention loop','box',{x:sign*half,y:floor-2.4,width:Math.max(20,wall*4+7),height:wall+5.8,depth:outerDepth,roundness:Math.min(2,wall*.5),blend:wall*.7}));
 }
 for(const [side,z] of [['front',frontZ],['rear',-frontZ]] as const){
  commands.push(sweep('stereo-arch-'+side,side==='front'?'Front curved mounting bridge':'Rear curved mounting bridge',[
   [-spring,floor-1,z,radius],[-half*.8,floor-8,z*.98,radius*.9],[-half*.30,mountY+3.2,z*.87,radius*1.07],[0,mountY+2.8,z*.78,radius*1.18],
   [half*.30,mountY+3.2,z*.87,radius*1.07],[half*.8,floor-8,z*.98,radius*.9],[spring,floor-1,z,radius],
  ],wall*.8,.76));
 }
 commands.push(add('stereo-mount-pad','Flat central fixing pad','box',{y:mountY,width:Math.max(34,wall*6+15),height:Math.max(10,wall+6.8),depth:Math.max(26,d*.68+5.6),roundness:Math.min(2,wall*.5),blend:wall*.7}));
 // Interfaces are cut last so blends in structural branches cannot close them.
 for(const [side,sign] of [['left',-1],['right',1]] as const){
  commands.push({action:'component-clearance',assetId:'stereo-camera-'+side,shapeId:'stereo-pocket-'+side,clearance:{x:c,y:c,z:c},opening:{axis:'z',direction:-1,travel:Math.max(12,d)}});
  // A second, plain front corridor completes a true through opening. The
  // linked pocket alone remains inspectable/editable as the rear insertion.
  commands.push(add('stereo-front-access-'+side,side==='left'?'Left full front access':'Right full front access','box',{x:sign*half,z:d/2+c+8,width:w+2*c,height:h+2*c,depth:32,roundness:0,operation:'subtract'}));
  commands.push(add('stereo-top-access-'+side,side==='left'?'Left top control access':'Right top control access','box',{x:sign*half,y:h/2+c+wall,width:w*.68,height:Math.max(12,wall*3),depth:d*.72,roundness:1.2,operation:'subtract'}));
  commands.push(add('stereo-side-access-'+side,side==='left'?'Left outer connector access':'Right outer connector access','box',{x:sign*(half+w/2+c+wall*.5),y:h*.05,width:Math.max(12,wall*3),height:h*.58,depth:d*.62,roundness:1.2,operation:'subtract'}));
  commands.push(add('stereo-retention-slot-'+side,side==='left'?'Left rear retention tunnel':'Right rear retention tunnel','box',{x:sign*half,y:floor-3.1,z:-d*.22,width:Math.max(20,wall*4+7)+12,height:4,depth:6,roundness:1,operation:'subtract'}));
 }
 commands.push(add('stereo-fixing-bore','Unthreaded 6.8 mm fixing bore','cylinder',{y:mountY,width:6.8,height:40,depth:6.8,operation:'subtract'}));
 commands.push(add('stereo-fixing-recess','12 mm fixing-head recess','cylinder',{y:mountY+Math.max(10,wall+6.8)/2,width:12,height:5,depth:12,operation:'subtract'}));
 for(const arch of ['front','rear']){
  commands.push({action:'attach',sweepId:'stereo-arch-'+arch,endpoint:'start',targetShapeId:arch==='front'?'stereo-shoulder-left':'stereo-rear-shoulder-left',anchor:'y-'});
  commands.push({action:'attach',sweepId:'stereo-arch-'+arch,endpoint:'end',targetShapeId:arch==='front'?'stereo-shoulder-right':'stereo-rear-shoulder-right',anchor:'y-'});
 }
 return commands;
}

export function createStereoCameraStudy(input:Partial<StereoCameraStudyParameters>={}):FormModel{
 return stereoCameraStudyCommands(input).reduce((model,command)=>applyConstructionCommand(model,command),blankConstruction());
}

/** Infer the authored values without treating arbitrary manual geometry as a
 * promise of parametric regeneration. Callers still require an explicit rebuild.
 */
export function inferStereoCameraStudyParameters(model:FormModel):StereoCameraStudyParameters|null{
 const left=model.assets?.find(asset=>asset.id==='stereo-camera-left'),right=model.assets?.find(asset=>asset.id==='stereo-camera-right');
 const shoulder=model.shapes?.find(shape=>shape.id==='stereo-shoulder-left'),pocket=model.shapes?.find(shape=>shape.id==='stereo-pocket-left');
 if(!left?.envelope||!right?.envelope||!shoulder||!pocket)return null;
 const close=(a:number,b:number)=>Math.abs(a-b)<1e-6;
 if(left.sourceId!=='gopro-hd-hero'||right.sourceId!=='gopro-hd-hero'||!left.envelope.every((value,index)=>close(value,right.envelope![index])))return null;
 if(left.x>=0||right.x<=0||!close(left.x,-right.x)||[left,right].some(asset=>!close(asset.scale,1)||[asset.y,asset.z,asset.rx,asset.ry,asset.rz].some(value=>!close(value,0))))return null;
 const leftLink=model.componentClearances?.find(link=>link.assetId===left.id&&link.shapeId==='stereo-pocket-left'),rightLink=model.componentClearances?.find(link=>link.assetId===right.id&&link.shapeId==='stereo-pocket-right');
 if(!leftLink||!rightLink)return null;
 const perSide=leftLink.clearance.x;
 if([leftLink,rightLink].some(link=>Object.values(link.clearance).some(value=>!close(value,perSide))))return null;
 if(shoulder.kind!=='sweep'||!shoulder.path?.length)return null;
 const [cameraWidth,cameraHeight,cameraDepth]=left.envelope,rounded=(value:number)=>Math.round(value*1e6)/1e6,clearance=rounded((pocket.width-cameraWidth)/2),wall=rounded(shoulder.path[0].radius/1.1);
 try{return validateStereoCameraParameters({cameraWidth,cameraHeight,cameraDepth,baseline:Math.abs(right.x-left.x),clearance,wall});}catch{return null;}
}
