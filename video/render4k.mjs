import { chromium } from '@playwright/test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
const W=+(process.argv[2]||6), FPS=30;
const browser=await chromium.launch({channel:'chrome'});
async function openPage(){ const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:2});
  page.on('pageerror',e=>console.log('pageerror',e.message));
  await page.goto('file://'+process.cwd()+'/film.html'); await page.evaluate(()=>window.ready); await page.waitForTimeout(500); return page; }
const p0=await openPage(); const DUR=await p0.evaluate(()=>window.DUR); await p0.close();
const N=Math.round(DUR*FPS), per=Math.ceil(N/W); let done=0;
await rm('seg',{recursive:true,force:true}); await mkdir('seg');
await Promise.all([...Array(W)].map(async(_,w)=>{
  const page=await openPage();
  const ff=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',String(FPS),'-c:v','png','-i','-','-c:v','libx264','-preset','medium','-crf','8','-pix_fmt','yuv444p','-tune','animation',`seg/${String(w).padStart(2,'0')}.mkv`],{stdio:['pipe','inherit','inherit']});
  const closed=new Promise(r=>ff.on('close',r));
  for(let i=w*per;i<Math.min(N,(w+1)*per);i++){
    await page.evaluate(async t=>{await seek(t);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))},i/FPS);
    const buf=await page.screenshot({type:'png'});
    if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
    if(++done%300===0)console.log('frames',done,'/',N);
  }
  ff.stdin.end(); await closed; await page.close();
}));
await browser.close();
await writeFile('seg/list.txt',[...Array(W)].map((_,w)=>`file '${String(w).padStart(2,'0')}.mkv'`).join('\n'));
execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i','seg/list.txt','-c','copy','seg/master.mkv'],{stdio:'inherit'});
console.log('encoding 4K');
execFileSync('ffmpeg',['-y','-loglevel','error','-i','seg/master.mkv','-i','audio/narration.wav','-c:v','libx264','-preset','slow','-crf','14','-tune','animation','-pix_fmt','yuv420p','-profile:v','high','-c:a','aac','-b:a','256k','-shortest','-movflags','+faststart','hyperlearn-demo-4k.mp4'],{stdio:'inherit'});
console.log('encoding 1080p');
execFileSync('ffmpeg',['-y','-loglevel','error','-i','seg/master.mkv','-i','audio/narration.wav','-vf','scale=1920:1080:flags=lanczos','-c:v','libx264','-preset','slow','-crf','14','-tune','animation','-pix_fmt','yuv420p','-profile:v','high','-c:a','aac','-b:a','256k','-shortest','-movflags','+faststart','hyperlearn-demo.mp4'],{stdio:'inherit'});
console.log('done');
