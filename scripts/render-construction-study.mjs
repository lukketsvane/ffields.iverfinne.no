// Actual geometry from the same editable construction commands as the app.
// Run: node scripts/render-construction-study.mjs --resolution 134 --output /tmp/study
// Final refined preview: node scripts/render-construction-study.mjs --resolution 220 --refine --views front,rear
// Requires Python with numpy/Pillow and g++ (or CXX); no browser is needed.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTrussStudy,TRUSS_STUDY_COMMANDS} from '../lib/truss-study.ts';
import {createStereoCameraStudy,stereoCameraStudyCommands} from '../lib/stereo-camera-study.ts';
import {auditMesh} from '../lib/mesh-audit.ts';
import {auditExportMesh} from '../lib/component-fit.ts';
import {stereoEnvelopeCollisions} from './stereo-geometry-check.mjs';
import {generateMesh,binarySTL} from '../lib/form-engine.ts';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const argument=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];};
const resolution=Number(argument('--resolution','220'));
if(!Number.isInteger(resolution)||resolution<12||resolution>220)throw Error('Resolution must be an integer from 12 to 220.');
const study=argument('--study','truss');
if(!['truss','stereo'].includes(study))throw Error('Choose truss or stereo study.');
const name=study==='stereo'?'stereo-camera-frame':'truss-bracket';
const output=resolve(argument('--output',join(root,'public/studies')));
const width=Number(argument('--width','1152')),height=Number(argument('--height','864'));
const views=argument('--views','front').split(',');
const cameras={front:'-.55,.30,1',rear:'.50,.20,-1',orthographic:'0,0,1',side:'1,.25,.10'};
for(const view of views)if(!cameras[view])throw Error('Unknown view '+view);
await mkdir(output,{recursive:true});
const refinement=process.argv.includes('--refine')||process.argv.includes('--refined')?{tolerance:.12,maxPasses:2,maxTriangles:900000}:undefined;
const started=performance.now(),model=study==='stereo'?createStereoCameraStudy():createTrussStudy(),mesh=generateMesh(model,resolution,refinement),generationMs=performance.now()-started;
console.log(name+': '+Math.round(generationMs)+' ms, '+mesh.indices.length/3+' triangles at '+resolution+'.');
if(mesh.refinement)console.log(JSON.stringify(mesh.refinement));
const verificationStarted=performance.now(),checked=study==='stereo'?auditExportMesh(model,mesh):{audit:auditMesh(mesh)},audit=checked.audit,componentFit=checked.componentFit,componentClearance=study==='stereo'?stereoEnvelopeCollisions(mesh):undefined,verificationMs=performance.now()-verificationStarted;
const report={audit,sampling:mesh.sampling,refinement:mesh.refinement,timings:{generationMs,verificationMs},...(study==='stereo'?{componentClearance,componentFit}:{})};
const stereoFitVerified=study!=='stereo'||(componentFit?.meshVerified===true&&componentFit.components.length===2&&['stereo-camera-left','stereo-camera-right'].every(id=>{
 const result=componentFit.components.find(component=>component.assetId===id);
 return result?.status==='clear'&&result.seat.status==='clear'&&result.insertion?.status==='clear';
}));
if(process.argv.includes('--verify')&&(!report.audit.finite||!report.audit.triangles||report.audit.components!==1||report.audit.invalidIndices||report.audit.degenerateTriangles||report.audit.boundaryEdges||report.audit.nonManifoldEdges||report.audit.inconsistentWindingEdges||report.componentClearance?.triangleHardwareCollisions||!stereoFitVerified))throw Error('Construction export verification failed: '+JSON.stringify(report));
console.log(JSON.stringify(report));
const temporary=await mkdtemp(join(tmpdir(),'ffields-study-'));
const source=join(temporary,name+'.mesh.json');
const meshSource=JSON.stringify({id:study+'-study',resolution,positions:Array.from(mesh.positions),normals:Array.from(mesh.normals),indices:Array.from(mesh.indices),bounds:mesh.bounds,volume:mesh.volume,refinement:mesh.refinement,sampling:mesh.sampling});
await writeFile(source,meshSource);
try{
 const artifacts=argument('--artifacts',null);
 if(artifacts){
  const directory=resolve(artifacts);
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,name+'.form.json'),JSON.stringify({format:'FORM',version:1,model},null,2));
  await writeFile(join(directory,name+'.commands.json'),JSON.stringify(study==='stereo'?stereoCameraStudyCommands():TRUSS_STUDY_COMMANDS,null,2));
  await writeFile(join(directory,name+'.stl'),new Uint8Array(binarySTL(mesh)));
  await writeFile(join(directory,name+'.mesh.json'),meshSource);
  await writeFile(join(directory,name+'.audit.json'),JSON.stringify(report,null,2));
 }
 for(const view of views){
  const destination=join(output,view==='front'?name+'.png':name+'-'+view+'.png');
  execFileSync(process.env.PYTHON_BIN??'python3',[join(root,'scripts/render-construction-study.py'),source,destination,'--direction='+cameras[view],'--width',String(width),'--height',String(height)],{stdio:'inherit',timeout:120000});
  console.log(destination);
 }
}finally{
 await rm(temporary,{recursive:true,force:true});
}
