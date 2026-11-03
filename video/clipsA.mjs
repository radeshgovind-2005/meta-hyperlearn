import { open, recorder, course, origin } from './lib.mjs';
const {page,api,close}=await open();
const wait=ms=>page.waitForTimeout(ms);
const smooth=async(dy,ms)=>{const n=Math.round(ms/16);for(let i=0;i<n;i++){await page.mouse.wheel(0,dy/n);await wait(16)}};
const glide=async(loc,ms=700)=>{const b=await loc.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:Math.round(ms/16)})};
try{
  const list=await api('GET','/api/courses'); const mine=(list.items??list.courses??list).find?.(c=>/Linear Algebra/.test(c.title)&&c.role==='owner'); console.log('own LA course', mine?.id, JSON.stringify(list).slice(0,300));
  await page.goto(`${origin}/courses/${course}`); await wait(4000);
  let t=await recorder(page,'tour'); await page.mouse.move(700,450); await wait(1500); t.mark('outline');
  await glide(page.locator('.btn-primary').filter({hasText:'Continue'}).first()); await wait(300); await page.locator('.btn-primary').filter({hasText:'Continue'}).first().click();
  await page.locator('.para').first().waitFor(); await wait(2500); t.mark('reader');
  await page.mouse.move(720,500,{steps:20}); await smooth(1400,5000); await wait(1200); await smooth(1200,4500); await wait(1500); t.mark('end'); await t.stop();
  // B: sources and citations
  await page.goto(`${origin}/library`); await wait(4000);
  let r=await recorder(page,'sources'); await page.mouse.move(600,300); await wait(800);
  const rows=page.locator('tbody tr'); console.log('rows',await rows.count()); await glide(rows.nth(0),700); await wait(500); await glide(rows.nth(2),900); await wait(1600); r.mark('library');
  await page.goto(`${origin}/courses/${course}/s/sec_r1zo7e6vta`); await page.locator('.para').first().waitFor(); await wait(2500); r.mark('reader');
  const cl=page.locator('.cite-link').nth(1); await cl.scrollIntoViewIfNeeded(); await wait(600); await glide(cl,800); await wait(300); await cl.click(); await wait(3500); r.mark('pagecite');
  await page.goto(`${origin}/courses/${course}/s/sec_382d265ked`); await page.locator('.para').first().waitFor(); await wait(2000); r.mark('audioreader');
  const ids=await page.locator('.cite-link').evaluateAll(es=>es.map(e=>e.textContent)); console.log('cites',ids);
  const al=page.locator('.cite-link').first(); await glide(al,800); await wait(300); await al.click(); await wait(1500); r.mark('audiocite');
  const play=page.getByRole('button',{name:/Play|Listen/}).last(); if(await play.count()){await glide(play,500); await play.click().catch(()=>{});} await wait(4000); r.mark('end'); await r.stop();
  await page.screenshot({path:'video/shots/audio-end.png'});
  // F: share dialog on own copy
  if(mine){ await page.goto(`${origin}/courses/${mine.id}`); await wait(4000);
    r=await recorder(page,'share'); await wait(800); const sb=page.getByRole('button',{name:'Share'}).first(); await glide(sb,700); await sb.click(); await wait(1800); r.mark('dialog');
    const cp=page.getByText('Make their own copy'); await glide(cp,700); await cp.click(); await wait(1500); r.mark('copy');
    const fo=page.getByText('Follow your course'); await glide(fo,700); await fo.click(); await wait(1800); r.mark('end'); await r.stop(); }
} finally { await close(); }
