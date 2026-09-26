const crypto=require('node:crypto');

const APP_URL='https://throughthewall.ca/';
const PREFERENCE_LABELS={
  newEpisodes:'New episodes drop',
  newSeasons:'A new season drops',
  friendPhaseLocks:'A friend completes a phase',
  friendPoolCompletions:'A friend completes their pool',
};

const base64url=value=>Buffer.from(value).toString('base64url');
const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

function signEmailPreferenceToken(payload,secret){
  const encodedPayload=base64url(JSON.stringify(payload));
  const signature=crypto.createHmac('sha256',String(secret)).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyEmailPreferenceToken(token,secret){
  try{
    const [encodedPayload,provided,...rest]=String(token||'').split('.');
    if(!encodedPayload||!provided||rest.length)return null;
    const expected=crypto.createHmac('sha256',String(secret)).update(encodedPayload).digest();
    const actual=Buffer.from(provided,'base64url');
    if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;
    const payload=JSON.parse(Buffer.from(encodedPayload,'base64url').toString('utf8'));
    if(payload?.v!==1||!['invite','nudge'].includes(payload?.t))return null;
    if(payload.t==='invite'&&!/^[a-f0-9]{64}$/.test(String(payload.e||'')))return null;
    if(payload.t==='nudge'&&(!String(payload.u||'')||!Object.hasOwn(PREFERENCE_LABELS,payload.p)))return null;
    return payload;
  }catch(error){return null;}
}

function emailPreferencesUrl(token){
  const url=new URL(APP_URL);url.searchParams.set('emailPreferences',token);return url.toString();
}

function buildEmailFooter({kind,inviterName,preferenceLabel,postalAddress,preferencesUrl}){
  const identity=`Through the Wall · an unofficial fan-made Love Is Blind prediction game · ${postalAddress} · support@throughthewall.ca`;
  const explanation=kind==='invite'
    ? `You're getting this because ${inviterName}, a Through the Wall player, entered your address. We won't email you about this pool again.`
    : `You're getting this because you turned on "${preferenceLabel}" in Settings.`;
  const action=kind==='invite'?'Stop all Through the Wall invitations':'Turn off this email';
  const extra=kind==='nudge'?' or change your choices in Settings.':'.';
  return {
    text:`${explanation}\n${action}: ${preferencesUrl}${extra}\n${identity}`,
    html:`<div style="padding:19px 32px;background:#211a37;text-align:center;color:#d9d1e7;font-size:12px;line-height:1.5;">${escapeHtml(explanation)} <a href="${escapeHtml(preferencesUrl)}" style="color:#ffffff;">${escapeHtml(action)}</a>${escapeHtml(extra)}<br>${escapeHtml(identity)}</div>`,
  };
}

module.exports={PREFERENCE_LABELS,signEmailPreferenceToken,verifyEmailPreferenceToken,emailPreferencesUrl,buildEmailFooter};
