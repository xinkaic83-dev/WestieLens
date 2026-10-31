/* SPDX-License-Identifier: GPL-3.0-only */
import {mkdir,readFile,writeFile,copyFile,rm,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const here=fileURLToPath(new URL('.',import.meta.url));
const root=resolve(here,'..');
const release=process.env.WESTIELENS_RELEASE_DIR||join(root,'release');
const version='0.1.0-beta.1';
const filenames=[`WestieLens-${version}-chrome.zip`,`WestieLens-${version}-source.zip`];
const checksums=await readFile(join(release,'SHA256SUMS'),'utf8').catch(()=>{throw new Error(`Missing verified release files in ${release}. See website/README.md.`)});
const expected=new Map(checksums.trim().split('\n').map(line=>{const [hash,name]=line.split(/\s+/,2);return[name,hash]}));
for(const name of filenames){const contents=await readFile(join(release,name));if(createHash('sha256').update(contents).digest('hex')!==expected.get(name))throw new Error(`Checksum mismatch: ${name}`);}
const dist=join(here,'dist');await rm(dist,{recursive:true,force:true});await mkdir(join(dist,'assets'),{recursive:true});await mkdir(join(dist,'downloads'),{recursive:true});
for(const locale of ['', 'en']) {
  await mkdir(join(dist,locale),{recursive:true});
  for(const name of ['index.html','privacy.html']) await writeFile(join(dist,locale,name),(await readFile(join(here,locale,name),'utf8')).replaceAll('__VERSION__',version));
}
for(const name of ['style.css','site.js','locales.js','_headers','robots.txt'])await copyFile(join(here,name),join(dist,name));
for(const name of await readdir(join(here,'assets')))await copyFile(join(here,'assets',name),join(dist,'assets',name));
for(const [source,target] of [['LICENSE','LICENSE.txt'],['NOTICE','NOTICE'],['THIRD_PARTY_NOTICES.txt','THIRD_PARTY_NOTICES.txt']])await copyFile(join(root,source),join(dist,target));
for(const name of filenames)await copyFile(join(release,name),join(dist,'downloads',name));
await writeFile(join(dist,'downloads','SHA256SUMS'),filenames.map(name=>`${expected.get(name)}  ${name}\n`).join(''));
console.log(`Built bilingual static website: ${dist}\nVersion: ${version}\nTwo release archives verified against SHA256SUMS. No server, API key or runtime dependencies.`);
