const fs=require('fs');
const path=require('path');
const Babel=require('@babel/standalone');

const root=path.resolve(__dirname,'..');
const sourcePath=path.join(root,'index.html');
const outputPath=path.join(root,'dist','index.html');
const source=fs.readFileSync(sourcePath,'utf8');
const babelScript=/<script\s+type="text\/babel"[^>]*>([\s\S]*?)<\/script>/;
const match=source.match(babelScript);

if(!match) throw new Error('Could not find the editable text/babel script in index.html.');

const compiled=Babel.transform(match[1],{presets:['react']}).code;
const withoutBabelCdn=source.replace(/\s*<script[^>]+babel-standalone[^>]*><\/script>/,'');
const output=withoutBabelCdn.replace(babelScript,`<script>\n${compiled}\n</script>`);

fs.mkdirSync(path.dirname(outputPath),{recursive:true});
fs.writeFileSync(outputPath,output);
console.log('Built dist/index.html');
