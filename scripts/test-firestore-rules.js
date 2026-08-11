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

async function readDocument(path,token){
  return fetch(documentUrl(path),{
    headers:{Authorization:`Bearer ${token}`},
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

function poolFields(uid,snapshot,members=[uid]){
  return {
    name:stringValue('Rules test'),ownerUid:stringValue(uid),members:arrayValue(members.map(stringValue)),
    rulesSnapshot:snapshot,joinCode:stringValue('123456789012'),membershipClosed:boolValue(false),season:mapValue({}),createdAt:numberValue(Date.now()),
  };
}

async function createUser(email){
  const signup=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'test-password',returnSecureToken:true}),
  });
  const auth=await signup.json();
  assert.equal(signup.status,200,JSON.stringify(auth));
  return {uid:auth.localId,token:auth.idToken};
}

function playerFields(phase,screen){
  return {phase:stringValue(phase),screen:stringValue(screen),updatedAt:numberValue(Date.now())};
}

function phasePickFields(uid,phase,{lockedAt,updatedAt=Date.now()}={}){
  const fields={uid:stringValue(uid),phase:stringValue(phase),picks:arrayValue([]),updatedAt:numberValue(updatedAt)};
  if(Number.isFinite(lockedAt))fields.lockedAt=numberValue(lockedAt);
  return fields;
}

async function main(){
  const first=await createUser('rules@example.test');
  const second=await createUser('rules-second@example.test');
  const {uid,token}=first;

  await expectStatus(await writeDocument('pools/v3-valid',poolFields(uid,rulesSnapshot(3,'number')),token),200,'v3 snapshot with RACE_MULT');
  await expectStatus(await writeDocument('pools/v4-valid',poolFields(uid,rulesSnapshot(4,'number')),token),200,'v4 snapshot with RACE_MULT');
  await expectStatus(await writeDocument('pools/v3-missing-race',poolFields(uid,rulesSnapshot(3)),token),403,'v3 snapshot without RACE_MULT');
  await expectStatus(await writeDocument('pools/v5-valid',poolFields(uid,rulesSnapshot(5)),token),200,'v5 snapshot without RACE_MULT');
  await expectStatus(await writeDocument('pools/v5-invalid-race',poolFields(uid,rulesSnapshot(5,'string')),token),403,'v5 snapshot with invalid optional RACE_MULT');

  const statusPath='pools/v5-valid/phaseStatus/pods';
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([]),revealed:boolValue(false),updatedAt:numberValue(Date.now())},'owner'),200,'admin phase seed');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([stringValue(uid)]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+1)},token),200,'member locks own phase');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+2)},token),403,'member cannot reopen own phase directly');

  const reunionPool='reunion-privacy';
  await expectStatus(
    await writeDocument(`pools/${reunionPool}`,poolFields(uid,rulesSnapshot(5),[uid,second.uid]),'owner'),
    200,
    'admin seeds two-member Reunion pool'
  );
  await expectStatus(
    await writeDocument(`pools/${reunionPool}/players/${uid}`,playerFields('reunion','watch'),token),
    200,
    'viewer may update public Reunion screen'
  );
  const targetLockedAt=Date.now()+10;
  const targetPick=phasePickFields(second.uid,'reunion',{lockedAt:targetLockedAt,updatedAt:targetLockedAt});
  const targetPath=`pools/${reunionPool}/phasePicks/reunion__${second.uid}`;
  await expectStatus(await writeDocument(targetPath,targetPick,second.token),200,'target locks Reunion picks');
  await expectStatus(
    await readDocument(targetPath,token),
    403,
    'changing only the public screen cannot reveal another Reunion pick'
  );

  const viewerLockedAt=Date.now()+20;
  const viewerPick=phasePickFields(uid,'reunion',{lockedAt:viewerLockedAt,updatedAt:viewerLockedAt});
  const viewerPath=`pools/${reunionPool}/phasePicks/reunion__${uid}`;
  await expectStatus(await writeDocument(viewerPath,viewerPick,token),200,'viewer locks own Reunion picks');
  await expectStatus(await readDocument(targetPath,token),200,'two locked Reunion players may see each other');
  await expectStatus(await writeDocument(viewerPath,viewerPick,token),200,'identical Reunion lock retry is idempotent');
  await expectStatus(
    await writeDocument(viewerPath,phasePickFields(uid,'reunion',{lockedAt:viewerLockedAt,updatedAt:viewerLockedAt+1}),token),
    403,
    'locked Reunion pick document is immutable'
  );
  await expectStatus(
    await writeDocument(`pools/${reunionPool}/phasePicks/pods__${uid}`,phasePickFields(uid,'pods',{lockedAt:Date.now()}),token),
    403,
    'non-Reunion picks cannot carry a lock marker'
  );

  console.log('Firestore rules emulator assertions passed.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
