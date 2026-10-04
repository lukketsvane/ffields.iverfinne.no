// Actual geometry from the same editable construction commands as the app.
// Run: node scripts/render-construction-study.mjs --resolution 134 --output /tmp/study
// Final refined preview: node scripts/render-construction-study.mjs --resolution 220 --refined --views front,rear
// Requires Python with numpy/Pillow and g++ (or CXX); no browser is needed.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTrussStudy,TRUSS_STUDY_COMMANDS} from '../lib/truss-study.ts';
import {generateMesh,binarySTL} from '../lib/form-engine.ts';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const argument=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];};
const resolution=Number(argument('--resolution','220'));
if(!Number.isInteger(resolution)||resolution<12||resolution>220)throw Error('Resolution must be an integer from 12 to 220.');
const output=resolve(argument('--output',join(root,'public/studies')));
const width=Number(argument('--width','1152')),height=Number(argument('--height','864'));
const views=argument('--views','front').split(',');
const cameras={front:'-.55,.30,1',rear:'.50,.20,-1',orthographic:'0,0,1',side:'1,.25,.10'};
for(const view of views)if(!cameras[view])throw Error('Unknown view '+view);
await mkdir(output,{recursive:true});
const refinement=process.argv.includes('--refined')?{tolerance:.12,maxPasses:2,maxTriangles:900000}:undefined;
const started=performance.now(),model=createTrussStudy(),mesh=generateMesh(model,resolution,refinement);
console.log('Truss study: '+Math.round(performance.now()-started)+' ms, '+mesh.indices.length/3+' triangles at '+resolution+'.');
if(mesh.refinement)console.log(JSON.stringify(mesh.refinement));
const temporary=await mkdtemp(join(tmpdir(),'ffields-study-'));
const source=join(temporary,'truss-bracket.mesh.json');
const meshSource=JSON.stringify({id:'truss-study',resolution,positions:Array.from(mesh.positions),normals:Array.from(mesh.normals),indices:Array.from(mesh.indices),bounds:mesh.bounds,volume:mesh.volume,refinement:mesh.refinement});
await writeFile(source,meshSource);
try{
 const artifacts=argument('--artifacts',null);
 if(artifacts){
  const directory=resolve(artifacts);
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'truss-bracket.form.json'),JSON.stringify(model,null,2));
  await writeFile(join(directory,'truss-bracket.commands.json'),JSON.stringify(TRUSS_STUDY_COMMANDS,null,2));
  await writeFile(join(directory,'truss-bracket.stl'),new Uint8Array(binarySTL(mesh)));
  await writeFile(join(directory,'truss-bracket.mesh.json'),meshSource);
 }
 for(const view of views){
  const destination=join(output,view==='front'?'truss-bracket.png':'truss-bracket-'+view+'.png');
  execFileSync(process.env.PYTHON_BIN??'python3',[join(root,'scripts/render-construction-study.py'),source,destination,'--direction='+cameras[view],'--width',String(width),'--height',String(height)],{stdio:'inherit',timeout:120000});
  console.log(destination);
 }
}finally{
 await rm(temporary,{recursive:true,force:true});
}
