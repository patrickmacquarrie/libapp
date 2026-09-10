const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {resolveJava21}=require('./toolchain');

const [, , requestedCommand,...args]=process.argv;
if(!requestedCommand){
  console.error('Usage: node scripts/run-with-java.js <command> [...args]');
  process.exit(2);
}
const java=resolveJava21();
if(!java){
  console.error('Java 21 was not found. Run `npm run doctor` for setup guidance.');
  process.exit(1);
}
let command=requestedCommand;
if(requestedCommand==='firebase'){
  command=path.join(__dirname,'..','node_modules','.bin',process.platform==='win32'?'firebase.cmd':'firebase');
}
const env={...process.env};
if(java.home)env.JAVA_HOME=java.home;
if(java.home)env.PATH=`${path.join(java.home,'bin')}${path.delimiter}${env.PATH||''}`;
const result=spawnSync(command,args,{env,stdio:'inherit'});
if(result.error){
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status==null?1:result.status);
