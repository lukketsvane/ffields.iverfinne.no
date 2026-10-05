import {cloneModel,DEFAULT_MODEL} from './form-engine.ts';
import type {FormModel} from './form-engine.ts';
import type {FormShape,ShapeKind,ShapeOperation} from './shapes.ts';
import type {LatticeSettings} from './lattice.ts';
import {createCameraPodStudy} from './camera-pod-study.ts';

export type ProjectTemplate={id:string;name:string;category:string;description:string;model:FormModel};

/** Templates are editable construction recipes, not imported meshes. */
function primitive(id:string,kind:ShapeKind,name:string,dimensions:number[],position=[0,0,0],options:Partial<FormShape>={}):FormShape {
 return {id,name,kind,enabled:true,operation:'union',blend:0,width:dimensions[0],height:dimensions[1],depth:dimensions[2],x:position[0],y:position[1],z:position[2],rx:0,ry:0,rz:0,roundness:kind==='torus'?.16:kind==='box'?3:kind==='capsule'?Math.min(...dimensions)/2:0,...options};
}
function cylinder(id:string,name:string,diameter:number,height:number,position=[0,0,0],operation:ShapeOperation='union',options:Partial<FormShape>={}) {
 return primitive(id,'cylinder',name,[diameter,height,diameter],position,{operation,...options});
}
function beam(id:string,name:string,a:number[],b:number[],diameter:number,blend=2):FormShape {
 const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length=Math.hypot(dx,dy,dz);
 return primitive(id,'capsule',name,[diameter,length+diameter,diameter],a.map((v,i)=>(v+b[i])/2),{rx:Math.atan2(dz,dy)*180/Math.PI,rz:-Math.asin(dx/length)*180/Math.PI,blend});
}
function structure(kind:LatticeSettings['kind'],cellSize:number,thickness:number,skin:number,region?:FormShape):LatticeSettings {
 return {enabled:true,kind,cellSize,thickness,gradient:0,skin,axis:'z',reveal:.85,...(region?{region}:{})};
}
function study(name:string,shapes:FormShape[],lattice?:LatticeSettings,dimensions=[160,120,86]):FormModel {
 return {...cloneModel(DEFAULT_MODEL),name,width:dimensions[0],height:dimensions[1],depth:dimensions[2],baseEnabled:false,asymmetry:0,shapes,influences:[],...(lattice?{lattice}:{})};
}

function counterflow():FormModel {
 const shapes=[primitive('cf-body','capsule','Pressure-vessel envelope',[80,142,76],[0,0,0],{roundness:30})];
 for(const side of [-1,1])for(const x of [-20,20]){
  const key=`cf-${side===1?'upper':'lower'}-${x<0?'left':'right'}`;
  shapes.push(cylinder(key+'-neck','Port neck',19,34,[x,side*74,0],'union',{blend:3}));
  shapes.push(cylinder(key+'-collar','Solid port collar',28,7,[x,side*88,0],'union',{blend:1}));
 }
 for(const side of [-1,1])for(const x of [-20,20])shapes.push(cylinder(`cf-bore-${side}-${x}`,'Open flow port',11,52,[x,side*75,0],'subtract'));
 const region=primitive('cf-core-region','capsule','Core domain',[66,112,62],[0,0,0],{roundness:25});
 return study('Counterflow',shapes,{...structure('gyroid',18,2.6,2.2,region),gradient:.38},[150,120,86]);
}

function vortex():FormModel {
 const shapes=[cylinder('vx-rim','Rotor rim',152,15),cylinder('vx-rim-bore','Open annulus',131,32,[0,0,0],'subtract'),cylinder('vx-hub','Raised hub',35,34,[0,3,0],'union',{blend:3})];
 for(let i=0;i<6;i++){
  const a=i*Math.PI/3,point=(radius:number,angle:number,y:number)=>[Math.cos(angle)*radius,y,Math.sin(angle)*radius];
  shapes.push(beam('vx-vane-'+i+'-root','Vane '+(i+1)+' · root',point(14,a,-1),point(42,a+.22,1),16,3));
  shapes.push(beam('vx-vane-'+i+'-tip','Vane '+(i+1)+' · swept tip',point(42,a+.22,1),point(70,a+.43,-1),13,3));
 }
 shapes.push(cylinder('vx-shaft','Shaft opening',16,60,[0,0,0],'subtract'));
 const region=cylinder('vx-cell-region','Cellular vane domain',128,26);
 return study('Vortex',shapes,{...structure('diamond',17,2.8,2.6,region),reveal:.95},[170,80,90]);
}

function halo():FormModel {
 const shapes=[primitive('hl-dome','sphere','Dome envelope',[136,136,126]),primitive('hl-rim','torus','Continuous rim',[136,9,126],[0,-27,0],{roundness:.07,blend:2}),primitive('hl-inner','sphere','Head clearance',[111,114,102],[0,-8,0],{operation:'subtract'}),primitive('hl-open','box','Open underside',[200,150,200],[0,-102,0],{operation:'subtract',roundness:0})];
 return study('Halo',shapes,{...structure('honeycomb',16,2.6,2.4),axis:'y',reveal:.9},[156,116,90]);
}

function strut():FormModel {
 const shapes=[primitive('st-foot','box','Two-point mounting foot',[108,17,60],[0,-60,0],{roundness:5}),primitive('st-web','box','Swept structural web',[70,108,23],[0,-4,0],{rz:-19,roundness:8,blend:6}),beam('st-rib-left','Curved load rib',[-43,-52,0],[18,46,0],18,5),beam('st-rib-right','Return load rib',[39,-52,0],[18,46,0],15,5),cylinder('st-eye','Solid upper eye',39,29,[18,45,0],'union',{rx:90,blend:4})];
 shapes.push(cylinder('st-eye-bore','Upper fastening bore',17,70,[18,45,0],'subtract',{rx:90}));
 for(const x of [-37,37])shapes.push(cylinder('st-foot-bore-'+x,'Foot fastening bore',12,40,[x,-60,0],'subtract'));
 const region=primitive('st-core-region','box','Graded web domain',[56,80,32],[0,-6,0],{rz:-19,roundness:7});
 return study('Strut',shapes,{...structure('octet',17,3.2,0,region),gradient:-.4,reveal:0},[150,120,70]);
}

function confluence():FormModel {
 const shapes=[primitive('cn-body','sphere','Central mixing chamber',[68,74,66])];
 const branches=[{a:[0,18,0],b:[0,65,0],rotation:0},{a:[-17,-12,0],b:[-66,-47,0],rotation:126},{a:[17,-12,0],b:[66,-47,0],rotation:-126}];
 branches.forEach(({a,b,rotation},i)=>{
  shapes.push(beam('cn-branch-'+i,'Branch '+(i+1),a,b,29,6));
  shapes.push(cylinder('cn-flange-'+i,'Branch '+(i+1)+' · flange',43,9,b,'union',{rz:rotation,blend:1}));
 });
 shapes.push(primitive('cn-cavity','sphere','Mixing chamber void',[47,51,45],[0,0,0],{operation:'subtract'}));
 branches.forEach(({a,b},i)=>shapes.push({...beam('cn-bore-'+i,'Branch '+(i+1)+' · passage',a,b.map((v,k)=>v+(v-a[k])*.22),17,2),operation:'subtract'}));
 const region=primitive('cn-core-region','sphere','Porous junction domain',[72,76,70]);
 return study('Confluence',shapes,{...structure('gyroid',15,2.6,2.4,region),reveal:.9},[180,120,82]);
}

function oculus():FormModel {
 const shapes=[primitive('oc-orb','sphere','Porous spherical envelope',[122,122,122]),primitive('oc-void','sphere','Hollow spherical centre',[101,101,101],[0,0,0],{operation:'subtract'}),primitive('oc-belt','torus','Equatorial band',[125,10,125],[0,0,0],{roundness:.055,blend:1})];
 for(const side of [-1,1])shapes.push(cylinder('oc-collar-'+side,'Polar collar',32,20,[0,side*58,0],'union',{blend:2}));
 shapes.push(cylinder('oc-passage','Polar opening',19,160,[0,0,0],'subtract'));
 const region=cylinder('oc-core-region','Porous shell domain',145,108);
 return study('Oculus',shapes,{...structure('diamond',20,2.8,0,region),reveal:.65},[150,120,90]);
}

function auxetic():FormModel {
 const shapes=[primitive('ax-frame','box','Rounded panel frame',[151,103,27],[0,0,0],{roundness:8}),primitive('ax-opening','box','Open cell window',[130,82,48],[0,0,0],{operation:'subtract',roundness:4}),primitive('ax-infill','box','Cellular infill domain',[135,87,20],[0,0,0],{roundness:5})];
 for(const x of [-65,65])for(const y of [-41,41])shapes.push(cylinder('ax-mount-'+x+'-'+y,'Panel mounting bore',7,52,[x,y,0],'subtract',{rx:90}));
 const region=primitive('ax-core-region','box','Honeycomb window',[132,84,25],[0,0,0],{roundness:4});
 return study('Cellular panel',shapes,{...structure('honeycomb',20,2.2,0,region),axis:'z',gradient:.35,reveal:0},[170,115,50]);
}

function spiral():FormModel {
 const shapes=[primitive('sp-body','cylinder','Circular spiral housing',[137,29,137],[0,0,0],{blend:0}),primitive('sp-chamber','cylinder','Internal chamber',[119,18,119],[0,0,0],{operation:'subtract'}),cylinder('sp-open','Open inspection face',119,32,[0,22,0],'subtract'),cylinder('sp-hub','Central inlet collar',35,51,[0,10,0],'union',{blend:2})];
 for(let i=0;i<13;i++){
  const a=i*.46,b=(i+1)*.46,point=(t:number)=>{const r=15+t*6.3;return [Math.cos(t)*r,0,Math.sin(t)*r]};
  const start=point(a),end=point(b),dx=end[0]-start[0],dz=end[2]-start[2];
  shapes.push(primitive('sp-spiral-'+i,'box','Spiral partition '+(i+1),[Math.hypot(dx,dz)+4,22,6],start.map((v,k)=>(v+end[k])/2),{ry:-Math.atan2(dz,dx)*180/Math.PI,roundness:2,blend:1}));
 }
 shapes.push(beam('sp-outlet','Tangential outlet',[40,0,-46],[80,0,-46],25,2),cylinder('sp-outlet-flange','Outlet flange',36,9,[84,0,-46],'union',{rz:90}),cylinder('sp-inlet-bore','Central inlet opening',20,80,[0,0,0],'subtract'),cylinder('sp-outlet-bore','Outlet passage',14,64,[68,0,-46],'subtract',{rz:90}));
 const region=cylinder('sp-cell-region','Cellular partition domain',110,19);
 return study('Spiral',shapes,{...structure('octet',15,2.8,1.8,region),axis:'y',reveal:0},[190,75,90]);
}

export const PROJECT_TEMPLATES:readonly ProjectTemplate[]=[
 {id:'camera-pod',name:'Colani camera',category:'Camera form',description:'An upright asymmetric body with flowing grip valleys, a low lens plate and an integrated lamp seat.',model:createCameraPodStudy()},
 {id:'counterflow',name:'Counterflow',category:'Heat exchange',description:'Four ports. Graded gyroid core. Open vessel section.',model:counterflow()},
 {id:'vortex',name:'Vortex',category:'Rotational geometry',description:'Cellular swept vanes connect a raised hub and continuous rim.',model:vortex()},
 {id:'halo',name:'Halo',category:'Cellular liner',description:'A continuous dome around a deep honeycomb liner.',model:halo()},
 {id:'strut',name:'Strut',category:'Graded structure',description:'Mounting bores and load ribs frame an open diagonal truss.',model:strut()},
 {id:'confluence',name:'Confluence',category:'Branching passages',description:'Three flanged passages meet in a porous central chamber.',model:confluence()},
 {id:'oculus',name:'Oculus',category:'Porous shell',description:'An open lattice orb with polar collars and an equatorial band.',model:oculus()},
 {id:'auxetic',name:'Cellular panel',category:'Cell architecture',description:'A framed honeycomb panel with graded cell walls.',model:auxetic()},
 {id:'spiral',name:'Spiral',category:'Flow geometry',description:'A coiled internal partition meets a tangential outlet.',model:spiral()},
];

export function createProjectTemplate(id:string):FormModel {
 const template=PROJECT_TEMPLATES.find(template=>template.id===id);
 if(!template)throw Error('Unknown project template.');
 return cloneModel(template.model);
}
