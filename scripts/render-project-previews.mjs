// Gallery images use the same editable geometry as the workspace.
// Run: node scripts/render-project-previews.mjs
// Requires Python 3 with numpy and Pillow; no browser or server is needed.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROJECT_TEMPLATES} from '../lib/project-templates.ts';
import {generateMesh} from '../lib/form-engine.ts';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const temporary=await mkdtemp(join(tmpdir(),'ffields-previews-'));
const output=join(root,'public/templates');
await mkdir(output,{recursive:true});
try{
 for(const template of PROJECT_TEMPLATES){
  const started=performance.now(),mesh=generateMesh(template.model,164);
  const source=join(temporary,template.id+'.json');
  await writeFile(source,JSON.stringify({id:template.id,positions:Array.from(mesh.positions),normals:Array.from(mesh.normals),indices:Array.from(mesh.indices)}));
  execFileSync(process.env.PYTHON_BIN??'python',[join(root,'scripts/render-project-preview.py'),source,join(output,template.id+'.png')],{stdio:'inherit',timeout:120000});
  console.log(template.id+': '+Math.round(performance.now()-started)+' ms, '+mesh.indices.length/3+' triangles');
 }
}finally{
 await rm(temporary,{recursive:true,force:true});
}
