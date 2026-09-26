const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {LINK_TEXT_PATTERN,looksLikeLink,stripLinkText}=require('../functions/shared/link-text');
const {signEmailPreferenceToken,verifyEmailPreferenceToken,emailPreferencesUrl,buildEmailFooter}=require('../functions/shared/email-preferences');

['scam.site','Visit scam.site now','www.example','http://x','bit.ly/abc','Pam.CA','join me at foo.com!'].forEach(value=>assert(looksLikeLink(value),value));
['Patrick','Pam 💜','J.Lo','Mr.Big','Dr. Love','Boston Pod Squad','Pod Squad 2.0','Global Pool · Love Is Blind US: Season 11'].forEach(value=>assert(!looksLikeLink(value),value));
assert.equal(stripLinkText('Visit scam.site now','fallback',100),'Visit now');
assert.equal(stripLinkText('scam.site','fallback',100),'fallback');
assert.equal(typeof LINK_TEXT_PATTERN,'string');

const secret='test-secret';
const invite={v:1,t:'invite',e:crypto.createHash('sha256').update('friend@example.test').digest('hex')};
const nudge={v:1,t:'nudge',u:'uid-1',p:'newEpisodes'};
[invite,nudge].forEach(payload=>{
  const token=signEmailPreferenceToken(payload,secret);
  assert.deepEqual(verifyEmailPreferenceToken(token,secret),payload);
  assert.equal(verifyEmailPreferenceToken(token+'x',secret),null);
  assert(emailPreferencesUrl(token).includes(encodeURIComponent(token)));
});
const footer=buildEmailFooter({kind:'invite',inviterName:'A & B',postalAddress:'123 Main <Unit 2>',preferencesUrl:'https://example.test/?x=1&y=2'});
assert(footer.text.includes('Stop all Through the Wall invitations'));
assert(footer.html.includes('A &amp; B')&&footer.html.includes('123 Main &lt;Unit 2&gt;'));

const functionsSource=fs.readFileSync(path.join(__dirname,'..','functions','index.js'),'utf8');
const inviteTemplate=functionsSource.match(/const html=`<!doctype html>[\s\S]*?<\/html>`;\n\s*tx\.create\(inviteRef/)?.[0]||'';
[
  'background:linear-gradient(135deg',
  'wants you in their unofficial Love Is Blind prediction pool',
  'Make your predictions, lock them in',
  'Your pool',
  'background:#e94e9b',
  'Join the pool →',
  '${footer.html}',
].forEach(marker=>assert(inviteTemplate.includes(marker),`Invite email design marker is missing: ${marker}`));
assert(functionsSource.includes("new URL('images/through-the-wall-app-icon.png?v=2',APP_URL)"));
assert(inviteTemplate.includes('${escapeHtml(logoUrlWithVersion)}'));
assert(inviteTemplate.includes('${escapeHtml(inviterName)}'));
assert(inviteTemplate.includes('${escapeHtml(poolNameForEmail)}'));
assert(!inviteTemplate.includes('${escapeHtml(pool.name)}'),'The invite template must not render the raw pool name.');

const clientSource=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
assert(clientSource.includes("Turn off '{state.preferenceLabel}' emails?"));
assert(!clientSource.includes('setErr(`Captain reminders queued:'),'Captain reminder success must not use the error card.');
console.log('Email safety helper assertions passed.');
