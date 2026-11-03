import { open, recorder, course, origin } from './lib.mjs';
const {page,api,close}=await open();
const wait=ms=>page.waitForTimeout(ms);
const smooth=async(dy,ms)=>{const n=Math.round(ms/16);for(let i=0;i<n;i++){await page.mouse.wheel(0,dy/n);await wait(16)}};
const glide=async(loc,ms=700)=>{const b=await loc.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:Math.round(ms/16)})};
const sid='sec_r1zo7e6vta';
try{
  await page.goto(`${origin}/courses/${course}/s/${sid}`); await page.locator('.para').first().waitFor(); await wait(3000);
  const p=page.locator('.para').nth(1); await p.scrollIntoViewIfNeeded(); await page.evaluate(()=>scrollBy(0,-160)); await wait(800);
  const r=await recorder(page,'mutate'); await page.mouse.move(900,250); await wait(900);
  await glide(p,800); await wait(700); const cb=p.getByRole('button',{name:'Change this'}); await glide(cb,500); await cb.click(); await wait(700); r.mark('box');
  await page.locator('#ask').pressSequentially('This is too complex. Simplify it and give me an interactive example.',{delay:38}); await wait(600); r.mark('typed');
  const go=page.getByRole('button',{name:'Change it'}); await glide(go,600); await go.click(); r.mark('submitted');
  await page.locator('.trace-list').waitFor({timeout:60000}); r.mark('trace');
  await page.getByText('Changed just now').waitFor({timeout:420000}); r.mark('changed'); await wait(2500);
  // look at the result and the widget
  const w=page.locator('.widget-card').first();
  if(await w.count()){ await w.scrollIntoViewIfNeeded(); await page.evaluate(()=>scrollBy(0,-140)); await wait(1500); r.mark('widget');
    const s=w.locator('input[type=range]').first();
    if(await s.count()){ const b=await s.boundingBox(); await page.mouse.move(b.x+b.width*0.3,b.y+b.height/2,{steps:30}); await page.mouse.down(); for(let i=0;i<=60;i++){await page.mouse.move(b.x+b.width*(0.3+0.6*Math.sin(Math.PI*i/60)),b.y+b.height/2);await wait(40)} await page.mouse.up(); }
    await wait(1200); r.mark('dragged'); }
  const how=page.getByText('How this was decided').first();
  if(await how.count()){ await how.scrollIntoViewIfNeeded(); await page.evaluate(()=>scrollBy(0,200)); await wait(700); await glide(how,600); await how.click(); await wait(2500); r.mark('howopen'); await smooth(300,1500); await wait(2000); }
  const undo=page.getByRole('button',{name:'Undo'}).first();
  if(await undo.count()){ await undo.scrollIntoViewIfNeeded(); await wait(800); r.mark('undo'); await glide(undo,600); await undo.click(); await wait(4000); r.mark('undone'); }
  await r.stop(); await page.screenshot({path:'video/shots/mutate-end.png'});
} finally {
  console.log('cleanup overlay', JSON.stringify(await api('DELETE',`/api/courses/${course}/overlay/${sid}`)).slice(0,120));
  const d=await api('GET',`/api/courses/${course}/sections/${sid}`); console.log('overlay now', d.section.overlay);
  await close();
}
