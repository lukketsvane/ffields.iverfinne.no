import {spawn} from 'node:child_process';
// Accept the supervised preview arguments while retaining the real Next.js runtime.
const raw=process.argv.slice(2),args=[];
for(let i=0;i<raw.length;i++){if(raw[i]==='--strictPort')continue;args.push(raw[i]==='--host'?'--hostname':raw[i]);}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack',...args],{stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
