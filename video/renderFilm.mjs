import { chromium } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const [mode='stills', ...args] = process.argv.slice(2);
const FPS=30;
async function openPage(browser){ const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',e=>console.log('pageerror',e.message));
  await page.goto('file://'+process.cwd()+'/film.html'); await page.evaluate(()=>window.ready); await page.waitForTimeout(500); return page; }
const shot=async(page,t,path,type='png')=>{ await page.evaluate(async t=>{await seek(t);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))},t); await page.screenshot({path,type,...(type==='jpeg'?{quality:80}:{})}); };
const browser=await chromium.launch({channel:'chrome'});
if(mode==='stills'){ await mkdir('stills',{recursive:true}); const page=await openPage(browser);
  for(const t of args) await shot(page,+t,`stills/f${t}.jpg`,'jpeg'); await browser.close(); }
else { const W=+(args[0]||5); const page0=await openPage(browser); const DUR=await page0.evaluate(()=>window.DUR); await page0.close();
  const N=Math.round(DUR*FPS); await rm('frames',{recursive:true,force:true}); await mkdir('frames');
  const per=Math.ceil(N/W); let done=0;
  await Promise.all([...Array(W)].map(async(_,w)=>{ const page=await openPage(browser);
    for(let i=w*per;i<Math.min(N,(w+1)*per);i++){ await shot(page,i/FPS,`frames/${String(i).padStart(5,'0')}.png`); if(++done%300===0)console.log('frames',done,'/',N); } await page.close(); }));
  await browser.close();
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i','frames/%05d.png','-i','audio/narration.wav','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','hyperlearn-demo.mp4'],{stdio:'inherit'});
  console.log('wrote hyperlearn-demo.mp4'); }
