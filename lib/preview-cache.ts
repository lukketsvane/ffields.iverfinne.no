import type {MeshData} from './form-engine.ts';

export type CachedPreview={mesh:MeshData;ao?:Float32Array};
// A display cache only: authored fields and export geometry remain authoritative.
const VERSION='crisp-seams-2026-10-07-v1',MAX_BYTES=24*1024*1024;
let memory:{key:string;value:CachedPreview}|undefined;
let connection:Promise<IDBDatabase|undefined>|undefined;

export function previewCacheKey(geometry:string,resolution:number,tolerance=.04):string{
 return VERSION+'|'+resolution+'|'+tolerance+'|'+geometry;
}

function usable(value:CachedPreview|undefined):value is CachedPreview{
 if(!value?.mesh)return false;
 const {positions,normals,indices,bounds,volume}=value.mesh;
 if(!(positions instanceof Float32Array)||!(normals instanceof Float32Array)||!(indices instanceof Uint32Array)||positions.length%3||normals.length!==positions.length||indices.length%3||!positions.length||!indices.length)return false;
 if(positions.byteLength+normals.byteLength+indices.byteLength+(value.ao?.byteLength??0)>MAX_BYTES||!Array.isArray(bounds)||bounds.length!==6||bounds.some(n=>!Number.isFinite(n))||!Number.isFinite(volume))return false;
 if(value.ao!==undefined&&(!(value.ao instanceof Float32Array)||value.ao.length!==positions.length/3))return false;
 for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i])||!Number.isFinite(normals[i]))return false;
 for(const index of indices)if(index>=positions.length/3)return false;
 if(value.ao)for(const shade of value.ao)if(!Number.isFinite(shade))return false;
 return true;
}

function database():Promise<IDBDatabase|undefined>{
 if(typeof indexedDB==='undefined')return Promise.resolve(undefined);
 if(connection)return connection;
 connection=new Promise(resolve=>{
  let done=false;
  const finish=(db?:IDBDatabase)=>{if(done){db?.close();return}done=true;clearTimeout(timeout);resolve(db)};
  // Storage can be disabled, blocked by another tab or out of quota. None of
  // those conditions may hold up model evaluation or require a user action.
  const timeout=setTimeout(()=>finish(),1200);
  try{
   const request=indexedDB.open('form-fine-preview',1);
   request.onupgradeneeded=()=>request.result.createObjectStore('surface');
   request.onerror=()=>finish();request.onblocked=()=>finish();
   request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();connection=undefined};finish(db)};
  }catch{finish()}
 });
 return connection;
}

export async function getCachedPreview(key:string):Promise<CachedPreview|undefined>{
 if(memory?.key===key)return memory.value;
 try{
  const db=await database();if(!db)return;
  const record=await new Promise<{key:string;value:CachedPreview}|undefined>(resolve=>{
   const transaction=db.transaction('surface','readonly'),request=transaction.objectStore('surface').get('latest');
   request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(undefined);transaction.onabort=()=>resolve(undefined);
  });
  if(record?.key!==key||!usable(record.value))return;
  memory=record;return record.value;
 }catch{return}
}

export async function putCachedPreview(key:string,value:CachedPreview):Promise<void>{
 if(!usable(value))return;
 memory={key,value};
 try{
  const db=await database();if(!db||memory?.key!==key)return;
  await new Promise<void>(resolve=>{
   const transaction=db.transaction('surface','readwrite');
   // One latest fine surface bounds disk use, including all separate solids.
   transaction.objectStore('surface').put({key,value},'latest');
   transaction.oncomplete=()=>resolve();transaction.onabort=()=>resolve();transaction.onerror=()=>resolve();
  });
 }catch{/* Cache failure never changes the editing path. */}
}
