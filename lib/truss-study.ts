import {applyConstructionCommand,blankConstruction} from './construction.ts';
import type {ConstructionCommand} from './construction.ts';
import type {FormShape,ShapeKind,SweepPoint} from './shapes.ts';

/** One worked construction, built entirely with the public modelling actions. */
const add=(id:string,name:string,kind:ShapeKind,parameters:Partial<FormShape>):ConstructionCommand=>({action:'add',shape:{id,name,kind,x:0,y:0,z:0,rx:0,ry:0,rz:0,blend:0,...parameters}});
const path=(id:string,name:string,points:number[][],blend=4,depthRatio=.75)=>add(id,name,'sweep',{path:points.map(([x,y,z,radius])=>({x,y,z,radius})) as SweepPoint[],blend,depthRatio});
const turn=(p:number[],rx:number,ry:number,rz=0)=>{
 const [x,y,z]=p,a=rx*Math.PI/180,b=ry*Math.PI/180,c=rz*Math.PI/180;
 const cx=Math.cos(a),sx=Math.sin(a),cy=Math.cos(b),sy=Math.sin(b),cz=Math.cos(c),sz=Math.sin(c);
 return [cy*cz*x-cy*sz*y+sy*z,(cx*sz+sx*sy*cz)*x+(cx*cz-sx*sy*sz)*y-sx*cy*z,(sx*sz-cx*sy*cz)*x+(sx*cz+cx*sy*sz)*y+cx*cy*z];
};
const bAxis=[-.35,-.46,.815],bFlange=[-68-bAxis[0]*13,-60-bAxis[1]*13,42-bAxis[2]*13];
const cAxis=[.64,.74,-.20],cFlange=[92-cAxis[0]*17,70-cAxis[1]*17,-cAxis[2]*17];
const mountingHoles:ConstructionCommand[]=[];
for(const [index,[u,v]] of [[-16,-23],[16,-23],[-16,23],[16,23]].entries()){
 const p=turn([u,v,0],0,-90);
 mountingHoles.push(add('a-bolt-'+index,'Upright fixing '+(index+1),'cylinder',{x:-78+p[0],y:-15+p[1],z:-30+p[2],width:4,height:13,depth:4,rz:90,operation:'subtract'}));
}
for(const [index,[u,v]] of [[-29,-13],[29,-13],[-29,13],[29,13]].entries()){
 const p=turn([u,v,0],29.4,-20.5);
 mountingHoles.push(add('b-bolt-'+index,'Front fixing '+(index+1),'cylinder',{x:bFlange[0]+p[0],y:bFlange[1]+p[1],z:bFlange[2]+p[2],width:4,height:13,depth:4,rx:119.4,rz:20.5,operation:'subtract'}));
}

export const TRUSS_STUDY_COMMANDS:ConstructionCommand[]=[
 {action:'start',name:'Truss bracket / construction study'},
 add('a-sleeve','Upright socket','box',{x:-92,y:-15,z:-30,width:33,height:46,depth:26,roundness:3,ry:-90}),
 add('a-flange','Upright flange','box',{x:-78,y:-15,z:-30,width:43,height:58,depth:5,roundness:1.5,ry:-90,blend:2}),
 add('b-sleeve','Front socket','box',{x:-68,y:-60,z:42,width:58,height:30,depth:22,roundness:3,rx:29.4,ry:-20.5}),
 add('b-flange','Front flange','box',{x:bFlange[0],y:bFlange[1],z:bFlange[2],width:68,height:40,depth:5,roundness:1.5,rx:29.4,ry:-20.5,blend:2}),
 add('c-sleeve','Elevated round socket','cylinder',{x:92,y:70,z:0,width:44,height:30,depth:44,rx:-15.1,rz:-39.8}),
 add('c-flange','Round mounting flange','cylinder',{x:cFlange[0],y:cFlange[1],z:cFlange[2],width:56,height:5,depth:56,rx:-15.1,rz:-39.8,blend:1.5}),
 path('upper-front','Main curved spine',[[-75,6,-13,8],[-43,8,-8,6.5],[-8,19,5,7.5],[33,31,15,10],[48,43,18,8],[69,67,20,7]],5,.55),
 path('upper-rear','Rear upper rail',[[-75,9,-47,5.6],[-47,7,-37,4.2],[-10,10,-28,4],[30,29,-22,4.8],[45,40,-21,5.5],[65,62,-11,7]],3),
 path('lower-front','Front perimeter',[[-38,-55,39,7],[-23,-53,41,6],[8,-46,42,5.8],[40,-17,36,6.5],[64,15,29,7],[82,34,25,7],[92,47,20,7]],4),
 path('lower-rear','Rear perimeter',[[-75,-38,-42,6],[-48,-48,-30,4.7],[-5,-38,-22,5],[35,-15,-14,5.5],[65,21,-11,6.5],[81,33,-12,6.5],[92,42,-11,7]],3),
 path('left-bridge','Socket bridge',[[-75,-38,-38,7],[-88,-50,-14,5.5],[-92,-50,8,6],[-87,-47,21,7]],5),
 path('front-rib-1','First tapered branch',[[-23,-53,41,6],[-22,-34,25,4.5],[-14,-10,11,4.5],[-8,19,5,7.5]],6),
 path('front-rib-2','Central tapered branch',[[8,-46,42,5.7],[0,-24,31,4.2],[-6,0,18,4.3],[-8,19,5,6.8]],6),
 path('front-rib-3','Upper tapered branch',[[40,-17,36,6.2],[36,1,28,4.3],[33,18,21,4.8],[33,31,15,7]],6),
 path('rear-rib-1','Rear diagonal branch',[[-48,-48,-30,5],[-37,-25,-29,3.8],[-25,-2,-28,4],[-10,10,-28,5]],4),
 path('rear-rib-2','Rear rising branch',[[35,-15,-14,5.5],[34,6,-18,4.2],[38,24,-20,4.5],[45,40,-21,6]],4),
 add('a-bore','Upright through-opening','box',{x:-92,y:-15,z:-30,width:26,height:38,depth:62,roundness:2,ry:-90,operation:'subtract'}),
 add('b-bore','Front through-opening','box',{x:-68,y:-60,z:42,width:49,height:22,depth:60,roundness:2,rx:29.4,ry:-20.5,operation:'subtract'}),
 add('c-bore','Round through-opening','cylinder',{x:92,y:70,z:0,width:32,height:64,depth:32,rx:-15.1,rz:-39.8,operation:'subtract'}),
 ...mountingHoles,
];

export function createTrussStudy(){
 return TRUSS_STUDY_COMMANDS.reduce((model,command)=>applyConstructionCommand(model,command),blankConstruction());
}
