const assert=require('node:assert/strict');

const firestoreHost=process.env.FIRESTORE_EMULATOR_HOST;
const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId=process.env.GCLOUD_PROJECT||'demo-libapp';
assert(firestoreHost&&authHost,'Run this script through the Firestore and Auth emulators.');

const stringValue=value=>({stringValue:value});
const numberValue=value=>({integerValue:String(value)});
const boolValue=value=>({booleanValue:value});
const timestampValue=value=>({timestampValue:new Date(value).toISOString()});
const arrayValue=values=>({arrayValue:{values}});
const mapValue=fields=>({mapValue:{fields}});
const documentUrl=path=>`http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`;
const databaseName=`projects/${projectId}/databases/(default)`;

async function writeDocument(path,fields,token){
  return fetch(documentUrl(path),{
    method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({fields}),
  });
}

async function writeDocumentAtServerTime(path,fields,token){
  return fetch(`http://${firestoreHost}/v1/${databaseName}/documents:commit`,{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
    body:JSON.stringify({
      writes:[{
        update:{name:`${databaseName}/documents/${path}`,fields},
        updateTransforms:[{fieldPath:'lastAt',setToServerValue:'REQUEST_TIME'}],
      }],
    }),
  });
}

async function readDocument(path,token){
  return fetch(documentUrl(path),{
    headers:token?{Authorization:`Bearer ${token}`}:{},
  });
}

async function deleteDocument(path,token){
  return fetch(documentUrl(path),{
    method:'DELETE',headers:token?{Authorization:`Bearer ${token}`}:{},
  });
}

async function runFieldQuery(collectionId,filters,token){
  const fieldFilters=filters.map(({fieldPath,op='EQUAL',value})=>({
    fieldFilter:{field:{fieldPath},op,value:stringValue(value)},
  }));
  const where=fieldFilters.length===1
    ? fieldFilters[0]
    : {compositeFilter:{op:'AND',filters:fieldFilters}};
  return fetch(`http://${firestoreHost}/v1/${databaseName}/documents:runQuery`,{
    method:'POST',
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify({structuredQuery:{from:[{collectionId}],where}}),
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

function poolFields(uid,snapshot,members=[uid],joinCode='123456789012',createdAt=Date.now()){
  return {
    name:stringValue('Rules test'),ownerUid:stringValue(uid),members:arrayValue(members.map(stringValue)),
    rulesSnapshot:snapshot,joinCode:stringValue(joinCode),membershipClosed:boolValue(false),season:mapValue({}),createdAt:numberValue(createdAt),
  };
}

async function createUnverifiedUser(email){
  const signup=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'test-password',returnSecureToken:true}),
  });
  const auth=await signup.json();
  assert.equal(signup.status,200,JSON.stringify(auth));
  return {uid:auth.localId,token:auth.idToken,email};
}

async function createUser(email){
  const requestLink=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestType:'EMAIL_SIGNIN',email,continueUrl:'http://localhost'}),
  });
  assert.equal(requestLink.status,200,await requestLink.text());
  const codesResponse=await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/oobCodes`);
  const codes=await codesResponse.json();
  const code=(codes.oobCodes||[]).find(item=>item.email===email&&item.requestType==='EMAIL_SIGNIN');
  assert(code?.oobCode,`Email-link code was not created for ${email}.`);
  const signin=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,oobCode:code.oobCode}),
  });
  const auth=await signin.json();
  assert.equal(signin.status,200,JSON.stringify(auth));
  return {uid:auth.localId,token:auth.idToken,email};
}

function playerFields(phase,screen){
  return {
    username:stringValue('Rules Player'),phase:stringValue(phase),screen:stringValue(screen),
    w:numberValue(1),watchThrough:numberValue(1),completed:mapValue({}),
  };
}

function phasePickFields(uid,phase,{lockedAt,updatedAt=Date.now()}={}){
  const fields={uid:stringValue(uid),phase:stringValue(phase),picks:arrayValue([]),updatedAt:numberValue(updatedAt)};
  if(Number.isFinite(lockedAt))fields.lockedAt=numberValue(lockedAt);
  return fields;
}

function inviteFields(poolId,ownerUid,toEmail){
  return {
    poolId:stringValue(poolId),poolName:stringValue('Invite privacy test'),seasonLabel:stringValue('Love Is Blind'),
    fromUid:stringValue(ownerUid),fromUsername:stringValue('Owner'),toEmail:stringValue(toEmail),
    status:stringValue('pending'),createdAt:numberValue(Date.now()),
  };
}

function clientErrorFields(uid,category='save_failed',overrides={}){
  return {
    uid:stringValue(uid),category:stringValue(category),code:stringValue('permission-denied'),
    appBuild:stringValue('rules-test'),entryStep:stringValue(''),operation:stringValue('save_player'),
    phase:stringValue('pods'),poolId:stringValue('pool-1'),screen:stringValue('watch'),
    seasonId:stringValue('love-is-blind-uk-3'),targetPoolId:stringValue(''),
    occurrenceCount:numberValue(1),...overrides,
  };
}

async function main(){
  const first=await createUser('rules@example.test');
  const second=await createUser('rules-second@example.test');
  const invited=await createUser('rules-invited@example.test');
  const unverified=await createUnverifiedUser('rules-unverified@example.test');
  const {uid,token}=first;

  await expectStatus(
    await writeDocument('seasons/love-is-blind-se-1',{sourceSheetId:stringValue('sheet-id'),status:stringValue('live')},'owner'),
    200,
    'admin seeds a published season'
  );
  await expectStatus(await readDocument('seasons',token),200,'signed-in user lists published seasons');
  await expectStatus(await readDocument('seasons',''),403,'signed-out visitor cannot list published seasons');

  await expectStatus(
    await writeDocument('appConfig/public',{defaultSeasonId:stringValue('love-is-blind-se-1'),globalPoolSeasonId:stringValue('love-is-blind-se-1')},'owner'),
    200,
    'admin seeds public live/default routing'
  );
  await expectStatus(await readDocument('appConfig/public',''),200,'signed-out visitor reads public live/default routing');
  await expectStatus(
    await writeDocument('appConfig/public',{defaultSeasonId:stringValue('love-is-blind-uk-3')},token),
    403,
    'browser user cannot change live/default routing'
  );

  await expectStatus(await writeDocument('pools/v3-valid',poolFields(uid,rulesSnapshot(3,'number')),token),200,'v3 snapshot with RACE_MULT');
  await expectStatus(await writeDocument('pools/v4-valid',poolFields(uid,rulesSnapshot(4,'number')),token),200,'v4 snapshot with RACE_MULT');
  await expectStatus(await writeDocument('pools/v3-missing-race',poolFields(uid,rulesSnapshot(3)),token),403,'v3 snapshot without RACE_MULT');
  const v5CreatedAt=Date.now();
  await expectStatus(await writeDocument('pools/v5-valid',poolFields(uid,rulesSnapshot(5),[uid],'123456789012',v5CreatedAt),token),200,'v5 snapshot without RACE_MULT');
  await expectStatus(await writeDocument('pools/v5-invalid-race',poolFields(uid,rulesSnapshot(5,'string')),token),403,'v5 snapshot with invalid optional RACE_MULT');
  await expectStatus(await readDocument('pools/does-not-exist',token),404,'signed-in missing pool read returns not found');
  await expectStatus(await readDocument('pools/does-not-exist',''),403,'signed-out missing pool read stays private');
  await expectStatus(
    await writeDocument('pools/season-query',{...poolFields(uid,rulesSnapshot(5)),season:mapValue({id:stringValue('love-is-blind-uk-3')})},'owner'),
    200,
    'admin seeds a season pool query fixture'
  );
  await expectStatus(
    await runFieldQuery('pools',[{fieldPath:'season.id',value:'love-is-blind-uk-3'}],'owner'),
    200,
    'trusted season automation queries pools by nested season id'
  );
  await expectStatus(
    await runFieldQuery('pools',[{fieldPath:'members',op:'ARRAY_CONTAINS',value:uid}],token),
    200,
    'signed-in user queries their pool memberships'
  );
  const globalPoolId='global__love-is-blind-se-1';
  await expectStatus(await writeDocument(`pools/${globalPoolId}`,{
    ...poolFields(uid,rulesSnapshot(5),[uid,second.uid]),global:boolValue(true),globalSeasonId:stringValue('love-is-blind-se-1'),
  },'owner'),200,'admin seeds Global Pool scoring fixture');
  await expectStatus(await writeDocument(`pools/${globalPoolId}/standings/current`,{schemaVersion:numberValue(1),rows:arrayValue([])},'owner'),200,'trusted scorer writes current standings');
  await expectStatus(await readDocument(`pools/${globalPoolId}/standings/current`,token),200,'Global Pool member reads current standings');
  await expectStatus(await readDocument(`pools/${globalPoolId}/standings/current`,invited.token),403,'non-member cannot read Global standings');
  await expectStatus(await writeDocument(`pools/${globalPoolId}/standings/current`,{schemaVersion:numberValue(1),rows:arrayValue([])},token),403,'browser member cannot forge Global standings');
  await expectStatus(await writeDocument(`pools/${globalPoolId}/trustedPlayers/${uid}`,{uid:stringValue(uid)},'owner'),200,'trusted scorer seeds validated Global input');
  await expectStatus(await readDocument(`pools/${globalPoolId}/trustedPlayers/${uid}`,token),403,'browser member cannot read trusted scoring inputs');
  await expectStatus(await writeDocument(`pools/${globalPoolId}/trustedPlayers/${uid}`,{uid:stringValue(uid)},token),403,'browser member cannot forge trusted scoring inputs');

  const profileCreatedAt=Date.now()-1000;
  await expectStatus(await writeDocument(`users/${uid}`,{username:stringValue('Original'),createdAt:numberValue(profileCreatedAt)},token),200,'user creates profile');
  await expectStatus(await writeDocument(`users/${uid}`,{username:stringValue('Renamed'),createdAt:numberValue(profileCreatedAt)},token),200,'username update preserves account creation date');
  await expectStatus(await writeDocument(`users/${uid}`,{username:stringValue('Wrong date'),createdAt:numberValue(Date.now())},token),403,'username update cannot move account creation date');

  const rotatedJoinCode='abcdefghijklmnop';
  await expectStatus(await writeDocument('pools/v5-valid',poolFields(uid,rulesSnapshot(5),[uid],rotatedJoinCode,v5CreatedAt),token),200,'owner rotates friend-pool join code');
  await expectStatus(await writeDocument('pools/v5-valid',poolFields(uid,rulesSnapshot(5),[uid],'qrstuvwxyzabcdef',v5CreatedAt),second.token),403,'non-owner cannot rotate friend-pool join code');
  await expectStatus(await deleteDocument('pools/v5-valid',token),403,'pool owner must use recursive delete callable');

  const invitePool='invite-privacy';
  const invitePath=`invites/${invitePool}__${invited.email}`;
  await expectStatus(
    await writeDocument(`pools/${invitePool}`,poolFields(uid,rulesSnapshot(5),[uid,second.uid]),'owner'),
    200,
    'admin seeds invitation privacy pool'
  );
  await expectStatus(await writeDocument(invitePath,inviteFields(invitePool,uid,invited.email),token),200,'pool owner creates invitation');
  await expectStatus(await readDocument(invitePath,token),200,'pool owner reads invitation address');
  await expectStatus(await readDocument(invitePath,second.token),403,'non-owner pool member cannot read invitation address');
  await expectStatus(await readDocument(invitePath,invited.token),200,'invitation recipient reads own invitation');
  await expectStatus(
    await runFieldQuery('invites',[{fieldPath:'toEmail',value:invited.email},{fieldPath:'status',value:'pending'}],invited.token),
    200,
    'recipient queries pending invitations by verified email and status'
  );
  await expectStatus(
    await runFieldQuery('invites',[{fieldPath:'poolId',value:invitePool},{fieldPath:'status',value:'pending'}],token),
    200,
    'pool owner queries pending invitations by pool and status'
  );
  const unverifiedInvitePath=`invites/${invitePool}__${unverified.email}`;
  await expectStatus(await writeDocument(unverifiedInvitePath,inviteFields(invitePool,uid,unverified.email),token),200,'pool owner creates invitation for unverified address');
  await expectStatus(await readDocument(unverifiedInvitePath,unverified.token),403,'unverified token email cannot claim invitation');

  const clientErrorPath=`clientErrors/${uid}/categories/save_failed`;
  await expectStatus(
    await writeDocumentAtServerTime(clientErrorPath,clientErrorFields(uid),token),
    200,
    'signed-in user creates a bounded client diagnostic'
  );
  await expectStatus(await readDocument(clientErrorPath,token),403,'browser client cannot read diagnostics');
  await expectStatus(
    await writeDocumentAtServerTime(clientErrorPath,clientErrorFields(uid,'save_failed',{occurrenceCount:numberValue(2)}),token),
    403,
    'same diagnostic category is throttled for one minute'
  );
  await expectStatus(
    await writeDocument(clientErrorPath,{
      ...clientErrorFields(uid),lastAt:timestampValue(Date.now()-120000),
    },'owner'),
    200,
    'admin ages the diagnostic for retry testing'
  );
  await expectStatus(
    await writeDocumentAtServerTime(clientErrorPath,clientErrorFields(uid,'save_failed',{occurrenceCount:numberValue(2)}),token),
    200,
    'diagnostic counter may advance after the throttle window'
  );
  await expectStatus(
    await writeDocumentAtServerTime(`clientErrors/${second.uid}/categories/save_failed`,clientErrorFields(uid),token),
    403,
    'user cannot report under another user id'
  );
  await expectStatus(
    await writeDocumentAtServerTime(`clientErrors/${uid}/categories/not_supported`,clientErrorFields(uid,'not_supported'),token),
    403,
    'unsupported diagnostic category is denied'
  );
  await expectStatus(
    await writeDocumentAtServerTime(`clientErrors/${uid}/categories/render_failed`,clientErrorFields(uid,'render_failed',{code:stringValue('x'.repeat(81))}),token),
    403,
    'oversized diagnostic values are denied'
  );

  const statusPath='pools/v5-valid/phaseStatus/pods';
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([]),updatedAt:numberValue(Date.now())},'owner'),200,'admin phase seed');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([stringValue(uid)]),updatedAt:numberValue(Date.now()+1)},token),200,'member locks own phase');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([]),updatedAt:numberValue(Date.now()+2)},token),403,'member cannot reopen own phase directly');
  await expectStatus(await writeDocument(statusPath,{completedMembers:arrayValue([stringValue(uid)]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+3)},token),403,'removed phase status field cannot be restored');

  const legacyStatusPath='pools/v5-valid/phaseStatus/dating';
  await expectStatus(
    await writeDocument(legacyStatusPath,{completedMembers:arrayValue([]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+4)},'owner'),
    200,
    'admin seeds legacy phase status'
  );
  await expectStatus(
    await writeDocument(legacyStatusPath,{completedMembers:arrayValue([stringValue(uid)]),updatedAt:numberValue(Date.now()+5)},token),
    200,
    'member lock replaces a legacy phase status and removes revealed'
  );
  await expectStatus(
    await writeDocument(legacyStatusPath,{completedMembers:arrayValue([stringValue(uid)]),revealed:boolValue(false),updatedAt:numberValue(Date.now()+6)},token),
    403,
    'legacy field cannot be added again after cleanup'
  );

  const playerPath=`pools/${invitePool}/players/${second.uid}`;
  await expectStatus(await writeDocument(playerPath,playerFields('pods','intro'),second.token),200,'player writes bounded public state');
  await expectStatus(await writeDocument(playerPath,{...playerFields('pods','intro'),arbitrary:stringValue('not allowed')},second.token),403,'player cannot add arbitrary public fields');
  await expectStatus(await writeDocument(playerPath,{...playerFields('pods','intro'),username:stringValue('x'.repeat(41))},second.token),403,'player username size is bounded');

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
