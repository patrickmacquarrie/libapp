const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','analytics.js'),'utf8')
  .replaceAll('__POSTHOG_PROJECT_TOKEN__','phc_privacy_test_token')
  .replaceAll('__POSTHOG_HOST__','https://eu.i.posthog.com')
  .replaceAll('__META_PIXEL_ID__','1419228339585181')
  .replaceAll('__APP_BUILD_TIMESTAMP__','privacy-test-build');

function load({hostname='throughthewall.ca',search='',hash='',optedOut=false,storage:existingStorage,timeZone='Europe/Paris',languages=['en-CA'],gpc=false}={}){
  const storage=existingStorage||new Map(optedOut?[['through-the-wall-analytics-opt-out','1']]:[]),listeners=new Map(),createdElements=[];
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const window={
    location:{hostname,origin:`https://${hostname}`,pathname:'/',search,hash},
    addEventListener:(type,listener)=>listeners.set(type,listener),
    dispatchEvent:event=>{listeners.get(event.type)?.(event);return true;},
  };
  const document={referrer:'',createElement:tag=>{const element={tagName:tag,style:{}};createdElements.push(element);return element;},getElementsByTagName:()=>[{parentNode:{insertBefore:()=>{}}}]};
  const localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)};
  const navigator={languages,globalPrivacyControl:gpc};
  const Intl={DateTimeFormat:()=>({resolvedOptions:()=>{if(timeZone==='throw')throw new Error('Timezone unavailable');return {timeZone};}})};
  vm.runInNewContext(source,{window,document,localStorage,navigator,Intl,URL,URLSearchParams,Date,Object,String,CustomEvent});
  return {window,storage,createdElements};
}

const optedOut=load({optedOut:true});
assert.equal(optedOut.window.posthog,undefined);
assert.equal(optedOut.window.ttwAnalytics.enabled,false);
assert.equal(optedOut.window.ttwAnalytics.metaChoiceNeeded(),false);
optedOut.window.ttwAnalytics.track('should_not_capture');
assert.equal(optedOut.window.dataLayer,undefined);
let variant='unset';optedOut.window.ttwAnalytics.onPriceVariant(value=>{variant=value;});
assert.equal(variant,null);
assert.equal(optedOut.storage.get('plausible_ignore'),'true');

const local=load({hostname:'127.0.0.1'});
assert.equal(local.window.posthog,undefined);
assert.equal(local.window.ttwAnalytics.enabled,false);
assert.equal(local.window.ttwAnalytics.metaChoiceNeeded(),false);

const defaultOn=load({timeZone:'America/Edmonton'});
assert(defaultOn.window.fbq.queue.some(call=>call[0]==='track'&&call[1]==='PageView'),'Default-on visitors must get a PageView on first load.');
assert.equal(defaultOn.window.ttwAnalytics.metaChoiceNeeded(),false);
assert.equal(defaultOn.window.ttwAnalytics.metaNoticeNeeded(),true);
assert.equal(defaultOn.window.ttwAnalytics.isMetaOptedIn(),true);
defaultOn.window.ttwAnalytics.track('account_created');
assert(defaultOn.window.fbq.queue.some(call=>call[0]==='track'&&call[1]==='CompleteRegistration'));
defaultOn.window.ttwAnalytics.metaNoticeShown('signin');
defaultOn.window.ttwAnalytics.metaNoticeShown('signin');
const notices=defaultOn.window.posthog.filter(call=>call[0]==='capture'&&call[1]==='meta_notice_shown');
assert.equal(notices.length,1,'A notice must be counted at most once per placement.');
assert.equal(notices[0][2].placement,'signin');
defaultOn.window.ttwAnalytics.optOut();
assert(defaultOn.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='revoke'));
defaultOn.window.ttwAnalytics.optIn();
assert(defaultOn.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='grant'),'Restoring usage analytics must resume an eligible default-on pixel.');

const defaultOnStorage=new Map();
const defaultOnBeforeDecline=load({timeZone:'America/Edmonton',storage:defaultOnStorage});
defaultOnBeforeDecline.window.ttwAnalytics.metaOptOut('signin');
assert.equal(defaultOnStorage.get('through-the-wall-meta-measurement'),'declined');
assert(defaultOnBeforeDecline.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='revoke'));
assert(defaultOnBeforeDecline.window.posthog.some(call=>call[0]==='capture'&&call[1]==='meta_choice_made'&&call[2].choice==='decline'&&call[2].placement==='signin'));
const defaultOnAfterDecline=load({timeZone:'America/Edmonton',storage:defaultOnStorage});
assert.equal(defaultOnAfterDecline.window.fbq,undefined,'A stored decline must prevent the pixel on reload.');
assert.equal(defaultOnAfterDecline.window.ttwAnalytics.metaNoticeNeeded(),false);
assert.equal(defaultOnAfterDecline.window.ttwAnalytics.metaChoiceNeeded(),false);

const priorDecline=load({timeZone:'America/Edmonton',storage:new Map([['through-the-wall-meta-measurement','declined']])});
assert.equal(priorDecline.window.fbq,undefined);
assert.equal(priorDecline.window.ttwAnalytics.metaNoticeNeeded(),false);
assert.equal(priorDecline.window.ttwAnalytics.metaChoiceNeeded(),false);
const priorAllow=load({timeZone:'Europe/Paris',storage:new Map([['through-the-wall-meta-measurement','allowed']])});
assert(priorAllow.window.fbq,'An explicit allow must take precedence over the regional default.');

const production=load();
assert.equal(production.window.ttwAnalytics.enabled,true);
assert.equal(production.window.posthog._i.length,1);
assert.equal(production.window.fbq,undefined,'Meta must not load before a separate advertising choice.');
assert.equal(production.window.ttwAnalytics.metaChoiceNeeded(),true);
assert.equal(production.window.ttwAnalytics.metaNoticeNeeded(),false);
production.window.ttwAnalytics.metaChoiceShown('signin');
production.window.ttwAnalytics.metaChoiceShown('signin');
const shown=production.window.posthog.filter(call=>call[0]==='capture'&&call[1]==='meta_choice_shown');
assert.equal(shown.length,1,'An inline choice must be counted at most once per page load.');
assert.equal(shown[0][2].placement,'signin');
production.window.ttwAnalytics.metaOptIn('signin');
assert.equal(production.window.ttwAnalytics.metaChoiceNeeded(),false);
assert.equal(production.window.fbq.disablePushState,true,'The pixel must not emit automatic history PageViews.');
const autoConfigIndex=production.window.fbq.queue.findIndex(call=>call[0]==='set'&&call[1]==='autoConfig');
const initIndex=production.window.fbq.queue.findIndex(call=>call[0]==='init');
assert(autoConfigIndex>=0&&autoConfigIndex<initIndex,'Automatic data collection must be disabled before pixel initialization.');
assert.deepEqual(Array.from(production.window.fbq.queue[autoConfigIndex]),['set','autoConfig',false,'1419228339585181']);
const made=production.window.posthog.filter(call=>call[0]==='capture'&&call[1]==='meta_choice_made');
assert.equal(made.length,1);
assert.equal(made[0][2].choice,'allow');
assert.equal(made[0][2].placement,'signin');
assert(production.createdElements.every(element=>element.style.position!=='fixed'),'Analytics must not create a fixed consent overlay.');
assert(production.window.fbq.queue.some(call=>call[0]==='track'&&call[1]==='PageView'));
production.window.ttwAnalytics.track('account_created');
production.window.ttwAnalytics.track('pool_created');
production.window.ttwAnalytics.track('global_pool_joined');
assert(production.window.fbq.queue.some(call=>call[0]==='track'&&call[1]==='CompleteRegistration'));
assert(production.window.fbq.queue.some(call=>call[0]==='trackCustom'&&call[1]==='PoolCreated'));
assert(production.window.fbq.queue.some(call=>call[0]==='trackCustom'&&call[1]==='PoolJoined'));
production.window.ttwAnalytics.optOut();
const metaCallsWhenStopped=production.window.fbq.queue.length;
production.window.ttwAnalytics.metaOptIn();
assert.equal(production.window.fbq.queue.length,metaCallsWhenStopped,'Advertising opt-in must not resume a stopped analytics session.');
production.window.ttwAnalytics.optIn();
assert(production.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='grant'));
production.window.ttwAnalytics.metaOptOut();
assert.equal(production.window.ttwAnalytics.metaChoiceNeeded(),false);
assert(production.window.fbq.queue.some(call=>call[0]==='consent'&&call[1]==='revoke'));
production.window.ttwAnalytics.optOut();
assert.equal(production.storage.get('through-the-wall-analytics-opt-out'),'1');
production.window.ttwAnalytics.optIn();
assert.equal(production.storage.has('through-the-wall-analytics-opt-out'),false);

const quebecFrench=load({timeZone:'America/Toronto',languages:['fr-CA','en-CA']});
assert.equal(quebecFrench.window.fbq,undefined);
assert.equal(quebecFrench.window.ttwAnalytics.metaChoiceNeeded(),true);
const torontoEnglish=load({timeZone:'America/Toronto',languages:['en-CA']});
assert(torontoEnglish.window.fbq);
assert.equal(torontoEnglish.window.ttwAnalytics.metaNoticeNeeded(),true);

const gpcVisitor=load({timeZone:'America/Edmonton',gpc:true});
assert.equal(gpcVisitor.window.fbq,undefined);
assert.equal(gpcVisitor.window.ttwAnalytics.metaChoiceNeeded(),false);
assert.equal(gpcVisitor.window.ttwAnalytics.metaNoticeNeeded(),false);
gpcVisitor.window.ttwAnalytics.metaOptIn('settings');
assert(gpcVisitor.window.fbq,'An explicit Settings choice must override GPC.');

for(const timeZone of ['',null,'throw']){
  const unknownZone=load({timeZone});
  assert.equal(unknownZone.window.fbq,undefined);
  assert.equal(unknownZone.window.ttwAnalytics.metaChoiceNeeded(),true);
  assert.equal(unknownZone.window.ttwAnalytics.metaNoticeNeeded(),false);
}

for(const options of [
  {search:'?join=pool.private-token'},
  {search:'?private_token=secret'},
  {hash:'#account-details'},
  {hostname:'localhost'},
  {optedOut:true},
]){
  const guarded=load({...options,timeZone:'America/Edmonton'});
  assert.equal(guarded.window.fbq,undefined,`The default-on pixel must respect ${JSON.stringify(options)}.`);
  assert.equal(guarded.window.ttwAnalytics.metaNoticeNeeded(),false);
}

const sensitivePage=load({search:'?join=pool.private-token'});
assert.equal(sensitivePage.window.ttwAnalytics.metaChoiceNeeded(),false);
sensitivePage.window.ttwAnalytics.metaOptIn();
sensitivePage.window.ttwAnalytics.track('account_created');
assert.equal(sensitivePage.window.fbq,undefined,'Meta must not load on a URL containing invitation details.');
const unknownParameterPage=load({search:'?private_token=secret'});
assert.equal(unknownParameterPage.window.ttwAnalytics.metaChoiceNeeded(),false);
unknownParameterPage.window.ttwAnalytics.metaOptIn();
assert.equal(unknownParameterPage.window.fbq,undefined,'Meta must not load when a URL includes an unrecognized parameter.');

const welcomeDecline=load();
welcomeDecline.window.ttwAnalytics.metaChoiceShown('welcome');
welcomeDecline.window.ttwAnalytics.metaOptOut('welcome');
assert.equal(welcomeDecline.window.ttwAnalytics.metaChoiceNeeded(),false);
assert.equal(welcomeDecline.window.fbq,undefined,'Declining must leave the Meta pixel unloaded.');
assert(welcomeDecline.window.posthog.some(call=>call[0]==='capture'&&call[1]==='meta_choice_shown'&&call[2].placement==='welcome'));
assert(welcomeDecline.window.posthog.some(call=>call[0]==='capture'&&call[1]==='meta_choice_made'&&call[2].choice==='decline'&&call[2].placement==='welcome'));
welcomeDecline.window.ttwAnalytics.metaOptIn('settings');
assert(welcomeDecline.window.posthog.some(call=>call[0]==='capture'&&call[1]==='meta_choice_made'&&call[2].choice==='allow'&&call[2].placement==='settings'));
welcomeDecline.window.ttwAnalytics.metaOptOut('settings');
assert(welcomeDecline.window.posthog.some(call=>call[0]==='capture'&&call[1]==='meta_choice_made'&&call[2].choice==='decline'&&call[2].placement==='settings'));

const reloadStorage=new Map();
const beforeOptOut=load({storage:reloadStorage});
beforeOptOut.window.ttwAnalytics.optOut();
const optedOutReload=load({storage:reloadStorage});
assert.equal(optedOutReload.window.posthog,undefined,'PostHog must remain unloaded after reloading while opted out.');
optedOutReload.window.ttwAnalytics.optIn();
assert.equal(reloadStorage.has('through-the-wall-analytics-opt-out'),false,'Opting back in must clear the app opt-out flag.');
assert.equal(reloadStorage.get('through-the-wall-analytics-opt-in-pending'),'1','Opting in without a loaded SDK must schedule provider consent restoration.');
const restoredReload=load({storage:reloadStorage});
assert.equal(restoredReload.window.ttwAnalytics.enabled,true,'The next production load must re-enable analytics.');
assert(restoredReload.window.posthog.some(call=>call[0]==='opt_in_capturing'),'The next production load must clear PostHog’s persisted opt-out.');
assert.equal(reloadStorage.has('through-the-wall-analytics-opt-in-pending'),false,'Provider consent restoration must be consumed once.');
restoredReload.window.ttwAnalytics.track('capture_after_opt_in');
assert(restoredReload.window.posthog.some(call=>call[0]==='capture'&&call[1]==='capture_after_opt_in'),'Capture must resume after the opt-out, reload, opt-in, reload sequence.');

const legacyStuck=load();
const legacyConfig=legacyStuck.window.posthog._i[0][1];
let legacyOptInCalls=0;
legacyConfig.loaded({has_opted_out_capturing:()=>true,opt_in_capturing:()=>{legacyOptInCalls+=1;}});
assert.equal(legacyOptInCalls,1,'A browser stuck in PostHog’s legacy provider opt-out must be repaired when the SDK loads.');

const alreadyEnabled=load();
const enabledConfig=alreadyEnabled.window.posthog._i[0][1];
let unnecessaryOptInCalls=0;
enabledConfig.loaded({has_opted_out_capturing:()=>false,opt_in_capturing:()=>{unnecessaryOptInCalls+=1;}});
assert.equal(unnecessaryOptInCalls,0,'An already-enabled browser must not emit a redundant provider opt-in.');
console.log('Analytics production-host and opt-out assertions passed.');
