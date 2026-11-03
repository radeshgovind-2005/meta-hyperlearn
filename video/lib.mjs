import { chromium } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const vars = Object.fromEntries((await readFile('.dev.vars','utf8')).split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
export const clerk = createClerkClient({ secretKey: vars.CLERK_SECRET_KEY });
export const origin='https://hyperlearn.radesh-govind.com', course='crs_qdhs2ck5wt';
export async function open({dpr=2}={}) {
  const ticket = await clerk.signInTokens.createSignInToken({userId:'user_3LYp89FmPJeSYGcFIbCw35WjhRN',expiresInSeconds:300});
  const browser = await chromium.launch({channel:'chrome'});
  const page = await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:dpr,colorScheme:'light'});
  await page.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const c=document.createElement('div');c.id='__cur';c.innerHTML='<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12.2 16.8 L20 16.8 Z" fill="#1C2B33" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';Object.assign(c.style,{position:'fixed',left:'0',top:'0',zIndex:2147483647,pointerEvents:'none',transform:'translate(-100px,-100px)',filter:'drop-shadow(0 1px 2px rgba(0,0,0,.25))'});document.documentElement.appendChild(c);
    addEventListener('mousemove',e=>{c.style.transform=`translate(${e.clientX-2}px,${e.clientY-2}px)`},true);
    addEventListener('mousedown',e=>{const r=document.createElement('div');Object.assign(r.style,{position:'fixed',left:e.clientX-18+'px',top:e.clientY-18+'px',width:'36px',height:'36px',borderRadius:'50%',background:'rgba(10,92,255,.25)',zIndex:2147483646,pointerEvents:'none',transition:'transform .45s ease-out, opacity .45s ease-out',transform:'scale(.3)'});document.documentElement.appendChild(r);requestAnimationFrame(()=>{r.style.transform='scale(1.4)';r.style.opacity='0'});setTimeout(()=>r.remove(),600)},true);});});
  await page.goto(origin+'/sign-in'); await page.waitForFunction(()=>window.Clerk?.loaded);
  const sid=await page.evaluate(async t=>{const s=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:t});await window.Clerk.setActive({session:s.createdSessionId});return s.createdSessionId},ticket.token);
  const tok=()=>page.evaluate(()=>window.Clerk.session.getToken());
  const api=async(method,p,data)=>{const r=await page.request.fetch(origin+p,{method,headers:{Authorization:`Bearer ${await tok()}`},data});return r.headers()['content-type']?.includes('json')?r.json():r.text()};
  const close=async()=>{await clerk.sessions.revokeSession(sid).catch(()=>{});await browser.close()};
  return {browser,page,api,close};
}
// CDP screencast -> constant-30fps mp4
export async function recorder(page,name){
  const cdp=await page.context().newCDPSession(page); const dir=`video/rec/${name}`; await rm(dir,{recursive:true,force:true}); await mkdir(dir,{recursive:true});
  const frames=[]; let busy=Promise.resolve();
  cdp.on('Page.screencastFrame',async f=>{cdp.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{});const i=frames.length;frames.push(f.metadata.timestamp);busy=busy.then(()=>writeFile(`${dir}/${String(i).padStart(5,'0')}.jpg`,Buffer.from(f.data,'base64')));});
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:88,maxWidth:2160,maxHeight:1350,everyNthFrame:1});
  const marks=[]; const t0=Date.now()/1000;
  return { mark:(label)=>{marks.push([label,+(Date.now()/1000-t0).toFixed(2)]);console.log('mark',label,marks.at(-1)[1])},
    stop: async()=>{ await new Promise(r=>setTimeout(r,500)); await cdp.send('Page.stopScreencast'); await busy;
      const end=Date.now()/1000; let list=''; for(let i=0;i<frames.length;i++){const d=(i+1<frames.length?frames[i+1]:end)-frames[i];list+=`file '${String(i).padStart(5,'0')}.jpg'\nduration ${Math.max(0.001,d).toFixed(4)}\n`}
      list+=`file '${String(frames.length-1).padStart(5,'0')}.jpg'\n`; await writeFile(`${dir}/list.txt`,list);
      const off=(frames[0]-t0).toFixed(2);
      execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',`${dir}/list.txt`,'-vf','fps=30,scale=2160:-2','-c:v','libx264','-crf','14','-preset','fast','-pix_fmt','yuv420p',`video/clips/${name}.mp4`]);
      await writeFile(`video/clips/${name}.json`,JSON.stringify({firstFrameOffset:+off,marks},null,1)); console.log('clip',name,'frames',frames.length,'offset',off); await rm(dir,{recursive:true,force:true}); } };
}
