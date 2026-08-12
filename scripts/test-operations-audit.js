const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html');
const functionsSource=read('functions/index.js');
const firestoreRules=read('firestore.rules');
const publisher=read('scripts/season-publisher/Code.gs');
const seasonAdmin=read('scripts/season-publisher/Admin.html');
const workflow=read('.github/workflows/deploy-pages.yml');
const runbook=read('SEASON-LAUNCH-RUNBOOK.md');
const buildSource=read('scripts/build.js');
const firebaseConfig=read('firebase.json');
const packageJson=JSON.parse(read('package.json'));

new Function(functionsSource);
new Function(publisher);
const seasonAdminScript=seasonAdmin.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert(seasonAdminScript,'Season admin must include browser logic.');
new Function(seasonAdminScript);

assert(html.includes("doc(db,'clientErrors',user.uid,'categories',category)"),'Client failures must use authenticated Firestore diagnostics.');
assert(html.includes('occurrenceCount:increment(1)'),'Client failure counts must remain bounded to one document per user and category.');
assert(html.includes('lastAt:serverTimestamp()'),'Client failure throttling must use the trusted server timestamp.');
assert(!html.includes("httpsCallable(functions,'reportClientError')"),'Client failures must not use the organization-blocked public callable.');
assert(firestoreRules.includes('match /clientErrors/{userId}/categories/{category}'),'Firestore rules must protect client diagnostics.');
assert(firestoreRules.includes('allow read, delete: if false'),'Browser clients must not read or delete diagnostics.');
assert(firestoreRules.includes("duration.value(1, 'm')"),'Repeated diagnostics must be throttled in Firestore rules.');
['save_failed','season_load_failed','pool_open_failed','pool_create_failed','invite_send_failed','invite_accept_failed','mirror_sync_failed'].forEach(category=>{
  assert(firestoreRules.includes(`'${category}'`),`${category} must be accepted by the diagnostic rules.`);
  assert(html.includes(`reportTtwError('${category}'`),`${category} must be reported by the app.`);
});
assert(!html.includes('data?.message'),'Browser error messages must not be copied into production diagnostics.');
assert(!html.includes('data?.stack'),'Browser stack traces must not be copied into production diagnostics.');
assert(html.includes('listPublishedSeasonSnapshots'),'The app must discover newly published roadmap seasons from Firestore.');
assert(html.includes('applyPublishedSeasonSnapshots'),'Published season snapshots must activate their matching season-library entries.');
assert(html.includes("collection(db,'seasons')"),'Published season discovery must use the protected seasons collection.');
assert(html.includes("raw.length===0&&PUBLISHED_TAB_HEADERS[wanted]"),'Empty live-result tabs must remain usable from a published snapshot.');
assert(html.includes('getPublicAppConfig'),'The app must read the public live/default season configuration.');
assert(html.includes('const globalPoolSeason=seasonById(defaultSeasonId)'),'The active Global Pool must follow the configured default season.');
assert(html.includes('Past Global Pools'),'Previous Global Pools must remain accessible to their members.');
assert(firestoreRules.includes('match /appConfig/public'),'Firestore rules must expose only the public runtime routing document.');

assert(publisher.includes('PropertiesService.getScriptProperties()'),'The publisher must read season configuration from Script properties.');
assert(publisher.includes("backupDocumentPath_(config.seasonId, 'publish')"),'Every publish must preserve the previous live snapshot.');
assert(publisher.includes('function rollbackSeasonSnapshot('),'The season publisher must retain a rollback entry point.');
assert(publisher.includes('function previewSeasonSnapshot('),'The season publisher must support a no-write preview.');
assert(!publisher.includes("const SEASON_ID ="),'The publisher must not be hardcoded to one season.');
assert(publisher.includes('function doGet()'),'The publisher must serve the season-admin web app.');
assert(publisher.includes('function saveSeasonAdminDraft(payload)'),'The admin must support non-live sheet saves.');
assert(publisher.includes('function previewSeasonFromAdmin(payload)'),'The admin must preserve a read-only preview action.');
assert(publisher.includes('function publishSeasonFromAdmin(payload)'),'The admin must publish through the backup-aware publisher.');
assert(publisher.includes('validateSeasonAdminPayload_'),'The admin must validate submitted season data on the server.');
assert(publisher.includes('SEASONS_JSON'),'The publisher must support an explicit season allow-list.');
assert(publisher.includes('publisherConfig_(requestedSeasonId)'),'Every publisher action must resolve the selected registered season.');
assert(publisher.includes('function connectSeasonFromAdmin(payload)'),'The admin must be able to connect another season sheet.');
assert(publisher.includes("setProperty('SEASONS_JSON'"),'Connected season sheets must persist in the private allow-list.');
assert(publisher.includes('function setDefaultSeasonFromAdmin(seasonId)'),'The admin must be able to promote a published season to live/default.');
assert(publisher.includes("APP_CONFIG_PATH = 'appConfig/public'"),'The publisher must write the public runtime routing document.');
assert(publisher.includes('Choose another live/default season before publishing this season as Completed.'),'The active default must not be completed before its successor is chosen.');
assert(functionsSource.includes('function globalPoolSeasonFromConfig(data)'),'The Global Pool callable must resolve the active season from runtime configuration.');
assert(!functionsSource.includes('GLOBAL_POOL_SEASONS'),'The Global Pool callable must not retain a hardcoded season allow-list.');
assert(seasonAdmin.includes('Engagements & Weddings'),'The admin must cover engagement and wedding outcomes.');
assert(seasonAdmin.includes('Retreat outcomes'),'The admin must cover retreat outcomes.');
assert(seasonAdmin.includes('Reunion outcomes'),'The admin must cover Reunion outcomes.');
assert(seasonAdmin.includes('Available through episode'),'The admin must expose episode availability.');
assert(seasonAdmin.includes('id="seasonSelect"'),'The admin must expose a season switcher.');
assert(seasonAdmin.includes('id="connectSeasonButton"'),'The admin must expose a connect-season action.');
assert(seasonAdmin.includes('connectSeasonFromAdmin(request)'),'The connect-season form must use server-side sheet validation.');
assert(seasonAdmin.includes('Make live/default'),'The admin must expose an explicit default-season action.');
assert(seasonAdmin.includes('<svg viewBox="0 0 1024 1024">'),'The season admin must use the Through the Wall app icon.');
assert(seasonAdmin.includes("active='release'"),'Preview failures must open the visible result panel.');
assert(seasonAdmin.includes('Nothing was published.'),'Validation failures must clearly state that live data was not changed.');
assert(seasonAdmin.includes('Phase starts must remain chronological')===false,'Server validation details should not be duplicated into the UI source.');

const publisherContext={console};
vm.createContext(publisherContext);
vm.runInContext(publisher+'\nthis.__validateSeasonAdminPayload=validateSeasonAdminPayload_;this.__publisherSeasonRegistry=publisherSeasonRegistryFromProperties_;this.__publisherSpreadsheetId=publisherSpreadsheetId_;this.__upsertPublisherSeason=upsertPublisherSeason_;this.__publisherSeasonMetadata=publisherSeasonMetadata_;',publisherContext);
const seasons=publisherContext.__publisherSeasonRegistry({
  SEASON_ID:'love-is-blind-uk-3',
  SPREADSHEET_ID:'uk3sheet',
  SEASONS_JSON:JSON.stringify([{seasonId:'love-is-blind-br-1',spreadsheetId:'br1sheet',label:'Brazil Season 1'}])
});
assert.equal(seasons.length,2);
assert.equal(seasons[0].seasonId,'love-is-blind-uk-3');
assert.equal(seasons[1].label,'Brazil Season 1');
assert.throws(()=>publisherContext.__publisherSeasonRegistry({SEASONS_JSON:'not json'}),/not valid JSON/i);
assert.throws(()=>publisherContext.__publisherSeasonRegistry({SEASONS_JSON:JSON.stringify([
  {seasonId:'duplicate',spreadsheetId:'one'},
  {seasonId:'duplicate',spreadsheetId:'two'}
])}),/more than once/i);
assert.equal(publisherContext.__publisherSpreadsheetId('https://docs.google.com/spreadsheets/d/1234567890abcdefghij/edit#gid=0'),'1234567890abcdefghij');
assert.equal(publisherContext.__publisherSpreadsheetId('https://docs.google.com/spreadsheets/u/0/d/abcdefghij1234567890/edit'),'abcdefghij1234567890');
assert.throws(()=>publisherContext.__publisherSpreadsheetId('not-a-sheet'),/complete Google Sheet link/i);
const connected=publisherContext.__upsertPublisherSeason(seasons,{seasonId:'love-is-blind-se-1',spreadsheetId:'se1sheet',label:'Sweden Season 1'});
assert.equal(connected.length,3);
assert.equal(connected[2].label,'Sweden Season 1');
assert.throws(()=>publisherContext.__upsertPublisherSeason(connected,{seasonId:'love-is-blind-se-1',spreadsheetId:'other',label:'Wrong'}),/different spreadsheet/i);
assert.throws(()=>publisherContext.__upsertPublisherSeason(connected,{seasonId:'another-season',spreadsheetId:'se1sheet',label:'Wrong'}),/already connected/i);
assert.deepEqual(JSON.parse(JSON.stringify(publisherContext.__publisherSeasonMetadata({seasonId:'love-is-blind-br-4',label:'Brazil Season 4'},'live','Now streaming'))),{
  id:'love-is-blind-br-4',label:'Brazil Season 4',country:'Brazil',countryCode:'BR',seasonNumber:4,locationLabel:null,status:'live',releaseLabel:'Now streaming'
});
const mockScriptProperties={
  PROJECT_ID:'lib-oauth',
  SEASON_ID:'love-is-blind-uk-3',
  SPREADSHEET_ID:'1234567890uk3sheetidabc'
};
publisherContext.PropertiesService={getScriptProperties:()=>({
  getProperties:()=>({...mockScriptProperties}),
  setProperty:(key,value)=>{mockScriptProperties[key]=value;}
})};
publisherContext.SpreadsheetApp={openById:()=>({getSheetByName:tabName=>({tabName})})};
publisherContext.LockService={getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})};
publisherContext.getSeasonAdminData=seasonId=>({seasonId});
const connectedModel=publisherContext.connectSeasonFromAdmin({
  seasonId:'love-is-blind-se-1',
  label:'Sweden Season 1',
  spreadsheetUrl:'https://docs.google.com/spreadsheets/d/1234567890swedensheetid/edit'
});
assert.equal(connectedModel.seasonId,'love-is-blind-se-1');
assert.equal(JSON.parse(mockScriptProperties.SEASONS_JSON).at(-1).label,'Sweden Season 1');
const baseAdminSettings={
  SEASON_STATUS:'comingSoon',RELEASE_LABEL:'First episodes soon',AVAILABLE_THROUGH_EP:'0',BOUNDARIES_LIVE:'TRUE',
  PODS_START_EP:'1',PODS_END_EP:'5',DATING_START_EP:'5',DATING_END_EP:'7',RETREAT_START_EP:'5',RETREAT_END_EP:'7',
  WEDDINGS_START_EP:'7',WEDDINGS_END_EP:'11',REUNION_START_EP:'11',REUNION_END_EP:'12',
  PODS_BOUNDARY_FINAL:'FALSE',DATING_BOUNDARY_FINAL:'FALSE',WEDDINGS_BOUNDARY_FINAL:'FALSE',REUNION_BOUNDARY_FINAL:'FALSE',
  PODS_RESULTS_READY:'FALSE',DATING_RESULTS_READY:'FALSE',WEDDINGS_RESULTS_READY:'FALSE',REUNION_RESULTS_READY:'FALSE',
  PODS_BUDGET:'200',PODS_CAP:'60',DATING_BUDGET:'150',DATING_CAP:'40',WEDDINGS_BUDGET:'150',WEDDINGS_CAP:'80',REUNION_BUDGET:'100',REUNION_CAP:'40',
};
const baseAdminPayload={
  settings:baseAdminSettings,
  cast:[{gender:'M',name:'Alex'},{gender:'F',name:'Blair'}],
  couples:[{id:'alex-blair',him:'Alex',her:'Blair',engagedEp:'3',wedding:'',whoSaysNo:'',breakupEp:'',settledEp:'',togetherNow:'',lockEp:'11',podsEligible:'TRUE',datingEligible:'TRUE',reunionStatusEligible:'TRUE'}],
  datingResults:[{market:'sex',coupleId:'alex-blair',episode:'6',person:'',confirmed:'TRUE'}],
  reunionResults:[{market:'still',target:'alex-blair',value:'TRUE',notes:''}],
  retroEvents:[],
};
const validatedAdmin=publisherContext.__validateSeasonAdminPayload(baseAdminPayload);
assert.equal(validatedAdmin.cast.length,2);
assert.equal(validatedAdmin.couples[0].id,'alex-blair');
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,cast:[...baseAdminPayload.cast,{gender:'M',name:'alex'}]}),/duplicated/i);
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,datingResults:[{market:'sex',coupleId:'alex-blair',episode:'9',confirmed:'TRUE'}]}),/Episodes 5 and 7/i);
assert.throws(()=>publisherContext.__validateSeasonAdminPayload({...baseAdminPayload,settings:{...baseAdminSettings,SEASON_STATUS:'live',AVAILABLE_THROUGH_EP:'0'}}),/live season/i);

const authHelpersStart=html.indexOf('/* AUTH HELPERS START */');
const authHelpersEnd=html.indexOf('/* AUTH HELPERS END */');
assert(authHelpersStart>=0&&authHelpersEnd>authHelpersStart,'The authentication helpers must remain independently testable.');
const authContext={URL,Set};
vm.createContext(authContext);
vm.runInContext(`${html.slice(authHelpersStart,authHelpersEnd)}
this.__authErrorMessage=authErrorMessage;
this.__shouldFallbackToRedirect=shouldFallbackToRedirect;
this.__isLikelyInAppBrowser=isLikelyInAppBrowser;
this.__emailFromSignInUrl=emailFromSignInUrl;
this.__cleanEmailSignInUrl=cleanEmailSignInUrl;`,authContext);
['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/cancelled-popup-request'].forEach(code=>{
  assert.equal(authContext.__shouldFallbackToRedirect({code}),true,`${code} must fall back to redirect sign-in.`);
});
assert.equal(authContext.__shouldFallbackToRedirect({code:'auth/network-request-failed'}),false);
assert.equal(authContext.__isLikelyInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit Instagram 320.0'),true);
assert.equal(authContext.__isLikelyInAppBrowser('Mozilla/5.0 (Linux; Android 13; wv) Version/4.0 Chrome/120 Mobile'),true);
assert.equal(authContext.__isLikelyInAppBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'),false);
assert.equal(authContext.__authErrorMessage({code:'auth/popup-closed-by-user'}),'');
assert.equal(authContext.__authErrorMessage({code:'auth/cancelled-popup-request'}),'');
assert.match(authContext.__authErrorMessage({code:'auth/network-request-failed'}),/connection/i);
assert.equal(authContext.__authErrorMessage({code:'auth/invalid-email'}),'Enter a valid email address.');
assert(!authContext.__authErrorMessage({code:'auth/unauthorized-domain'}).includes('Firebase'));
assert.equal(authContext.__emailFromSignInUrl('https://throughthewall.ca/?join=pool.code&signInEmail=Player%40Example.com'),'player@example.com');
assert.equal(authContext.__emailFromSignInUrl('https://throughthewall.ca/?mode=signIn&continueUrl=https%3A%2F%2Fthroughthewall.ca%2F%3Fjoin%3Dpool.code%26signInEmail%3DPlayer%2540Example.com'),'player@example.com');
const cleanEmailUrl=new URL(authContext.__cleanEmailSignInUrl('https://throughthewall.ca/?join=pool.code&signInEmail=player%40example.com&mode=signIn&oobCode=secret&apiKey=key'));
assert.equal(cleanEmailUrl.searchParams.get('join'),'pool.code');
['signInEmail','mode','oobCode','apiKey'].forEach(key=>assert.equal(cleanEmailUrl.searchParams.has(key),false,`${key} must be removed after email sign-in.`));
assert(html.includes('signInWithRedirect, getRedirectResult'),'Firebase redirect auth must be imported.');
assert(html.includes('authDomain: "throughthewall.ca"'),'Firebase Auth redirects must stay on the production custom domain.');
assert(html.indexOf('await window._fb.completeAuthRedirect()')<html.indexOf('unsubscribe=window._fb.onAuthStateChanged'),'Redirect results must settle before signed-out UI.');
assert(html.includes("localStorage.getItem('through-the-wall-email-signin')||emailFromSignInUrl(window.location.href)||window.prompt"),'Cross-device email sign-in must use URL state before prompting.');
assert(html.includes('Open the sign-in link on any device to continue.'),'Email sign-in copy must describe cross-device support.');
assert(!html.includes("setErr(e?.message||'Google sign-in"),'Google auth errors must use the friendly mapper.');
assert(!html.includes('Sign in with Apple'),'Apple sign-in must stay hidden until its developer credentials are configured.');
assert(!html.includes("OAuthProvider('apple.com')"),'Unconfigured Apple authentication code must not ship.');
assert(!html.includes("setErr(e?.message||'The sign-in link"),'Email auth errors must use the friendly mapper.');
assert(!html.includes("setErr(e?.message||'You could not be signed out"),'Sign-out errors must use the friendly mapper.');
assert.equal(packageJson.devDependencies.react,'18.2.0');
assert.equal(packageJson.devDependencies['react-dom'],'18.2.0');
assert(buildSource.includes("'node_modules','react','umd','react.production.min.js'"),'The production build must self-host React.');
assert(buildSource.includes("'node_modules','react-dom','umd','react-dom.production.min.js'"),'The production build must self-host ReactDOM.');
assert(!firebaseConfig.includes('https://cdnjs.cloudflare.com'),'The production CSP must not allow the former React CDN.');
assert(firebaseConfig.includes("frame-src 'self' https://accounts.google.com"),'The production CSP must allow same-origin Firebase Auth handlers.');
assert(!firebaseConfig.includes('https://appleid.apple.com'),'The production CSP must not allow the disabled Apple provider.');

assert(workflow.includes('actions/checkout@v6'));
assert(workflow.includes('actions/setup-node@v6'));
assert(workflow.includes('actions/setup-java@v5'));
assert(workflow.includes('google-github-actions/auth@v3'));
assert(workflow.includes('workload_identity_provider: projects/737647208245/locations/global/workloadIdentityPools/github-actions/providers/libapp'));
assert(workflow.includes('service_account: github-firebase-hosting@lib-oauth.iam.gserviceaccount.com'));
assert(!workflow.includes('credentials_json'),'The release workflow must use short-lived Workload Identity credentials.');
assert(!workflow.includes('FIREBASE_SERVICE_ACCOUNT_LIB_OAUTH'),'The release workflow must not require a persistent service-account key.');
assert(workflow.includes('firebase deploy --only hosting --project lib-oauth --non-interactive'));
assert(!workflow.includes('actions/deploy-pages'),'The release workflow must not deploy to GitHub Pages.');
assert(runbook.includes('rollbackSeasonSnapshot'));
assert(runbook.includes('jsonPayload.message="Client operation failed"'));

console.log('Live-operations audit assertions passed.');
