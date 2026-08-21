const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {GoogleAuth}=require('google-auth-library');

const projectId=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||'lib-oauth';
const localRulesPath=path.join(__dirname,'..','firestore.rules');
if(projectId!=='lib-oauth')throw new Error(`Refusing unexpected project: ${projectId}`);

const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');

async function accessToken(){
  if(process.env.FIREBASE_ACCESS_TOKEN)return process.env.FIREBASE_ACCESS_TOKEN;
  // Firebase Rules does not accept the read-only variant. IAM still limits
  // this short-lived workload identity to its explicitly assigned roles.
  const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
  const token=await auth.getAccessToken();
  if(!token)throw new Error('No Google access token is available for the live-rules check.');
  return token;
}

async function getJson(url,token){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});
  const body=await response.text();
  if(!response.ok)throw new Error(`Firebase Rules API ${response.status}: ${body}`);
  return JSON.parse(body);
}

async function main(){
  const token=await accessToken();
  const release=await getJson(
    `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`,
    token
  );
  if(!release.rulesetName)throw new Error('The live Cloud Firestore release has no ruleset.');
  const ruleset=await getJson(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`,token);
  const liveFile=(ruleset.source?.files||[]).find(file=>file.name==='firestore.rules')||
    (ruleset.source?.files||[]).find(file=>file.name?.endsWith('/firestore.rules'));
  if(!liveFile?.content)throw new Error('The published ruleset does not contain firestore.rules.');

  const localHash=sha256(fs.readFileSync(localRulesPath));
  const liveHash=sha256(liveFile.content);
  if(localHash!==liveHash){
    throw new Error(`Published Firestore rules drift from the repository (local ${localHash}, live ${liveHash}).`);
  }
  console.log(`Published Firestore rules match ${path.basename(localRulesPath)} (${localHash}).`);
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});
