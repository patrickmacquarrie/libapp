(function initializeThroughTheWallAnalytics(window,document){
  'use strict';
  if(window.ttwAnalytics)return;

  const PROJECT_TOKEN='__POSTHOG_PROJECT_TOKEN__';
  const API_HOST='__POSTHOG_HOST__';
  const APP_BUILD='__APP_BUILD_TIMESTAMP__';
  const ACQUISITION_STORAGE_KEY='through-the-wall-acquisition';
  const ACQUISITION_KEYS=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','cohort','acquisition_source'];
  const PRICE_VARIANTS=Object.freeze({a:'4.99',b:'9.99',c:'12.99'});
  const configured=/^phc_[A-Za-z0-9_-]{8,}$/.test(PROJECT_TOKEN)&&/^https:\/\/(us|eu)\.i\.posthog\.com$/.test(API_HOST);

  const safeSlug=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48);
  const readStoredAcquisition=()=>{
    try{return JSON.parse(localStorage.getItem(ACQUISITION_STORAGE_KEY)||'{}')||{};}
    catch(error){return {};}
  };
  const currentAcquisition=()=>{
    const params=new URLSearchParams(window.location.search);
    const incoming=Object.fromEntries(ACQUISITION_KEYS.map(key=>[key,params.get(key)]).filter(([,value])=>value));
    if(Object.keys(incoming).length){
      const stored=readStoredAcquisition();
      const firstTouch=Object.keys(stored).length?stored:{...incoming,capturedAt:Date.now()};
      try{localStorage.setItem(ACQUISITION_STORAGE_KEY,JSON.stringify(firstTouch));}catch(error){}
      return firstTouch;
    }
    return readStoredAcquisition();
  };
  const acquisition=currentAcquisition();
  const acquisitionSource=()=>{
    const explicit=safeSlug(acquisition.acquisition_source||acquisition.cohort);
    if(['seed','invite','share_card'].includes(explicit)||explicit.startsWith('organic_')||explicit.startsWith('paid_'))return explicit;
    if(new URLSearchParams(window.location.search).has('join'))return 'invite';
    const source=safeSlug(acquisition.utm_source);
    const medium=safeSlug(acquisition.utm_medium);
    if(source==='share_card'||medium==='share_card'||medium==='social_share')return 'share_card';
    if(acquisition.gclid)return 'paid_google';
    if(acquisition.fbclid)return 'paid_meta';
    if(['paid','cpc','ppc','display','affiliate'].some(value=>medium.includes(value)))return `paid_${source||medium||'unknown'}`;
    if(source)return `organic_${source}`;
    return document.referrer?'organic_referral':'organic_direct';
  };
  const cohort=acquisitionSource();

  window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments);};
  if(!window.__TTW_PLAUSIBLE_BRIDGE__){
    window.__TTW_PLAUSIBLE_BRIDGE__=true;
    window.addEventListener('ttw:conversion',event=>{
      const payload=event.detail||{},name=payload.event;
      if(!name)return;
      const props={...payload};delete props.event;
      window.plausible(name,{props});
    });
  }

  if(configured){
    // Official PostHog HTML loader. It queues calls made before array.js finishes.
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split('.');2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement('script')).type='text/javascript',p.crossOrigin='anonymous',p.async=!0,p.src=s.api_host.replace('.i.posthog.com','-assets.i.posthog.com')+'/static/array.js',(r=t.getElementsByTagName('script')[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a='posthog',u.people=u.people||[],u.toString=function(t){var e='posthog';return'posthog'!==a&&(e+='.'+a),t||(e+=' (stub)'),e},u.people.toString=function(){return u.toString(1)+'.people (stub)'},o='init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'.split(' '),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    window.posthog.init(PROJECT_TOKEN,{
      api_host:API_HOST,
      defaults:'2026-05-30',
      person_profiles:'identified_only',
      capture_pageview:true,
      autocapture:true,
      mask_all_text:true,
      mask_all_element_attributes:true,
      property_denylist:['email','username','displayName','name','toEmail','inviteEmail'],
      before_send:event=>{
        const properties=event&&event.properties;
        if(!properties)return event;
        ['$current_url','$referrer','$initial_referrer'].forEach(key=>{
          const value=properties[key];
          if(!value)return;
          try{
            const url=new URL(value,window.location.origin);
            properties[key]=`${url.origin}${url.pathname}`;
          }catch(error){}
        });
        return event;
      },
      session_recording:{
        maskAllInputs:true,
        maskCapturedNetworkRequestFn:request=>{
          if(request&&request.name)request.name=request.name.split('?')[0];
          return request;
        },
      },
    });
    window.posthog.register({acquisition_source:cohort,app_build:APP_BUILD});
  }

  const eventPayload=details=>({
    ...(window.__TTW_BROWSING_CONTEXT__||{}),
    ...(details||{}),
    ...acquisition,
    acquisition_source:cohort,
    app_build:APP_BUILD,
  });
  const track=(event,details={})=>{
    const payload={...eventPayload(details),event};
    window.dataLayer=window.dataLayer||[];
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('ttw:conversion',{detail:payload}));
    window.posthog?.capture(event,payload);
    return payload;
  };
  const identify=(firebaseUid,{seasonId=''}={})=>{
    if(!configured||!firebaseUid)return;
    const setOnce={acquisition_source:cohort};
    if(seasonId)setOnce.first_seen_season=seasonId;
    window.posthog.identify(String(firebaseUid),{},setOnce);
    window.posthog.register({acquisition_source:cohort,app_build:APP_BUILD});
  };
  const reset=()=>{if(configured)window.posthog?.reset();};
  const capturePageview=route=>{
    if(!configured||!route)return;
    const cleanBase=window.location.origin==='null'?window.location.pathname:window.location.origin+window.location.pathname;
    window.posthog?.capture('$pageview',{$current_url:`${cleanBase}#${String(route).replace(/^#+/,'')}`,route,app_build:APP_BUILD,acquisition_source:cohort});
  };
  const onPriceVariant=callback=>{
    if(typeof callback!=='function')return()=>{};
    if(!configured){callback(null);return()=>{};}
    let active=true;
    window.posthog.onFeatureFlags((flags,variants,metadata={})=>{
      if(!active)return;
      if(metadata.errorsLoading){callback(null);return;}
      const variant=window.posthog.getFeatureFlag('price_variant');
      callback(Object.prototype.hasOwnProperty.call(PRICE_VARIANTS,variant)?variant:null);
    });
    return()=>{active=false;};
  };

  window.ttwAnalytics=Object.freeze({
    enabled:!!configured,
    appBuild:APP_BUILD,
    acquisitionSource:cohort,
    priceVariants:PRICE_VARIANTS,
    track,
    identify,
    reset,
    capturePageview,
    onPriceVariant,
  });
})(window,document);
