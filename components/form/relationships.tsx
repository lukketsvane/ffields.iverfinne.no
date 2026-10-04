"use client";
import {Box,Layers,Waves,LockKeyhole,Download,Move,Hand,Expand,Shrink,Square,Rotate3D} from 'lucide-react';
import type {FormModel} from '@/lib/form-engine';
const icons={wave:Waves,grip:Hand,bulge:Expand,pinch:Shrink,flatten:Square,twist:Rotate3D};
export function Relationships({model,selected,onSelect,onExport}:{model:FormModel;selected:string;onSelect:(id:string)=>void;onExport:()=>void}){
 const height=Math.max(184,model.influences.length*78+24),middle=height/2-30;
 const wire=(x:number,y:number,toX:number,toY:number)=>`M${x},${y} C${(x+toX)/2},${y} ${(x+toX)/2},${toY} ${toX},${toY}`;
 return <div className="graph-scroller"><div className="graph-surface" style={{height}}><svg className="graph-wires" width="960" height={height} aria-hidden="true"><path d={`M158,${middle+43} C180,${middle+43} 175,12 190,12 L357,12 C378,12 370,${middle+43} 390,${middle+43}`}/>{model.influences.map((f,i)=><path key={f.id} d={wire(342,24+i*78+43,390,middle+43)}/>)}<path d={wire(528,middle+43,574,middle+43)}/><path d={wire(712,middle+43,764,middle+43)}/></svg>
 <button className={'graph-card input '+(selected==='body'?'active':'')} style={{left:20,top:middle}} onClick={()=>onSelect('body')}><span className="graph-card-title"><Box/>Mass</span><span className="graph-card-value">{model.width} × {model.height} × {model.depth}</span></button>
 {model.influences.map((f,i)=>{const Icon=icons[f.kind];return <button key={f.id} className={'graph-card input '+(selected===f.id?'active ':'')+(!f.enabled?'off':'')} style={{left:204,top:24+i*78}} onClick={()=>onSelect(f.id)}><span className="graph-card-title"><Icon/>{f.kind.charAt(0).toUpperCase()+f.kind.slice(1)}</span><span className="graph-card-value">{f.strength.toFixed(1)} {f.kind==='twist'?'°':'mm'} · {f.falloff==='constant'?'Global':f.radius+' mm'}</span></button>})}
 <button className={'graph-card '+(selected==='regions'?'active':'')} style={{left:390,top:middle}} onClick={()=>onSelect('regions')}><span className="graph-card-title">{model.protect?<LockKeyhole/>:<Move/>}Body</span><span className="graph-card-value">{model.lenses?(model.protect?'Fixed openings':'Lens openings'):'Deformed mass'}</span></button>
 <button className={'graph-card '+(selected==='enclosure'?'active':'')} style={{left:574,top:middle}} onClick={()=>onSelect('enclosure')}><span className="graph-card-title"><Layers/>Enclosure</span><span className="graph-card-value">{model.shell?model.wall.toFixed(1)+' mm shell':'Solid'}{model.usb?' · USB-C':''}</span></button>
 <button className="graph-card output" style={{left:764,top:middle}} onClick={onExport}><span className="graph-card-title"><Download/>Mesh</span><span className="graph-card-value">STL · mm</span></button>
 </div></div>
}
