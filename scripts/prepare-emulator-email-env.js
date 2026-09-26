const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','functions');
const files=[
  [path.join(root,'.env.demo-libapp'),'MAIL_POSTAL_ADDRESS=123 Test Street, Edmonton AB\n'],
  [path.join(root,'.secret.local'),'EMAIL_PREFERENCES_SECRET=local-emulator-secret-not-for-production\n'],
];
files.forEach(([file,contents])=>{if(!fs.existsSync(file))fs.writeFileSync(file,contents,{mode:0o600});});
console.log('Local email parameters are ready for the Functions emulator.');
