(function initializeThroughTheWallAnalytics(window,document){
  'use strict';
  if(window.ttwAnalytics)return;

  const PROJECT_TOKEN='__POSTHOG_PROJECT_TOKEN__';
  const API_HOST='__POSTHOG_HOST__';
  const APP_BUILD='__APP_BUILD_TIMESTAMP__';
  const ACQUISITION_STORAGE_KEY='through-the-wall-acquisition';
  const ACQUISITION_KEYS=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','cohort','acquisition_source'];
  const PRICE_VARIANTS=Object.freeze({a:'4.99',c:'12.99'});
  const PRIVACY_PROPERTIES=Object.freeze({$geoip_disable:true});
  const PERSONAL_DATA_PROPERTIES=Object.freeze(['join','signInEmail','oobCode','apiKey','continueUrl','mode','lang','tenantId']);
  const configured=/^phc_[A-Za-z0-9_-]{8,}$/.test(PROJECT_TOKEN)&&/^https:\/\/(us|eu)\.i\.posthog\.com$/.test(API_HOST);
  let capturingStopped=false;

  const safeSlug=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,48);
  const readStoredAcquisition=()=>{
    try{return JSON.parse(localStorage.getItem(ACQUISITION_STORAGE_KEY)||'{}')||{};}
    catch(error){return {};}
  };
  const currentAcquisition=()=>{
    const params=new URLSearchParams(window.location.search);
    const incoming=Object.fromEntries(ACQUISITION_KEYS.map(key=>[key,params.get(key)]).filter(([,value])=>value));
    const stored=readStoredAcquisition();
    if(Object.keys(stored).length)return stored;
    const invited=!!params.get('join');
    if(Object.keys(incoming).length||invited){
      const firstTouch={...incoming,...(invited?{acquisition_source:'invite'}:{}),capturedAt:Date.now()};
      try{localStorage.setItem(ACQUISITION_STORAGE_KEY,JSON.stringify(firstTouch));}catch(error){}
      return firstTouch;
    }
    return stored;
  };
  const acquisition=currentAcquisition();
  const acquisitionSource=()=>{
    const explicit=safeSlug(acquisition.acquisition_source||acquisition.cohort);
    if(['seed','invite','share_card'].includes(explicit)||explicit.startsWith('organic_')||explicit.startsWith('paid_'))return explicit;
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
      capture_pageview:window.__TTW_MANUAL_PAGEVIEWS__?false:true,
      autocapture:true,
      mask_all_text:true,
      mask_all_element_attributes:true,
      mask_personal_data_properties:true,
      custom_personal_data_properties:PERSONAL_DATA_PROPERTIES,
      property_denylist:['email','username','displayName','name','toEmail','inviteEmail'],
      before_send:event=>{
        const properties=event&&event.properties;
        if(properties)properties.$geoip_disable=true;
        const sanitizeUrl=value=>{
          if(typeof value!=='string')return value;
          try{
            const url=new URL(value);
            if(!['throughthewall.ca','www.throughthewall.ca'].includes(url.hostname))return value;
            return `${url.origin}${url.pathname}${url.hash}`;
          }catch(error){return value;}
        };
        const sanitizeObject=object=>{
          if(!object||typeof object!=='object'||Array.isArray(object))return;
          Object.keys(object).forEach(key=>{
            const value=object[key];
            if(typeof value==='string')object[key]=sanitizeUrl(value);
            else if(value&&typeof value==='object'&&!Array.isArray(value)){
              Object.keys(value).forEach(nestedKey=>{
                if(typeof value[nestedKey]==='string')value[nestedKey]=sanitizeUrl(value[nestedKey]);
              });
            }
          });
        };
        [event&&event.properties,event&&event.$set,event&&event.$set_once].forEach(sanitizeObject);
        return event;
      },
      session_recording:{
        maskAllInputs:true,
        maskTextSelector:'*',
        maskCapturedNetworkRequestFn:request=>{
          if(request&&request.name)request.name=request.name.split('?')[0];
          return request;
        },
      },
    });
    window.posthog.register({acquisition_source:cohort,app_build:APP_BUILD,...PRIVACY_PROPERTIES});
  }

  const eventPayload=details=>({
    ...(window.__TTW_BROWSING_CONTEXT__||{}),
    ...(details||{}),
    ...acquisition,
    ...PRIVACY_PROPERTIES,
    acquisition_source:cohort,
    app_build:APP_BUILD,
  });
  const track=(event,details={})=>{
    const payload={...eventPayload(details),event};
    if(capturingStopped)return payload;
    window.dataLayer=window.dataLayer||[];
    window.dataLayer.push(payload);
    window.dispatchEvent(new CustomEvent('ttw:conversion',{detail:payload}));
    window.posthog?.capture(event,payload);
    return payload;
  };
  const identify=(firebaseUid,{seasonId=''}={})=>{
    if(!configured||!firebaseUid||capturingStopped)return;
    const setOnce={acquisition_source:cohort};
    if(seasonId)setOnce.first_seen_season=seasonId;
    window.posthog.identify(String(firebaseUid),{},setOnce);
    window.posthog.register({acquisition_source:cohort,app_build:APP_BUILD,...PRIVACY_PROPERTIES});
  };
  const reset=()=>{if(configured)window.posthog?.reset();};
  const stop=()=>{
    capturingStopped=true;
    if(configured)window.posthog?.opt_out_capturing();
  };
  const capturePageview=route=>{
    if(!configured||!route||capturingStopped)return;
    const cleanBase=window.location.origin==='null'?window.location.pathname:window.location.origin+window.location.pathname;
    window.posthog?.capture('$pageview',{$current_url:`${cleanBase}#${String(route).replace(/^#+/,'')}`,route,app_build:APP_BUILD,acquisition_source:cohort,...PRIVACY_PROPERTIES});
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
    stop,
    capturePageview,
    onPriceVariant,
  });
})(window,document);
