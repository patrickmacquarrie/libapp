const LINK_TEXT_PATTERN='.*(://|www[.]).*|.*[.](com|net|org|ca|co|io|app|site|xyz|link|ly|me|gg|tv|info|biz|shop|online|live|club|us|uk|to|cc|sh)([^a-z0-9].*)?';

function safeHeaderText(value,maxLength=100){
  return String(value||'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength);
}

function looksLikeLink(value){
  return new RegExp('^(?:'+LINK_TEXT_PATTERN+')$').test(String(value).toLowerCase());
}

function stripLinkText(value,fallback,maxLength){
  const cleaned=safeHeaderText(value,maxLength);
  const stripped=cleaned.split(/\s+/).filter(token=>!looksLikeLink(token)).join(' ').trim();
  return !stripped||looksLikeLink(stripped)?fallback:stripped;
}

module.exports={LINK_TEXT_PATTERN,safeHeaderText,looksLikeLink,stripLinkText};
