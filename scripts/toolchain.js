const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

function executableVersion(executable,args) {
  const result=spawnSync(executable,args,{encoding:'utf8'});
  if(result.error||result.status!==0)return '';
  return `${result.stdout||''}\n${result.stderr||''}`.trim();
}

function javaHomes() {
  const homes=[
    process.env.TTW_JAVA_HOME,
    process.env.JAVA_HOME,
    path.join(os.homedir(),'Documents','Codex','.toolchains','temurin-21','Contents','Home'),
    '/opt/homebrew/opt/openjdk@21',
    '/usr/local/opt/openjdk@21'
  ].filter(Boolean);
  const macJvms=path.join(os.homedir(),'Library','Java','JavaVirtualMachines');
  try{
    fs.readdirSync(macJvms).forEach(name=>homes.push(path.join(macJvms,name,'Contents','Home')));
  }catch(error){
    if(error.code!=='ENOENT')throw error;
  }
  return [...new Set(homes)];
}

function resolveJava21() {
  const candidates=[
    ...javaHomes().map(home=>({home,executable:path.join(home,'bin','java')})),
    {home:'',executable:'java'}
  ];
  for(const candidate of candidates){
    if(path.isAbsolute(candidate.executable)&&!fs.existsSync(candidate.executable))continue;
    const version=executableVersion(candidate.executable,['-version']);
    const major=Number(version.match(/version\s+"(\d+)/)?.[1]);
    if(major===21)return {...candidate,version:version.split('\n')[0]};
  }
  return null;
}

function resolveChromiumExecutable() {
  const requested=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if(requested&&fs.existsSync(requested))return {source:'environment',executable:requested};
  try{
    const {chromium}=require('playwright-chromium');
    const bundled=chromium.executablePath();
    if(fs.existsSync(bundled))return {source:'playwright',executable:bundled};
  }catch(error){
    if(error.code!=='MODULE_NOT_FOUND')throw error;
  }
  const systemCandidates=process.platform==='darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ] : [];
  const executable=systemCandidates.find(fs.existsSync);
  return executable?{source:'system',executable}:null;
}

module.exports={executableVersion,resolveChromiumExecutable,resolveJava21};
