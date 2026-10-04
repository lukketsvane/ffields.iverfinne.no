import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
async function walk(path){const files=[];for(const entry of await readdir(path,{withFileTypes:true})){const name=path+'/'+entry.name;if(entry.isDirectory())files.push(...await walk(name));else files.push(name)}return files}
const files=await walk('out');
const assets=files.filter(p=>p.includes('/_next/static/')||((p.includes('/assets/components/')||p.includes('/templates/')||p.includes('/studies/'))&&p.endsWith('.png'))||/\/(icons\/[^/]+\.png|favicon\.svg|manifest\.webmanifest|index\.html)$/.test(p)).sort();
const hash=createHash('sha256');for(const path of [...assets,...files.filter(p=>p.endsWith('.glb'))])hash.update(await readFile(path));
const revision=hash.digest('hex').slice(0,16),urls=assets.map(p=>p==='out/index.html'?'/':p.slice(3));
const template=await readFile('scripts/sw-template.js','utf8');
await writeFile('out/sw.js',template.replace('__REVISION__',revision).replace('__ASSETS__',JSON.stringify(urls)));
console.log(`PWA: ${urls.length} local assets, ${revision}`);
