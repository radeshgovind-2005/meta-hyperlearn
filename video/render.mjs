import { chromium } from '@playwright/test';
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const [mode='stills', ...ts] = process.argv.slice(2);
const FPS=30, DUR=20.6;
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1920,height:1080}});
await page.goto('file://'+process.cwd()+'/intro.html');
await page.evaluate(()=>window.ready); await page.waitForTimeout(800);
if(mode==='stills'){ await mkdir('stills',{recursive:true});
  for(const t of ts){ await page.evaluate(t=>seek(t),+t); await page.screenshot({path:`stills/t${t}.jpg`,type:'jpeg',quality:80}); } }
else { await rm('frames',{recursive:true,force:true}); await mkdir('frames');
  const N=Math.round(DUR*FPS);
  for(let i=0;i<N;i++){ await page.evaluate(t=>seek(t),i/FPS); await page.screenshot({path:`frames/${String(i).padStart(5,'0')}.png`}); if(i%60===0)console.log('frame',i,'/',N); }
  await browser.close();
  execFileSync('ffmpeg',['-y','-loglevel','error','-framerate',String(FPS),'-i','frames/%05d.png','-i','audio/intro.mp3','-af','adelay=0|0,apad','-t',String(DUR),'-c:v','libx264','-preset','slow','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','hyperlearn-intro.mp4'],{stdio:'inherit'});
  console.log('wrote hyperlearn-intro.mp4'); process.exit(0); }
await browser.close();
