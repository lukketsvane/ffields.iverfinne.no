"use client";
import {useRef,useState} from 'react';
import {Box,Circle,Cylinder,Pill,Donut,Spline,Plus,Minus,Check,Copy,Trash2,SlidersHorizontal,X,Focus,LayoutGrid,Layers} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import {LIMITS} from '@/lib/form-engine';
import type {FormModel,Influence} from '@/lib/form-engine';
import {SHAPE_LIMITS,shapeBounds} from '@/lib/shapes';
import type {FormShape,ShapeKind,ShapeOperation} from '@/lib/shapes';
import {hasQuickSolid,materialModePatch,scaleSweep,scrubKeyValue,sweepScaleLimits} from '@/lib/quick-modelling';
import type {DirectTransformMode} from '@/lib/direct-manipulation';
import type {PlacedAsset} from '@/lib/assets';
import {LATTICE_LIMITS} from '@/lib/lattice';
import type {LatticeSettings} from '@/lib/lattice';
import type {ViewMode} from './viewport';

export type QuickPanel='add'|'cut'|'edit'|'material'|'objects'|'view'|'more';
type EditGroup='size'|'position'|'rotation'|'softness';
type Control={key:string;label:string;value:number;min:number;max:number;step:number;unit:string;change:(value:number)=>void};
type Action={label:string;icon:LucideIcon;run:()=>void;disabled?:boolean};
type Props={
 panel:QuickPanel;model:FormModel;selected:string;shape?:FormShape;influence?:Influence;asset?:PlacedAsset;view:ViewMode;handles:boolean;
 transformMode?:DirectTransformMode;transformAxis?:'x'|'y'|'z';onTransformMode:(mode:DirectTransformMode,axis?:'x'|'y'|'z')=>void;
 begin:()=>void;end:()=>void;onShape:(patch:Partial<FormShape>,live?:boolean)=>void;onBase:(patch:Partial<FormModel>,live?:boolean)=>void;onInfluence:(patch:Partial<Influence>,live?:boolean)=>void;onAsset:(patch:Partial<PlacedAsset>,live?:boolean)=>void;
 onLattice:(patch:Partial<LatticeSettings>,live?:boolean)=>void;
 onInsert:(kind:ShapeKind,operation:ShapeOperation)=>void;onAdvanced:()=>void;onClose:()=>void;onLibrary:()=>void;onProjects:()=>void;onDuplicate:()=>void;onRemove:()=>void;onSelect:(id:string)=>void;onView:(view:ViewMode)=>void;onCamera:(view:'front'|'top'|'perspective')=>void;onFit:()=>void;onHandles:()=>void;
 more:Action[];
};
const SHAPES:readonly {kind:ShapeKind;label:string;icon:LucideIcon}[]=[{kind:'box',label:'Box',icon:Box},{kind:'sphere',label:'Ball',icon:Circle},{kind:'cylinder',label:'Cylinder',icon:Cylinder},{kind:'capsule',label:'Capsule',icon:Pill},{kind:'torus',label:'Ring',icon:Donut},{kind:'sweep',label:'Curve',icon:Spline}];
const AXES=['x','y','z'] as const;

export function MobileQuickWorkspace(props:Props){
 const {panel,model,shape,influence,asset,selected}=props;
 const attachedCurve=!!shape&&model.attachments?.some(link=>link.sweepId===shape.id);
 const hasSolid=hasQuickSolid(model),emptyEdit=panel==='edit'&&selected==='body'&&model.baseEnabled===false,emptyMaterial=panel==='material'&&!hasSolid,linkedCut=shape&&model.componentClearances?.find(link=>link.shapeId===shape.id),canDirect=!!(shape?.enabled&&!linkedCut&&!attachedCurve||asset?.visible||influence?.enabled);
 const [group,setGroup]=useState<EditGroup>(()=>!linkedCut&&!attachedCurve&&(shape||asset||influence)&&props.transformMode==='move'?'position':!linkedCut&&!attachedCurve&&(shape||asset)&&props.transformMode==='rotate'?'rotation':'size'),[controlKey,setControlKey]=useState(()=>props.transformMode==='rotate'?'r'+(props.transformAxis??'z'):'width');
 const title=panel==='add'||emptyEdit||emptyMaterial?'Add material':panel==='cut'?'Cut material':panel==='material'?'Material':panel==='objects'?'Objects':panel==='view'?'View':panel==='more'?'Workspace':shape?.name??asset?.name??influence?.name??'Base mass';
 const controls:Control[]=[];
 const add=(key:string,label:string,value:number,range:readonly[number,number],change:(value:number)=>void,step=.5,unit='mm')=>controls.push({key,label,value,min:range[0],max:range[1],change,step,unit});
 if(panel==='edit'){
  if(group==='rotation'){
   const object=shape??asset;
   if(object)for(const axis of AXES){const key=('r'+axis) as 'rx'|'ry'|'rz';add(key,axis.toUpperCase(),object[key],shape?SHAPE_LIMITS[key]:[-1000,1000],value=>shape?props.onShape({[key]:value},true):props.onAsset({[key]:value},true),1,'°');}
  }else if(group==='position'){
   const object=shape??asset??influence;
   if(object)for(const axis of AXES)add(axis,axis.toUpperCase(),object[axis],shape?SHAPE_LIMITS[axis]:asset?[-1000,1000]:axis==='x'?[-120,120]:axis==='y'?[-65,65]:[-70,70],value=>shape?props.onShape({[axis]:value},true):asset?props.onAsset({[axis]:value},true):props.onInfluence({[axis]:value},true));
  }else if(shape){
   if(group==='softness'){
    add('blend','Blend',shape.blend,SHAPE_LIMITS.blend,value=>props.onShape({blend:value},true));
    if(shape.kind==='box'||shape.kind==='capsule')add('roundness','Corners',shape.roundness,[shape.kind==='capsule'?.1:0,Math.min(60,shape.width/2,shape.height/2,shape.depth/2)],value=>props.onShape({roundness:value},true));
   }else if(shape.kind==='sweep'){
    const bounds=shapeBounds(shape),span=Math.max(...AXES.map((_,index)=>bounds[index+3]-bounds[index])),scale=sweepScaleLimits(shape);
    if(!attachedCurve)add('span','Span',span,[span*scale[0],span*scale[1]],value=>props.onShape(scaleSweep(shape,value/span),true));
    add('section','Section depth',(shape.depthRatio??1)*100,[25,100],value=>props.onShape({depthRatio:value/100},true),1,'%');
   }else for(const key of ['width','height','depth'] as const)add(key,key==='width'?'Width':key==='height'?'Height':'Depth',shape[key],SHAPE_LIMITS[key],value=>props.onShape({[key]:value},true));
  }else if(asset)add('scale','Scale',asset.scale,[.05,10],value=>props.onAsset({scale:value},true),.05,'×');
  else if(influence){
   add('strength',influence.kind==='twist'?'Twist':influence.kind==='wave'?'Amplitude':'Strength',influence.strength,influence.kind==='wave'?[0,22]:[-22,22],value=>props.onInfluence({strength:value},true),.1,influence.kind==='twist'?'°':'mm');
   if(influence.falloff!=='constant')add('radius','Radius',influence.radius,[12,160],value=>props.onInfluence({radius:value},true),1);
  }else if(selected==='body'&&model.baseEnabled!==false){
   if(group==='softness')add('softness','Corners',model.softness,LIMITS.softness,value=>props.onBase({softness:value},true));
   else for(const key of ['width','height','depth'] as const)add(key,key==='width'?'Width':key==='height'?'Height':'Depth',model[key],LIMITS[key],value=>props.onBase({[key]:value},true));
  }
 }
 if(panel==='material'){
  if(model.lattice?.enabled){
   const lattice=model.lattice;
   add('cellSize','Cell size',lattice.cellSize,LATTICE_LIMITS.cellSize,value=>props.onLattice({cellSize:value},true));
   add('thickness','Thickness',lattice.thickness,LATTICE_LIMITS.thickness,value=>props.onLattice({thickness:value},true),.1);
   add('reveal','Cutaway',lattice.reveal*100,[0,100],value=>props.onLattice({reveal:value/100},true),1,'%');
   add('skin','Skin',lattice.skin,LATTICE_LIMITS.skin,value=>props.onLattice({skin:value},true),.1);
  }else if(model.shell)add('wall','Wall',model.wall,LIMITS.wall,value=>props.onBase({wall:value},true),.1);
 }
 const active=controls.find(control=>control.key===controlKey)??controls[0];
 const changeGroup=(next:EditGroup)=>{props.end();setGroup(next);if(next==='rotation')setControlKey('r'+(props.transformAxis??'z'));if(next==='softness'){if(props.handles)props.onHandles();}else if(canDirect)props.onTransformMode(next==='position'||influence?'move':next==='rotation'?'rotate':'size',next==='rotation'?props.transformAxis:undefined);};
 const changeControl=(control:Control)=>{props.end();setControlKey(control.key);if(group==='rotation'&&canDirect)props.onTransformMode('rotate',control.key.slice(1) as 'x'|'y'|'z');};
 return <section className={'mobile-quick-workspace quick-'+panel} aria-label={panel==='edit'?'Quick object editor':title}>
  <div className="quick-heading"><strong>{title}</strong>{((panel==='edit'&&!emptyEdit)||(panel==='material'&&!emptyMaterial)||panel==='objects')&&<button type="button" onClick={props.onAdvanced}><SlidersHorizontal size={15}/>Advanced</button>}<button type="button" aria-label="Close quick tools" onClick={props.onClose}><X size={18}/></button></div>
  {(panel==='add'||panel==='cut'||emptyEdit||emptyMaterial)&&<>
   <div className="quick-shape-grid">{SHAPES.filter(item=>panel!=='cut'||item.kind!=='sweep').map(({kind,label,icon:Icon})=><button type="button" key={kind} disabled={(model.shapes?.length??0)>=32||(panel==='cut'&&!hasSolid)} onClick={()=>props.onInsert(kind,panel==='cut'?'subtract':'union')}><Icon size={24}/><span>{label}</span></button>)}</div>
   <div className="quick-links"><button type="button" onClick={props.onLibrary}><Layers size={17}/>Components & fields</button><button type="button" onClick={props.onProjects}><LayoutGrid size={17}/>Templates</button></div>
   <p className="quick-help">{panel==='cut'?hasSolid?'Pick a shape to remove material from the current form.':'Add a solid first, then cut its material.':'Pick a shape, then drag its handle or change its size.'}</p>
  </>}
  {panel==='material'&&!emptyMaterial&&<>
   <div className="quick-edit-tabs" role="group" aria-label="Material structure">{(['solid','hollow','cellular'] as const).map(mode=><button type="button" key={mode} aria-pressed={mode===(model.lattice?.enabled?'cellular':model.shell?'hollow':'solid')} onClick={()=>props.onBase(materialModePatch(model,mode))}>{mode.charAt(0).toUpperCase()+mode.slice(1)}</button>)}</div>
   {model.lattice?.enabled&&<div className="quick-control-tabs" role="group" aria-label="Quick lattice pattern">{(['gyroid','diamond','honeycomb','octet'] as const).map(kind=><button type="button" key={kind} aria-pressed={model.lattice?.kind===kind} onClick={()=>props.onLattice({kind})}>{kind.charAt(0).toUpperCase()+kind.slice(1)}</button>)}</div>}
   {active?<><div className="quick-control-tabs" role="group" aria-label="Material parameter">{controls.map(control=><button type="button" key={control.key} aria-pressed={active.key===control.key} onClick={()=>{props.end();setControlKey(control.key);}}>{control.label}</button>)}</div><QuickValue key={'material'+active.key} control={active} begin={props.begin} end={props.end}/></>:<p className="quick-help">Choose Hollow or Cellular to remove material from the current form.</p>}
   {model.lattice?.enabled&&<p className="quick-help">{model.lattice.region?.enabled?'Existing lattice region is preserved. ':'Pattern follows the composed form. '}Thickness is nominal; strength has not been simulated.</p>}
  </>}
  {panel==='edit'&&!emptyEdit&&<>
   <div className="quick-edit-tabs" role="group" aria-label="Quick editing mode">{(['size','position','rotation','softness'] as const).filter(mode=>mode!=='position'||!attachedCurve&&!!(shape||asset||influence)).filter(mode=>mode!=='rotation'||!attachedCurve&&!!(shape||asset)).filter(mode=>mode!=='softness'||!!shape||selected==='body').map(mode=><button type="button" key={mode} disabled={!!linkedCut} aria-pressed={group===mode} onClick={()=>changeGroup(mode)}>{mode==='size'?influence?'Field':'Size':mode==='position'?'Move':mode==='rotation'?'Rotate':'Soften'}</button>)}</div>
   {canDirect&&group!=='softness'&&props.handles&&<p className="quick-transform-cue">{influence?'Drag grip to move field.':group==='rotation'?'Drag circle to rotate around '+(props.transformAxis??'z').toUpperCase()+'.':group==='position'?'Drag grip to move in the view plane.':'Drag square to scale uniformly.'}</p>}
   {linkedCut?<div className="quick-linked-cut"><p>This cut follows its component clearance.</p><button type="button" onClick={()=>props.onSelect(linkedCut.assetId)}>Edit component clearance</button></div>:active?<>
    <div className="quick-control-tabs" role="group" aria-label="Quick parameter">{controls.map(control=><button type="button" key={control.key} aria-pressed={active.key===control.key} onClick={()=>changeControl(control)}>{control.label}</button>)}</div>
    <QuickValue key={selected+active.key} control={active} begin={props.begin} end={props.end}/>
   </>:<p className="quick-help">Open advanced controls to edit this part.</p>}
   {shape&&<div className="quick-shape-actions"><div role="group" aria-label="Quick shape operation">{(['union','subtract','intersect'] as const).map(operation=><button type="button" key={operation} disabled={!!linkedCut} aria-pressed={shape.operation===operation} onClick={()=>props.onShape({operation})}>{operation==='union'?'Add':operation==='subtract'?'Cut':'Keep'}</button>)}</div><button type="button" aria-label="Duplicate selected shape" disabled={(model.shapes?.length??0)>=32} onClick={props.onDuplicate}><Copy size={17}/></button><button type="button" aria-label="Remove selected shape" onClick={props.onRemove}><Trash2 size={17}/></button></div>}
   {attachedCurve&&<p className="quick-help">This curve is pinned to its endpoints. Change its section here; Advanced edits the path and connections.</p>}
  </>}
  {panel==='view'&&<>
   <div className="quick-view-grid">{(['solid','field','section','silhouette'] as const).map(mode=><button type="button" key={mode} aria-pressed={props.view===mode} onClick={()=>props.onView(mode)}>{mode==='solid'?'Studio':mode.charAt(0).toUpperCase()+mode.slice(1)}</button>)}</div>
   <div className="quick-view-grid">{(['front','top','perspective'] as const).map(camera=><button type="button" key={camera} onClick={()=>props.onCamera(camera)}>{camera.charAt(0).toUpperCase()+camera.slice(1)}</button>)}<button type="button" onClick={props.onFit}><Focus size={17}/>Fit</button></div>
   <p className="quick-help">One finger turns · two fingers zoom and pan · two-finger tap undoes.</p>
  </>}
  {panel==='objects'&&<div className="quick-object-list"><button type="button" aria-pressed={selected==='body'} onClick={()=>props.onSelect('body')}><Box size={18}/><span>{model.baseEnabled===false?'Construction':'Base mass'}</span></button>{model.shapes?.map(item=><button type="button" key={item.id} className={!item.enabled?'off':''} aria-pressed={selected===item.id} onClick={()=>props.onSelect(item.id)}><Box size={18}/><span>{item.name}</span><small>{item.operation==='union'?'Add':item.operation==='subtract'?'Cut':'Keep'}</small></button>)}{model.influences.map(item=><button type="button" key={item.id} className={!item.enabled?'off':''} aria-pressed={selected===item.id} onClick={()=>props.onSelect(item.id)}><SlidersHorizontal size={18}/><span>{item.name}</span></button>)}{model.assets?.map(item=><button type="button" key={item.id} aria-pressed={selected===item.id} onClick={()=>props.onSelect(item.id)}><Box size={18}/><span>{item.name}</span><small>Component</small></button>)}<button type="button" onClick={()=>props.onSelect(model.lattice?.enabled?'lattice':'enclosure')}><Layers size={18}/><span>Material details</span></button></div>}
  {panel==='more'&&<div className="quick-more-grid">{props.more.map(({label,icon:Icon,run,disabled})=><button type="button" key={label} disabled={disabled} onClick={run}><Icon size={18}/>{label}</button>)}</div>}
 </section>;
}

function QuickValue({control,begin,end}:{control:Control;begin:()=>void;end:()=>void}){
 const [draft,setDraft]=useState<string|null>(null),cancelled=useRef(false);
 const finish=()=>{const value=Number(draft);if(!cancelled.current&&draft!==null&&draft.trim()&&Number.isFinite(value))control.change(Math.min(control.max,Math.max(control.min,value)));setDraft(null);end();};
 const nudge=(direction:number)=>{begin();control.change(Math.min(control.max,Math.max(control.min,Math.round((control.value+direction*control.step)*1000)/1000)));end();};
 return <div className="quick-value">
  <div className="quick-value-line"><button type="button" aria-label={'Decrease '+control.label} disabled={control.value<=control.min} onClick={()=>nudge(-1)}><Minus size={18}/></button><label><span>{control.label}</span><input aria-label={'Quick '+control.label+' value'} inputMode="decimal" type="number" min={control.min} max={control.max} step={control.step} value={draft??String(Math.round(control.value*100)/100)} onFocus={()=>{cancelled.current=false;setDraft(String(Math.round(control.value*100)/100));begin();}} onChange={event=>setDraft(event.target.value)} onBlur={finish} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();if(event.key==='Escape'){cancelled.current=true;event.currentTarget.blur();}}}/><small>{control.unit}</small></label><button type="button" aria-label={'Increase '+control.label} disabled={control.value>=control.max} onClick={()=>nudge(1)}><Plus size={18}/></button>{draft!==null&&<button type="button" className="quick-value-done" aria-label="Finish value edit" onClick={event=>{event.currentTarget.parentElement?.querySelector('input')?.blur();}}><Check size={18}/></button>}</div>
  <input className="quick-range" aria-label={'Quick '+control.label} type="range" min={control.min} max={control.max} step="any" value={control.value} onPointerDown={begin} onChange={event=>control.change(Number(event.target.value))} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end} onKeyDown={event=>{const value=scrubKeyValue(control.value,control.min,control.max,control.step,event.key);if(value!==undefined){event.preventDefault();begin();control.change(value);}}} onKeyUp={end}/>
 </div>;
}

export function QuickDockButton({label,icon:Icon,active,onClick,disabled=false,accessibleLabel}:{label:string;icon:LucideIcon;active?:boolean;onClick:()=>void;disabled?:boolean;accessibleLabel?:string}){
 return <button type="button" className={'quick-dock-button '+(active?'active':'')} aria-label={accessibleLabel??label} aria-pressed={active} disabled={disabled} onClick={onClick}><Icon size={19}/><span>{label}</span></button>;
}
