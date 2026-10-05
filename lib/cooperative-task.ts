export type CooperativeTaskOptions={
 signal?:AbortSignal;
 /** Work budget between bounded algorithm groups, not a guaranteed frame cap. */
 budgetMs?:number;
 yieldControl?:()=>Promise<void>;
 now?:()=>number;
};

export function throwIfAborted(signal?:AbortSignal):void{
 if(signal?.aborted)throw new DOMException('The task was cancelled.','AbortError');
}

/** Drive the same deterministic algorithm as its synchronous entry point,
 * yielding real browser tasks so Cancel and other input can be delivered. */
export async function drainSteps<T>(steps:Generator<void,T,void>,options:CooperativeTaskOptions={}):Promise<T>{
 const now=options.now??(()=>performance.now()),yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0))),budget=options.budgetMs??8;
 if(!Number.isFinite(budget)||budget<=0)throw Error('Task work budget must be positive and finite.');
 throwIfAborted(options.signal);let started=now();
 try{
  for(;;){
   throwIfAborted(options.signal);const step=steps.next();
   if(step.done){throwIfAborted(options.signal);return step.value;}
   if(now()-started>=budget){await yieldControl();throwIfAborted(options.signal);started=now();}
  }
 }finally{steps.return(undefined as unknown as T);}
}
