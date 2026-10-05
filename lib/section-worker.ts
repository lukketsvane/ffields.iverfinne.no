import {sectionContoursAsync,FormModel} from './form-engine';

const active=new Map<number,AbortController>();
self.onmessage=async(event:MessageEvent<{id:number;model:FormModel;resolution:number;z:number;cancel?:number}>)=>{
 const {id,model,resolution,z,cancel}=event.data;
 if(cancel!==undefined){active.get(cancel)?.abort();return}
 const controller=new AbortController();active.set(id,controller);
 try{const contours=await sectionContoursAsync(model,z,resolution,{signal:controller.signal,budgetMs:8});if(controller.signal.aborted)self.postMessage({id,aborted:true});else self.postMessage({id,contours})}
 catch(error){self.postMessage(controller.signal.aborted?{id,aborted:true}:{id,error:error instanceof Error?error.message:'Section evaluation failed'})}
 finally{if(active.get(id)===controller)active.delete(id)}
};
