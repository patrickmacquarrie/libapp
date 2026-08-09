const assert=require('node:assert/strict');

const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST;
const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId=process.env.GCLOUD_PROJECT||'demo-libapp';
assert(firestoreHost&&authHost,'Run this script through the Firestore and Auth emulators.');

const stringValue=value=>({stringValue:value});
const numberValue=value=>({integerValue:String(value)});
const boolValue=value=>({booleanValue:value});
const arrayValue=values=>({arrayValue:{values}});
const mapValue=fields=>({mapValue:{fields}});
const documentUrl=path=>`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`;

async function writeDocument(path,fields,token){
  return fetch(documentUrl(path),{
    method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({fields}),
  });
}

async function expectStatus(response,status,label){
  const body=await response.text();
  assert.equal(response.status,status,`${label}: expected ${status}, received ${response.status}: ${body}`);
}

function rulesSnapshot(version,race='omit'){
  const fields={
    version:numberValue(version),RULES:mapValue({}),PH_SPAN:mapValue({}),PH_STARTW:mapValue({}),
    DATING_MULT:mapValue({}),WED_MULT:mapValue({}),REU_MULT:mapValue({}),
  };
  if(race==='number')fields.RACE_MULT={doubleValue:1.5};
  if(race==='string')fields.RACE_MULT=stringValue('legacy');
  return mapValue(fields);
}

function poolFields(uid,snapshot){
  return {
    name:stringValue('Rules test'),ownerUid:stringValue(uid),members:arrayValue([stringValue(uid)]),
    rulesSnapshot:snapshot,joinCode:stringValue('123456789012'),membershipClosed:boolValue(false),season:mapValue({}),createdAt:numberValue(Date.now()),
  };
}

async function main(){
  const signup=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'rules@example.test',password:'test-password',returnSecureToken:true}),
  });
  assert.equal(signup.status,200,await signup.text());
  const auth=await signup.json(), uid=auth.localId, token=auth.idToken;

  await expectStatus(await writeDocument('pools/v3-valid',poolFields(uid,rulesSnapshot(3,'number')),token),200,'v3 snapshot with RACE_MULT');
  await expectStatus(await writeDocument('pools/v4-valid',poolFields(uid,rulesSnapshot(4,'number')),token),200,'v4 snapshot with RACE_MULT');
  await expectStatus(await writeDocument('pools/v3-missing-race',poolFields(uid,rulesSnapshot(3)),token),403,'v3 snapshot without RACE_MULT');
  await expectStatus(await writeDocument('pools/v5-valid',poolFields(uid,rulesSnapshot(5)),token),200,'v5 snapshot without RACE_MULT');
  await expectStatus(await writeDocument('pools/v5-invalid-race',poolFields(uid,rulesSnapshot(5,'string')),token),403,'v5 snapshot with invalid optional RACE_MULT');

  const statusPath='pools/v5-valid/phaseStatus/pods';
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([]),revealed:boolValue(false),updatedAt:numberValue(Date.now())},'owner'),200,'admin phase seed');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([stringValue(uid)]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+1)},token),200,'member locks own phase');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+2)},token),403,'member cannot reopen own phase directly');

  console.log('Firestore rules emulator assertions passed.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
