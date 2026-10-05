import {makeShape} from './shapes.ts';
import type {FormShape,ShapeKind} from './shapes.ts';
import {DEFAULT_MODEL,cloneModel,validateModel} from './form-engine.ts';
import type {FormModel} from './form-engine.ts';

/** Editable photographic form study; nominal scale, no hardware fit claim. */
export function createCameraPodStudy():FormModel {
const model=cloneModel(DEFAULT_MODEL);
Object.assign(model,{name:'Colani upright camera · reference study',baseEnabled:false,width:100,height:120,depth:35,softness:8,asymmetry:0,protect:false,lenses:false,shell:false,usb:false,buttons:false,fingerGrooves:false,influences:[],shapes:[]});
const shape=(id:string,name:string,kind:ShapeKind,parameters:Partial<FormShape>)=>{const s={...makeShape(kind),id,name,x:0,y:0,z:0,rx:0,ry:0,rz:0,blend:0,...parameters};model.shapes!.push(s);return s};
const sweep=(id:string,name:string,points:number[][],parameters:Partial<FormShape>={})=>shape(id,name,'sweep',{depthRatio:1,path:points.map(([x,y,z,radius])=>({x,y,z,radius})),...parameters});
// Millimetres are nominal; the reference photograph supplies no measured scale.
// +Y upright, +Z front. Every mass, valley and socket is individually editable.
shape('colani-core','Upright lower body','box',{x:-3,y:-14,z:0,width:61,height:96,depth:34,roundness:8});
shape('colani-upper','Upper hand-contact mass','sphere',{x:0,y:27,z:0,width:68,height:52,depth:36,rz:18,blend:7});
shape('colani-crown','Leaning domed crown','sphere',{x:15,y:46,z:-1,width:44,height:24,depth:33,rz:23,blend:7});
shape('colani-shoulder','Continuous lamp-to-body shoulder','sphere',{x:24,y:23,z:-1,width:34,height:74,depth:34,blend:5});
shape('colani-back','Gently convex rear cover','sphere',{x:-3,y:-5,z:-10,width:57,height:98,depth:22,blend:5});
// Flatten the sole of the smooth composition to make its nearly level foot.
shape('colani-foot-plane','Level standing foot','box',{x:0,y:12,z:0,width:180,height:148,depth:180,roundness:0,operation:'intersect',blend:0});
// The two broad unequal front valleys define the grip; a lower valley fades
// into the lens's shoulder instead of becoming a repeated decorative groove.
sweep('colani-upper-valley','Upper sweeping finger valley',[[-35,32,22,8],[-22,35,20.4,9.5],[-3,34,20.2,10],[15,29,21,9],[21,29,24,7]],{operation:'subtract',blend:5,depthRatio:1});
sweep('colani-middle-valley','Middle sweeping finger valley',[[-35,12,22.2,7],[-22,15,20.5,8.5],[-2,12.5,20,9.3],[16,6,21,9.5],[22,7,24,6.8]],{operation:'subtract',blend:5,depthRatio:1});
sweep('colani-lower-valley','Lower palm-to-lens saddle',[[-34,-9,23,5.2],[-22,-5,21.4,6.5],[-9,-6,21.8,7.1],[2,-12,25.5,5.5]],{operation:'subtract',blend:4,depthRatio:1});
// Lamp perimeter rises along the right shoulder and bends inward at the crown.
sweep('colani-lamp-shoulder','Bent side lamp shoulder',[[39,11,6,7],[39,27,6,7],[37,43,6,7],[25,55,6,6]],{blend:3,depthRatio:1});
// A shallow seat reads as a lamp panel in the app's single material.
sweep('colani-lamp-seat','Curved lamp panel seat',[[39,12,13,4.1],[39,27,13,4.1],[37,42,13,4.1],[26,54,13,4.1]],{operation:'subtract',blend:.3,depthRatio:.75});
shape('colani-lamp-foot','Lower lamp heel','box',{x:39,y:9,z:9,width:11.8,height:9,depth:15.8,roundness:1.4,blend:.5});
// Lens plate is a modest raised circular disc, not a projected lens barrel.
shape('colani-lens-plate','Low circular lens plate','cylinder',{x:-4,y:-37.5,z:17.7,width:42,height:5,depth:42,rx:90,blend:1.2});
shape('colani-lens-seam','Fine circular plate seam','torus',{x:-4,y:-37.5,z:20.3,width:44,height:4,depth:44,rx:90,roundness:.05,operation:'subtract',blend:.25});
shape('colani-lens-recess','Vertical lens socket','capsule',{x:-4,y:-25.5,z:20.5,width:10.4,height:18,depth:11.5,roundness:5.2,operation:'subtract',blend:.7});
shape('colani-lens-inner','Small lens aperture','cylinder',{x:-4,y:-27,z:15.6,width:7,height:12,depth:7,rx:90,operation:'subtract',blend:.3});
// Small body controls from the photograph, kept subordinate to the mass.
shape('colani-timer-stem','Connected self-timer stem','cylinder',{x:14.5,y:8.5,z:6,width:4,height:12,depth:4,rx:90,blend:.1});
shape('colani-timer','Self-timer button','sphere',{x:14.5,y:8.5,z:10.8,width:5.8,height:5.8,depth:8,blend:.1});
shape('colani-pilot','Small front indicator recess','cylinder',{x:-24,y:-2,z:15.5,width:4,height:10,depth:4,rx:90,operation:'subtract',blend:.35});
return validateModel(model);
}
