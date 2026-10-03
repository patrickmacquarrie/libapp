const assert=require('node:assert/strict');
const admin=require('../functions/node_modules/firebase-admin');

const projectId=process.env.GCLOUD_PROJECT||'demo-libapp';
const authHost=process.env.FIREBASE_AUTH_EMULATOR_HOST;
const functionsHost=process.env.FUNCTIONS_EMULATOR_HOST||'127.0.0.1:5001';
assert(authHost&&process.env.FIRESTORE_EMULATOR_HOST,'Run through the Auth, Firestore, and Functions emulators.');

admin.initializeApp({projectId});
const db=admin.firestore();
const auth=admin.auth();
const seasonId='sync-groups-emulator';
const groupId=(uid,ids)=>`${uid}__${seasonId}__${[...ids].sort()[0]}`;
const groupRef=(uid,ids)=>db.doc(`syncGroups/${groupId(uid,ids)}`);

async function createUser(email){
  const password='sync-emulator-password';
  const user=await auth.createUser({email,password,emailVerified:true});
  const response=await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-key`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true}),
  });
  const payload=await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  await db.doc(`users/${user.uid}`).set({username:email.split('@')[0],createdAt:Date.now()});
  return {uid:user.uid,token:payload.idToken};
}

async function call(name,user,data){
  const response=await fetch(`http://${functionsHost}/${projectId}/us-central1/${name}`,{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${user.token}`},
    body:JSON.stringify({data}),
  });
  const payload=await response.json();
  assert.equal(response.status,200,`${name}: ${JSON.stringify(payload)}`);
  assert(!payload.error,`${name}: ${JSON.stringify(payload)}`);
  return payload.result;
}

async function seedPool(id,ownerUid,members){
  await db.doc(`pools/${id}`).set({
    name:id,ownerUid,members,global:false,season:{id:seasonId},
    joinCode:'sync-emulator-code',membershipClosed:false,createdAt:Date.now(),
  });
}

async function seedGroup(uid,ids){
  const poolIds=[...ids].sort();
  const batch=db.batch();
  batch.set(groupRef(uid,poolIds),{uid,seasonId,poolIds,updatedAt:Date.now()});
  poolIds.forEach(id=>batch.set(db.doc(`pools/${id}/players/${uid}`),{
    username:'Sync Tester',phase:'pods',screen:'intro',w:0,watchThrough:0,completed:{},syncPoolIds:poolIds,
  }));
  await batch.commit();
}

async function playerSyncIds(poolId,uid){
  const snapshot=await db.doc(`pools/${poolId}/players/${uid}`).get();
  return snapshot.exists?snapshot.data().syncPoolIds||[]:null;
}

async function main(){
  const owner=await createUser('sync-owner@example.test');
  const member=await createUser('sync-member@example.test');
  const guest=await createUser('sync-guest@example.test');
  const ids=['sync-a','sync-b','sync-c','sync-d','sync-e'];
  await Promise.all(ids.map(id=>seedPool(id,owner.uid,[owner.uid,member.uid])));
  await seedPool('sync-f',owner.uid,[owner.uid,guest.uid]);
  await seedPool('sync-g',guest.uid,[guest.uid]);
  await seedGroup(member.uid,['sync-a','sync-b','sync-c']);
  await seedGroup(member.uid,['sync-d','sync-e']);
  await seedGroup(owner.uid,['sync-a','sync-b']);
  await seedGroup(guest.uid,['sync-f','sync-g']);

  await call('leavePool',member,{poolId:'sync-c'});
  assert.deepEqual((await groupRef(member.uid,['sync-a','sync-b']).get()).data().poolIds,['sync-a','sync-b']);
  assert.equal((await db.collection('syncGroups').where('uid','==',member.uid).get()).size,2,
    'Leaving one group must preserve the separate group in the same season.');
  assert.deepEqual(await playerSyncIds('sync-a',member.uid),['sync-a','sync-b']);
  assert.deepEqual(await playerSyncIds('sync-b',member.uid),['sync-a','sync-b']);
  assert.equal(await playerSyncIds('sync-c',member.uid),null,'Leaving removes the departing player document.');
  assert.deepEqual((await groupRef(member.uid,['sync-d','sync-e']).get()).data().poolIds,['sync-d','sync-e'],'An independent group must remain untouched.');

  await call('deletePool',owner,{poolId:'sync-a'});
  assert.equal((await db.doc('pools/sync-a').get()).exists,false);
  assert.equal((await groupRef(member.uid,['sync-a','sync-b']).get()).exists,false,'Deleting a pool must remove a group reduced to one member.');
  assert.equal((await groupRef(owner.uid,['sync-a','sync-b']).get()).exists,false,'Deleting a pool must clean the owner’s group too.');
  assert.deepEqual(await playerSyncIds('sync-b',member.uid),[],'The surviving player mirror must no longer refer to a deleted pool.');
  assert.deepEqual(await playerSyncIds('sync-b',owner.uid),[],'The owner’s surviving mirror must also be cleared.');
  assert.deepEqual((await groupRef(member.uid,['sync-d','sync-e']).get()).data().poolIds,['sync-d','sync-e']);

  await call('deleteMyAccount',member,{});
  assert.equal((await db.collection('syncGroups').where('uid','==',member.uid).get()).empty,true,'Account deletion must erase every group record owned by the user.');
  assert.equal((await db.doc('users/'+member.uid).get()).exists,false);
  await call('deleteMyAccount',owner,{});
  assert.equal((await db.doc('pools/sync-f').get()).exists,false,'An account deletion must delete that account’s private pool.');
  assert.equal((await groupRef(guest.uid,['sync-f','sync-g']).get()).exists,false,
    'Deleting a pool through account deletion must clean other members’ group records.');
  assert.deepEqual(await playerSyncIds('sync-g',guest.uid),[],
    'Other members’ player mirrors must not retain an owner-deleted pool.');
  console.log('Sync-group leave, pool-delete, independent-group, and account-delete emulator assertions passed.');
}

main().catch(error=>{console.error(error);process.exitCode=1;});
