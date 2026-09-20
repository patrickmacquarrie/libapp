const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveChromiumExecutable,resolveJava21}=require('./toolchain');

const root=path.join(__dirname,'..');
const failures=[];
const warnings=[];
const notes=[];
const fail=message=>failures.push(message);

const nodeMajor=Number(process.versions.node.split('.')[0]);
if(nodeMajor===22)notes.push(`Node ${process.versions.node}`);
else if(nodeMajor>22)warnings.push(`Node ${process.versions.node} is newer than the tested Node 22 release line.`);
else fail(`Node 22 is required; found ${process.versions.node}.`);

assert.equal(fs.readFileSync(path.join(root,'.node-version'),'utf8').trim(),'22');
assert.equal(fs.readFileSync(path.join(root,'.java-version'),'utf8').trim(),'21');

const java=resolveJava21();
if(java)notes.push(`Java 21: ${java.executable}`);
else fail('Java 21 was not found. On macOS, run `brew install openjdk@21`, then retry.');

try{
  const firebasePackage=JSON.parse(fs.readFileSync(path.join(root,'node_modules','firebase-tools','package.json'),'utf8'));
  notes.push(`Firebase CLI ${firebasePackage.version}`);
}catch(error){
  fail('Firebase CLI dependencies are missing. Run `npm ci`.');
}

const browser=resolveChromiumExecutable();
if(browser)notes.push(`Chromium smoke-test browser (${browser.source}): ${browser.executable}`);
else fail('No Chromium browser was found. Run `npx playwright install chromium` or install Google Chrome.');

notes.forEach(note=>console.log(`✓ ${note}`));
warnings.forEach(warning=>console.warn(`! ${warning}`));
failures.forEach(failure=>console.error(`✗ ${failure}`));
if(failures.length){
  console.error(`Toolchain check failed with ${failures.length} required fix${failures.length===1?'':'es'}.`);
  process.exitCode=1;
}else{
  console.log('Toolchain check passed.');
}
