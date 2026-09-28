const assert=require('node:assert/strict');
const {
  parseArgs,validateOptions,selectAffectedRows,rebuildIsRunning,buildRowDeleteWrite,buildFinalWrites,
  rowsOverwrittenAfterStrip,validateGlobalPoolDocument,
}=require('./unfreeze-global-phase');

const document=(uid,score,poolSize=3)=>({
  name:`projects/demo-libapp/databases/(default)/documents/pools/global__season/standingsRows/${uid}`,
  updateTime:`2026-09-27T20:00:0${uid.length}.000Z`,
  fields:{
    phaseScores:{mapValue:{fields:{pods:{integerValue:String(score)}}}},
    phasePoolSizes:{mapValue:{fields:{pods:{integerValue:String(poolSize)}}}},
  },
});

const rows=[document('a',42),document('b',-2),{
  name:'projects/demo-libapp/databases/(default)/documents/pools/global__season/standingsRows/c',
  updateTime:'2026-09-27T20:00:03.000Z',
  fields:{phaseScores:{mapValue:{fields:{dating:{integerValue:'9'}}}}},
}];
const selected=selectAffectedRows(rows,'pods');
assert.deepEqual(selected.map(row=>({uid:row.uid,score:row.score,phasePoolSize:row.phasePoolSize})),[
  {uid:'a',score:42,phasePoolSize:3},{uid:'b',score:-2,phasePoolSize:3},
]);

const rowWrite=buildRowDeleteWrite(selected[0],'pods');
assert.deepEqual(rowWrite.updateMask.fieldPaths,['phaseScores.pods','phasePoolSizes.pods']);
assert.deepEqual(rowWrite.update.fields,{},'Nested fields must be deleted with an empty update and update mask.');
assert.equal(rowWrite.currentDocument.updateTime,selected[0].document.updateTime,'Every row deletion must retain its update-time precondition.');

const current={name:'projects/demo-libapp/databases/(default)/documents/pools/global__season/standings/current',updateTime:'2026-09-27T20:01:00.000Z',fields:{}};
const marker={name:'projects/demo-libapp/databases/(default)/documents/pools/global__season/standings/rebuild',updateTime:'2026-09-27T20:02:00.000Z',fields:{requestVersion:{integerValue:'7'}}};
const finalWrites=buildFinalWrites({
  current,markerName:marker.name,requestedAt:'2026-09-27T20:03:00.000Z',reason:'correct-pods',
});
assert.equal(finalWrites[0].delete,current.name);
assert.equal(finalWrites[0].currentDocument.updateTime,current.updateTime);
assert.deepEqual(finalWrites[1].updateMask.fieldPaths,['requestedAt','reason']);
assert.deepEqual(finalWrites[1].updateTransforms,[{fieldPath:'requestVersion',increment:{integerValue:'1'}}]);
assert.equal(finalWrites[1].currentDocument,undefined,'The atomic marker increment must not carry a document precondition.');
assert.equal(buildFinalWrites({current:null,markerName:marker.name,requestedAt:'2026-09-27T20:03:00.000Z',reason:'first'}).at(-1).currentDocument,undefined);

const now=Date.parse('2026-09-27T20:06:00.000Z');
const markerAt=(lastRunAt,lastCompletedAt)=>({fields:{lastRunAt:{timestampValue:lastRunAt},...(lastCompletedAt?{lastCompletedAt:{timestampValue:lastCompletedAt}}:{})}});
assert.equal(rebuildIsRunning(markerAt('2026-09-27T20:01:00.000Z','2026-09-27T20:00:00.000Z'),now),true,'A recent unfinished rebuild must block apply.');
assert.equal(rebuildIsRunning(markerAt('2026-09-27T19:59:59.000Z','2026-09-27T19:00:00.000Z'),now),false,'A stale run must not block recovery.');
assert.equal(rebuildIsRunning(markerAt('2026-09-27T20:01:00.000Z','2026-09-27T20:02:00.000Z'),now),false,'A completed rebuild must not block apply.');

const strippedRows=selected.map(row=>({...row.document,updateTime:`write-${row.uid}`}));
const writeUpdateTimes=Object.fromEntries(selected.map(row=>[row.document.name,`write-${row.uid}`]));
assert.deepEqual(rowsOverwrittenAfterStrip({affected:selected,refreshed:strippedRows,writeUpdateTimes}),[]);
assert.deepEqual(rowsOverwrittenAfterStrip({affected:selected,refreshed:[{...strippedRows[0],updateTime:'rebuild-write'},strippedRows[1]],writeUpdateTimes}),[selected[0].document.name],'A post-strip rebuild must be detected before the marker commit.');

const validPool={fields:{global:{booleanValue:true},globalSeasonId:{stringValue:'season'}}};
assert.doesNotThrow(()=>validateGlobalPoolDocument(validPool,'season'));
assert.throws(()=>validateGlobalPoolDocument({fields:{global:{booleanValue:false},globalSeasonId:{stringValue:'season'}}},'season'),/invalid Global Pool/);

const parsed=parseArgs(['--season','season-11','--phase','pods']);
assert.equal(parsed.reason,'unfreeze-pods');
assert.equal(validateOptions(parsed,{FIREBASE_ACCESS_TOKEN:'token'}).projectId,'lib-oauth');
assert.throws(()=>validateOptions({...parsed,projectId:'another-project'},{FIREBASE_ACCESS_TOKEN:'token'}),/unexpected project/);
assert.throws(()=>validateOptions({...parsed,projectId:'demo-libapp'},{FIREBASE_ACCESS_TOKEN:'token'}),/unexpected project/);
assert.doesNotThrow(()=>validateOptions({...parsed,projectId:'demo-libapp'},{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}));
assert.throws(()=>validateOptions({...parsed,phase:'wrong'},{FIREBASE_ACCESS_TOKEN:'token'}),/Unknown phase/);
assert.throws(()=>validateOptions({...parsed,seasonId:''},{FIREBASE_ACCESS_TOKEN:'token'}),/valid season id/);
assert.throws(()=>validateOptions({...parsed,apply:true,backupPath:null,expectedCount:2},{FIREBASE_ACCESS_TOKEN:'token'}),/--backup/);
assert.throws(()=>validateOptions({...parsed,apply:true,backupPath:'backup.json',expectedCount:null},{FIREBASE_ACCESS_TOKEN:'token'}),/--expected-count/);
assert.throws(()=>parseArgs(['--season','season-11','--phase','pods','--mystery']),/Unknown argument/);

console.log('Global phase unfreeze helper assertions passed.');
