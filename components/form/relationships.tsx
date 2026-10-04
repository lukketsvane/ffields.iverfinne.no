"use client";

import {Box,Layers,Waves,LockKeyhole,Download,Move,Hand,Expand,Shrink,Square,Rotate3D,Circle,Pill,Cylinder,Donut} from 'lucide-react';
import type {FormModel} from '@/lib/form-engine';

const fieldIcons = {wave:Waves,grip:Hand,bulge:Expand,pinch:Shrink,flatten:Square,twist:Rotate3D};
const shapeIcons = {sphere:Circle,box:Box,capsule:Pill,cylinder:Cylinder,torus:Donut};
const operationNames = {union:'Merge',subtract:'Cut',intersect:'Intersect'};

type RelationshipsProps = {
 model:FormModel;
 selected:string;
 onSelect:(id:string)=>void;
 onExport:()=>void;
};

export function Relationships({model,selected,onSelect,onExport}:RelationshipsProps){
 const shapes = model.shapes??[];
 const height = Math.max(184,(shapes.length+1)*78+24,model.influences.length*78+24);
 const middle = height/2-30;
 const resultY = middle+43;
 const wire = (x:number,y:number,toX:number,toY:number)=>`M${x},${y} C${(x+toX)/2},${y} ${(x+toX)/2},${toY} ${toX},${toY}`;
 // Route mass inputs around the field column to keep each operation visible.
 const massWire = (y:number)=>`M158,${y} L176,${y} L176,12 L374,12 L374,${resultY} L390,${resultY}`;
 const enabledForms = shapes.filter(shape=>shape.enabled).length+(model.baseEnabled!==false?1:0);

 return <div className="graph-scroller"><div className="graph-surface" style={{height}}>
  <svg className="graph-wires" width="930" height={height} aria-hidden="true">
   <path d={massWire(24+43)} style={{opacity:model.baseEnabled===false?0.25:0.8}}/>
   {shapes.map((shape,index)=><path key={shape.id} d={massWire(102+index*78+43)} style={{opacity:shape.enabled?0.8:0.25}}/>)}
   {model.influences.map((field,index)=><path key={field.id} d={wire(342,24+index*78+43,390,resultY)} style={{opacity:field.enabled?0.8:0.25}}/>)}
   <path d={wire(528,resultY,574,resultY)}/>
   <path d={wire(712,resultY,764,resultY)}/>
  </svg>
  <button className={'graph-card input '+(selected==='body'?'active ':'')+(model.baseEnabled===false?'off':'')} style={{left:20,top:24}} onClick={()=>onSelect('body')} aria-label="Select base mass">
   <span className="graph-card-title"><Box/>Mass</span>
   <span className="graph-card-value">{model.width} × {model.height} × {model.depth}{model.baseEnabled===false?' · Off':''}</span>
  </button>
  {shapes.map((shape,index)=>{const Icon=shapeIcons[shape.kind];return <button key={shape.id} className={'graph-card input '+(selected===shape.id?'active ':'')+(!shape.enabled?'off':'')} style={{left:20,top:102+index*78}} onClick={()=>onSelect(shape.id)} aria-label={'Select '+shape.name} title={`${shape.name}: ${operationNames[shape.operation]}, ${shape.blend} mm blend${shape.enabled?'':' (disabled)'}`}>
   <span className="graph-card-title"><Icon/>{shape.name}</span>
   <span className="graph-card-value">{operationNames[shape.operation]} · {shape.blend.toFixed(1)} mm blend{shape.enabled?'':' · Off'}</span>
  </button>;})}
  {model.influences.map((field,index)=>{const Icon=fieldIcons[field.kind];return <button key={field.id} className={'graph-card input '+(selected===field.id?'active ':'')+(!field.enabled?'off':'')} style={{left:204,top:24+index*78}} onClick={()=>onSelect(field.id)} aria-label={'Select '+(field.kind==='wave'?'Ripple':field.kind)}>
   <span className="graph-card-title"><Icon/>{field.kind==='wave'?'Ripple':field.kind.charAt(0).toUpperCase()+field.kind.slice(1)}</span>
   <span className="graph-card-value">{field.strength.toFixed(1)} {field.kind==='twist'?'°':'mm'} · {field.falloff==='constant'?'Global':field.radius+' mm'}{field.enabled?'':' · Off'}</span>
  </button>;})}
  <button className={'graph-card '+(selected==='regions'?'active':'')} style={{left:390,top:middle}} onClick={()=>onSelect('regions')} aria-label="Select body result">
   <span className="graph-card-title">{model.protect?<LockKeyhole/>:<Move/>}Body</span>
   <span className="graph-card-value">{model.lenses?(model.protect?'Fixed openings':'Lens openings'):shapes.length?`${enabledForms} forms · Deformed mass`:'Deformed mass'}</span>
  </button>
  <button className={'graph-card '+(selected==='enclosure'?'active':'')} style={{left:574,top:middle}} onClick={()=>onSelect('enclosure')}>
   <span className="graph-card-title"><Layers/>Enclosure</span>
   <span className="graph-card-value">{model.shell?model.wall.toFixed(1)+' mm shell':'Solid'}{model.usb?' · USB-C':''}</span>
  </button>
  <button className="graph-card output" style={{left:764,top:middle}} onClick={onExport} aria-label="Export mesh">
   <span className="graph-card-title"><Download/>Mesh</span><span className="graph-card-value">STL · mm</span>
  </button>
 </div></div>;
}
