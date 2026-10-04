import * as THREE from 'three';
import {FormModel,lensCenters,lensY,shutterPosition,portPosition} from '@/lib/form-engine';

function ring(outer:number,inner:number,back:number,front:number,material:THREE.Material){
 const bevel=Math.min(.3,(outer-inner)/3);
 const profile=[[inner,back],[outer-bevel,back],[outer,back+bevel],[outer,front-bevel],[outer-bevel,front],[inner+bevel,front],[inner,front-bevel],[inner,back]].map(([x,y])=>new THREE.Vector2(x,y));
 const mesh=new THREE.Mesh(new THREE.LatheGeometry(profile,96),material);mesh.rotation.x=Math.PI/2;mesh.castShadow=true;return mesh;
}
function roundRect(w:number,h:number,r:number){const s=new THREE.Shape(),x=-w/2,y=-h/2;s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s}
export function cameraParts(m:FormModel){
 const group=new THREE.Group();
 const silver=new THREE.MeshStandardMaterial({color:'#bdbbb5',metalness:.82,roughness:.26});
 const black=new THREE.MeshStandardMaterial({color:'#101114',metalness:.45,roughness:.29});
 const rubber=new THREE.MeshStandardMaterial({color:'#121315',roughness:.7});
 if(m.lenses)for(const x of lensCenters(m)){
  const lens=new THREE.Group();lens.position.set(x,lensY(m),m.depth/2);group.add(lens);
  lens.add(ring(m.lensRadius+.7,m.lensRadius-1.2,-.15,2.4,silver));
  lens.add(ring(m.lensRadius-1.1,m.lensRadius-2.2,-2,2.25,black));
  lens.add(ring(m.lensRadius-2.3,m.lensRadius-2.65,-1.5,1.4,rubber));
  const glassProfile=[new THREE.Vector2(0,-.3),new THREE.Vector2(2,-.31),new THREE.Vector2(5,-.45),new THREE.Vector2(8,-.8),new THREE.Vector2(m.lensRadius-2.7,-1.2)];
  const glass=new THREE.Mesh(new THREE.LatheGeometry(glassProfile,96),new THREE.MeshPhysicalMaterial({color:'#11121b',metalness:.28,roughness:.085,clearcoat:1,clearcoatRoughness:.035,iridescence:.28,iridescenceIOR:1.35,side:THREE.DoubleSide}));glass.rotation.x=Math.PI/2;lens.add(glass);
  lens.add(ring(m.lensRadius-4.1,m.lensRadius-4.35,-1.4,-1.05,black));
  // A restrained inner optical element gives the glass depth without opaque fake highlights.
  const optic=new THREE.Mesh(new THREE.SphereGeometry(3.5,48,24),new THREE.MeshPhysicalMaterial({color:'#070c10',metalness:.25,roughness:.06,clearcoat:1,iridescence:.55}));optic.scale.z=.15;optic.position.z=-.15;lens.add(optic);
 }
 if(m.buttons){
  const p=shutterPosition(m),button=new THREE.Group();button.position.set(...p);group.add(button);
  const gasket=new THREE.Mesh(new THREE.TorusGeometry(6.25,.32,12,72),rubber);gasket.rotation.x=Math.PI/2;gasket.position.y=-.55;button.add(gasket);
  const profile=[[0,-1],[5.6,-1],[6,-.7],[6,.65],[5.7,1],[0,1]].map(([x,y])=>new THREE.Vector2(x,y));
  const cap=new THREE.Mesh(new THREE.LatheGeometry(profile,80),silver);cap.castShadow=true;button.add(cap);
 }
 if(m.usb){
  const [x,y,z]=portPosition(m),port=new THREE.Group();port.position.set(x+.65,y,z);port.rotation.y=Math.PI/2;group.add(port);
  const shape=roundRect(9.45,3.65,1.2);shape.holes.push(new THREE.Path(roundRect(8.5,2.7,.85).getPoints(12)));
  const lip=new THREE.Mesh(new THREE.ExtrudeGeometry(shape,{depth:.4,bevelEnabled:false,curveSegments:12}),silver);port.add(lip);
  const interior=new THREE.Mesh(new THREE.BoxGeometry(8.6,2.8,.35),rubber);interior.position.z=-3.5;port.add(interior);
  const tongue=new THREE.Mesh(new THREE.BoxGeometry(6.5,.6,3),black);tongue.position.z=-1.7;port.add(tongue);
 }
 // Dispose materials not used by a disabled assembly as well.
 for(const mat of [silver,black,rubber])if(!group.children.length)mat.dispose();
 return group;
}
