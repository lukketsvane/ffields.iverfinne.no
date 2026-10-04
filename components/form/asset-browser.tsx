"use client";

import {useState} from 'react';
import Image from 'next/image';
import {Search,Plus,Waves,Hand,Expand,Shrink,Square,Rotate3D,X,ChevronLeft,Circle,Box,Pill,Cylinder,Donut,Spline,ArrowUpRight} from 'lucide-react';
import {ASSET_CATALOG,type AssetDefinition} from '@/lib/assets';
import type {InfluenceKind} from '@/lib/form-engine';
import type {ShapeKind} from '@/lib/shapes';

const shapes = [
 {id:'sweep',name:'Sweep',detail:'Sketch a curved path · vary its thickness',icon:Spline},
 {id:'sphere',name:'Sphere',detail:'Organic volume · stretch and blend',icon:Circle},
 {id:'box',name:'Box',detail:'Rounded block · merge or carve',icon:Box},
 {id:'capsule',name:'Capsule',detail:'Soft bridge · join neighbouring forms',icon:Pill},
 {id:'cylinder',name:'Cylinder',detail:'Circular extrusion · build or cut',icon:Cylinder},
 {id:'torus',name:'Torus',detail:'Ring volume · blend loops and openings',icon:Donut},
] as const;

const fields = [
 {id:'wave',name:'Ripple',detail:'Travelling surface displacement',icon:Waves},
 {id:'grip',name:'Grip',detail:'Local contact volume',icon:Hand},
 {id:'bulge',name:'Bulge',detail:'Add local volume',icon:Expand},
 {id:'pinch',name:'Pinch',detail:'Remove local volume',icon:Shrink},
 {id:'flatten',name:'Flatten',detail:'Create a planar region',icon:Square},
 {id:'twist',name:'Twist',detail:'Rotate a local region',icon:Rotate3D},
] as const;

type AssetBrowserProps = {
 onAddAsset:(asset:AssetDefinition)=>void;
 onAddField:(kind:InfluenceKind)=>void;
 onAddShape:(kind:ShapeKind)=>void;
 onLoadStudy:()=>void;
 onClose:()=>void;
};

export function AssetBrowser({onAddAsset,onAddField,onAddShape,onLoadStudy,onClose}:AssetBrowserProps){
 const [tab,setTab] = useState<'shapes'|'fields'|'assets'>('shapes');
 const [query,setQuery] = useState('');
 const q = query.trim().toLowerCase();
 const matchingShapes = shapes.filter(shape=>(shape.name+' '+shape.detail).toLowerCase().includes(q));
 const matchingFields = fields.filter(field=>(field.name+' '+field.detail).toLowerCase().includes(q));
 const matchingAssets = ASSET_CATALOG.filter(asset=>(asset.name+' '+asset.category).toLowerCase().includes(q));
 const isEmpty = (tab==='shapes'?matchingShapes:tab==='fields'?matchingFields:matchingAssets).length===0;

 return <section className="asset-browser" aria-label="Asset library">
  <header>
   <button className="icon-button" aria-label="Back to objects" onClick={onClose}><ChevronLeft size={16}/></button>
   <span>Insert</span>
   <button className="icon-button" aria-label="Close asset library" onClick={onClose}><X size={15}/></button>
  </header>
  <div className="asset-tabs" aria-label="Insert categories">
   <button aria-pressed={tab==='shapes'} onClick={()=>setTab('shapes')}>Shapes</button>
   <button aria-pressed={tab==='fields'} onClick={()=>setTab('fields')}>Fields</button>
   <button aria-pressed={tab==='assets'} onClick={()=>setTab('assets')}>Assets</button>
  </div>
  <label className="asset-search">
   <Search size={14}/>
   <input aria-label="Search assets and fields" value={query} placeholder="Search shapes, fields, assets" onChange={event=>setQuery(event.target.value)}/>
  </label>
  <div className="asset-results">
   {tab==='shapes'&&!q&&<button className="worked-study" aria-label="Open Truss bracket worked study" onClick={onLoadStudy}>
    <div className="worked-study-preview"><Image src="/studies/truss-bracket.png" alt="" fill unoptimized sizes="68px"/></div>
    <span><small>Worked study</small><strong>Truss bracket</strong><small>Sweeps · interfaces · cuts</small></span><ArrowUpRight size={15}/>
   </button>}
   {tab==='shapes'&&matchingShapes.map(shape=><button className="field-insert-row" key={shape.id} onClick={()=>onAddShape(shape.id)} aria-label={'Add '+shape.name}>
    <shape.icon size={20}/><span><strong>{shape.name}</strong><small>{shape.detail}</small></span><Plus size={14}/>
   </button>)}
   {tab==='fields'&&matchingFields.map(field=><button className="field-insert-row" key={field.id} onClick={()=>onAddField(field.id)} aria-label={'Add '+field.name}>
    <field.icon size={18}/><span><strong>{field.name}</strong><small>{field.detail}</small></span><Plus size={14}/>
   </button>)}
   {tab==='assets'&&matchingAssets.map(asset=><button className="asset-row" key={asset.id} onClick={()=>onAddAsset(asset)} aria-label={'Insert '+asset.name}>
    {asset.thumbnail?<img src={asset.thumbnail} alt=""/>:<div className="asset-dimension">{Math.round(asset.dimensions[0])}<span>mm</span></div>}
    <span><strong>{asset.name}</strong><small>{asset.category}</small></span><Plus size={14}/>
   </button>)}
   {isEmpty&&<p className="asset-empty">No matching items</p>}
  </div>
 </section>;
}
