"use client";

import {useState} from 'react';
import Image from 'next/image';
import {ArrowUpRight,ChevronLeft,Search,X} from 'lucide-react';
import {PROJECT_TEMPLATES} from '@/lib/project-templates';
import type {FormModel} from '@/lib/form-engine';
import {Thumbnail} from './thumbnail';

const categories = [...new Set(PROJECT_TEMPLATES.map(template=>template.category))];

function ProjectPreview({id,model}:{id:string;model:FormModel}){
 const [fallback,setFallback] = useState(false);
 return fallback
  ? <Thumbnail model={model} appearance="dark"/>
  : <Image src={'/templates/'+id+'.png'} alt="" fill unoptimized sizes="(max-width:760px) 43vw, 170px" loading="lazy" onError={()=>setFallback(true)}/>;
}

export function ProjectBrowser({onApply,onClose}:{onApply:(id:string)=>void;onClose:()=>void}){
 const [query,setQuery] = useState('');
 const [category,setCategory] = useState('All');
 const q = query.trim().toLowerCase();
 const templates = PROJECT_TEMPLATES.filter(template=>(category==='All'||template.category===category)&&(template.name+' '+template.category+' '+template.description).toLowerCase().includes(q));

 return <section className="project-browser" aria-label="Project templates">
  <header>
   <button className="icon-button" aria-label="Back to model" onClick={onClose}><ChevronLeft size={16}/></button>
   <div><strong>Projects</strong><span>{PROJECT_TEMPLATES.length} editable studies</span></div>
   <button className="icon-button" aria-label="Close project templates" onClick={onClose}><X size={16}/></button>
  </header>
  <label className="asset-search project-search">
   <Search size={14}/>
   <input aria-label="Search project templates" value={query} placeholder="Search projects" onChange={event=>setQuery(event.target.value)}/>
  </label>
  <div className="project-categories" aria-label="Project categories">
   {['All',...categories].map(name=><button key={name} aria-pressed={category===name} onClick={()=>setCategory(name)}>{name}</button>)}
  </div>
  <div className="project-results">
   {templates.map(template=><button key={template.id} className="project-card" aria-label={'Start '+template.name+' project'} onClick={()=>onApply(template.id)}>
    <div className="project-preview"><ProjectPreview id={template.id} model={template.model}/><span>{template.category}</span><ArrowUpRight size={15}/></div>
    <div className="project-caption"><strong>{template.name}</strong><p>{template.description}</p></div>
   </button>)}
   {!templates.length&&<p className="project-empty">No matching projects</p>}
  </div>
 </section>;
}
