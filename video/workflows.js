// Five workflow animations for the system scene, one at a time, driven by wfAnim(l) with l = seconds into the scene.
(() => {
const NS='http://www.w3.org/2000/svg';
const AT=[14.34,15.92,17.50,18.85,20.38], END=22.2;
const NAMES=['Multimodal ingestion','Curriculum synthesis','Content mutation','Adaptive remediation','Intent routing'];
const root=$('wfx');
const h=(tag,css,html='',parent=root)=>{const e=document.createElement(tag);e.style.cssText='position:absolute;'+css;e.innerHTML=html;parent.appendChild(e);return e};
const sv=(parent,w,hh,css='')=>{const s=document.createElementNS(NS,'svg');s.setAttribute('width',w);s.setAttribute('height',hh);s.style.cssText='position:absolute;left:0;top:0;overflow:visible;'+css;parent.appendChild(s);return s};
const path=(s,d,stroke,w=3,extra={})=>{const p=document.createElementNS(NS,'path');p.setAttribute('d',d);p.setAttribute('fill','none');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width',w);p.setAttribute('stroke-linecap','round');for(const a in extra)p.setAttribute(a,extra[a]);s.appendChild(p);return p};
const circ=(s,r,fill)=>{const c=document.createElementNS(NS,'circle');c.setAttribute('r',r);c.setAttribute('fill',fill);s.appendChild(c);return c};
const card='background:#fff;border:1.5px solid #E3E6EA;border-radius:18px;';
const draw=(p,f)=>{const L=p.__len??(p.__len=p.getTotalLength());p.style.strokeDasharray=L;p.style.strokeDashoffset=L*(1-f)};
const along=(p,f)=>{const L=p.__len??(p.__len=p.getTotalLength());return p.getPointAtLength(L*f)};

// progress row: names stay on screen
const seg=NAMES.map((n,i)=>{const s=h('div',`left:${100+i*348}px;top:258px;width:324px;opacity:0`);
  const bar=h('div','left:0;top:0;width:324px;height:5px;border-radius:5px;background:#E3E6EA;overflow:hidden','',s);
  const fill=h('div','left:0;top:0;height:5px;width:0;background:#0A5CFF','',bar);
  const lab=h('div','left:0;top:20px;white-space:nowrap;font-size:23px;font-weight:700;letter-spacing:-.01em',`<span class="mono" style="font-size:18px;margin-right:10px;font-weight:600">0${i+1}</span>${n}`,s);
  return {s,fill,lab}});

const stages=NAMES.map(()=>h('div','left:0;top:0;width:1920px;height:1080px;opacity:0'));

// ---- 01 ingestion: sources flow into HyperLearn and come out as cited chunks
const A=stages[0], aS=sv(A,1920,1080);
const icons={
 slides:'<svg width="70" height="56"><rect x="3" y="6" width="64" height="44" rx="6" fill="#fff" stroke="#1C2B33" stroke-width="3"/><rect x="3" y="6" width="64" height="12" rx="6" fill="#0A5CFF"/><rect x="12" y="26" width="34" height="5" rx="2.5" fill="#C2CAD2"/><rect x="12" y="36" width="24" height="5" rx="2.5" fill="#C2CAD2"/></svg>',
 paper:'<svg width="70" height="64"><path d="M14 4 H46 L58 16 V60 H14 Z" fill="#fff" stroke="#1C2B33" stroke-width="3" stroke-linejoin="round"/><path d="M46 4 V16 H58" fill="none" stroke="#1C2B33" stroke-width="3"/><rect x="22" y="26" width="28" height="4" rx="2" fill="#C2CAD2"/><rect x="22" y="35" width="28" height="4" rx="2" fill="#C2CAD2"/><rect x="22" y="44" width="18" height="4" rx="2" fill="#C2CAD2"/></svg>',
 audio:'<svg width="70" height="56">'+[10,22,36,18,44,28,14,32,20].map((v,i)=>`<rect x="${6+i*7}" y="${28-v/2}" width="4" height="${v}" rx="2" fill="#0A5CFF"/>`).join('')+'</svg>',
 exam:'<svg width="70" height="64"><rect x="14" y="4" width="44" height="56" rx="5" fill="#fff" stroke="#1C2B33" stroke-width="3"/><rect x="21" y="14" width="9" height="9" rx="2" fill="none" stroke="#A14D00" stroke-width="2.5"/><rect x="34" y="16" width="17" height="4" rx="2" fill="#C2CAD2"/><rect x="21" y="30" width="9" height="9" rx="2" fill="none" stroke="#A14D00" stroke-width="2.5"/><rect x="34" y="32" width="17" height="4" rx="2" fill="#C2CAD2"/><rect x="21" y="46" width="30" height="4" rx="2" fill="#C2CAD2"/></svg>'};
const tiles=[['slides','Slides'],['paper','Papers'],['audio','Recordings'],['exam','Past exams']].map(([ic,lab],i)=>h('div',`${card}left:300px;top:${372+i*140}px;width:290px;height:116px;white-space:nowrap;display:flex;align-items:center;gap:18px;padding:0 22px;font-size:25px;font-weight:700;opacity:0`,`<div style="position:static;width:70px;display:flex;justify-content:center">${icons[ic]}</div>${lab}`,A));
const hub=h('div','left:865px;top:531px;width:190px;height:190px;border-radius:50%;background:#fff;border:3px solid #0A5CFF;display:flex;align-items:center;justify-content:center;opacity:0','<img src="../design/assets/icon.png" style="position:static;width:104px">',A);
const ring=h('div','left:865px;top:531px;width:190px;height:190px;border-radius:50%;border:3px solid #0A5CFF;opacity:0','',A);
const inL=tiles.map((_,i)=>path(aS,`M590 ${430+i*140} C 740 ${430+i*140}, 720 626, 865 626`,'#C9D3DD',3));
const CH=['p.6 · page region','p.13 · page region','0:04–0:35 · audio','Q3 · exam style','p.2 · figure'];
const outL=CH.map((_,j)=>path(aS,`M1055 626 C 1200 626, 1200 ${432+j*96}, 1330 ${432+j*96}`,'#BCD2FF',3));
const chunks=CH.map((c,j)=>h('div',`${card}left:1330px;top:${400+j*96}px;width:380px;height:64px;border-radius:14px;display:flex;align-items:center;gap:14px;padding:0 20px;opacity:0`,`<i style="position:static;width:12px;height:12px;border-radius:50%;background:#0A5CFF;display:block"></i><span class="mono" style="font-size:20px;color:#1C2B33">${c}</span>`,A));
const dotsIn=inL.map(()=>[circ(aS,6,'#0A5CFF'),circ(aS,6,'#0A5CFF')]), dotsOut=outL.map(()=>circ(aS,5,'#0A5CFF'));
function ingest(l,a){
  tiles.forEach((t,i)=>{const p=k(l,a-.15+i*.07,a+.35+i*.07,E.expo);place(t,{opacity:p,transform:`translateX(${(1-p)*-60}px)`})});
  const hp=k(l,a,a+.45,E.expo);place(hub,{opacity:hp,transform:`scale(${lerp(.7,1,hp)})`});
  const rp=((l-a)*1.1)%1;place(ring,{opacity:l>a+.3?(1-rp)*.5:0,transform:`scale(${1+rp*.45})`});
  inL.forEach((p,i)=>{draw(p,k(l,a+.1+i*.05,a+.5+i*.05,E.inOut));dotsIn[i].forEach((d,n)=>{const f=((l-a-.4)*1.4+i*.17+n*.5)%1;const on=l>a+.4;const pt=along(p,Math.max(0,f));d.setAttribute('cx',pt.x);d.setAttribute('cy',pt.y);d.setAttribute('opacity',on?Math.sin(Math.PI*f):0)})});
  outL.forEach((p,j)=>{draw(p,k(l,a+.4+j*.06,a+.8+j*.06,E.inOut));const f=((l-a-.8)*1.2+j*.21)%1;const pt=along(p,Math.max(0,f));dotsOut[j].setAttribute('cx',pt.x);dotsOut[j].setAttribute('cy',pt.y);dotsOut[j].setAttribute('opacity',l>a+.8?Math.sin(Math.PI*f):0)});
  chunks.forEach((c,j)=>{const p=k(l,a+.55+j*.08,a+.95+j*.08,E.expo);place(c,{opacity:p,transform:`translateX(${(1-p)*40}px)`})});
}
// ---- 02 synthesis: cited chunks assemble into a course outline
const B=stages[1];
const bChunks=CH.map((c,j)=>h('div',`${card}left:300px;top:${420+j*92}px;width:360px;height:62px;border-radius:14px;display:flex;align-items:center;gap:14px;padding:0 20px`,`<i style="position:static;width:12px;height:12px;border-radius:50%;background:#0A5CFF;display:block"></i><span class="mono" style="font-size:19px">${c}</span>`,B));
const oc=h('div',`${card}left:820px;top:350px;width:800px;height:620px;border-radius:24px;box-shadow:0 24px 60px rgba(28,43,51,.08);opacity:0`,'',B);
h('div','left:40px;top:34px;font-size:34px;font-weight:700;letter-spacing:-.02em','Linear Algebra, MAT201',oc);
h('div','left:40px;top:84px;font-size:20px;color:#5B6B7A','Built from 4 sources · every line cited',oc);
const ROWS=[['ch','Lecture 6 — Determinants'],['1.1','Computing the 2x2 Determinant','p.1'],['1.2','Area Scaling and Zero Determinant','p.3'],['1.3','Determinants with a Variable','p.6'],['ch','Lecture 7 — Eigenvectors and Eigenvalues'],['2.1','What Eigenvectors Are','0:04'],['2.2','Finding Eigenvalues','p.11']];
let ry=140;const rows=ROWS.map(r=>{let e;if(r[0]==='ch'){e=h('div',`left:40px;top:${ry+8}px;font-size:18px;font-weight:600;color:#5B6B7A`,r[1],oc);ry+=44}else{e=h('div',`left:40px;top:${ry}px;width:720px;height:56px;border:1px solid #E3E6EA;border-radius:12px;display:flex;align-items:center;gap:16px;padding:0 18px;font-size:21px`,`<span style="position:static;color:#5B6B7A;width:34px">${r[0]}</span><span style="position:static;flex:1">${r[1]}</span><span class="mono" style="position:static;font-size:16px;color:#0A5CFF;background:#EAF1FF;border-radius:999px;padding:4px 12px">${r[2]}</span>`,oc);ry+=66}return e});
function synth(l,b){
  const cp=k(l,b-.15,b+.35,E.expo);place(oc,{opacity:cp,transform:`translateY(${(1-cp)*30}px)`});
  bChunks.forEach((c,j)=>{const f=k(l,b+.15+j*.09,b+.6+j*.09,E.inOut);place(c,{opacity:1-f,transform:`translateX(${f*520}px) scale(${1-f*.2})`})});
  rows.forEach((r,i)=>{const p=k(l,b+.3+i*.1,b+.7+i*.1,E.expo);place(r,{opacity:p,transform:`translateY(${(1-p)*16}px)`})});
}
// ---- 03 mutation: one block is replaced, one is inserted, the rest stay byte-identical
const C=stages[2];
const BLK=[['figure',0],['text',3],['text',3,'c'],['widget',0,'n'],['text',2],['widget',0],['exercise',2]];
const bars=n=>Array.from({length:n},(_,i)=>`<i style="position:static;display:block;height:8px;border-radius:4px;background:#D9DFE5;width:${[260,300,200][i%3]}px;margin:5px 0"></i>`).join('');
const mini='<svg width="300" height="110" style="position:static"><path d="M10 96 H290 M10 96 V8" stroke="#C2CAD2" stroke-width="2"/><path d="M14 20 Q 150 170 286 20" fill="none" stroke="#0A5CFF" stroke-width="4"/><circle id="mdot" r="7" fill="#1C2B33" cx="150" cy="58"/></svg>';
const blks=BLK.map(([kind,nb,f])=>{const e=h('div',`${card}left:640px;width:560px;border-radius:14px;overflow:hidden;display:flex;align-items:center;gap:22px;padding:0 22px;opacity:0`,`<b style="position:static;font-size:21px;width:96px">${kind}</b><div class="body" style="position:static">${f==='n'?mini:nb?bars(Math.min(nb,2)):'<i style="position:static;display:block;width:120px;height:34px;border-radius:6px;background:#EEF1F4"></i>'}</div>`,C);
  const tag=h('div',`left:1230px;font-size:19px;font-weight:600;padding:6px 16px;border-radius:999px;opacity:0;${f?'background:#EAF1FF;color:#0A5CFF':'background:#E7F4EC;color:#0A7A3D'}`,f==='c'?'replace':f==='n'?'insertAfter':'unchanged',C);return {e,tag,f}});
function mutate(l,c){
  let y=372;
  blks.forEach((b,i)=>{let hh=b.f==='n'?150*k(l,c+.55,c+.95,E.expo):58;const p=b.f==='n'?k(l,c+.6,c+.9):k(l,c-.15+i*.05,c+.3+i*.05,E.expo);
    let sy=1;if(b.f==='c'){const fl=k(l,c+.3,c+.62,E.inOut);sy=Math.abs(Math.cos(Math.PI*fl));if(fl>.5){b.e.querySelectorAll('.body i').forEach(x=>x.style.background='#9DBBFF');b.e.querySelector('b').textContent='text';}else{b.e.querySelectorAll('.body i').forEach(x=>x.style.background='#D9DFE5')}}
    const hot=b.f&&l>=c+(b.f==='c'?.25:.6);
    place(b.e,{top:y+'px',height:hh+'px',opacity:p,transform:`scaleY(${sy})`,borderColor:hot?'#0A5CFF':'#E3E6EA',background:hot?'#F5F8FF':'#fff'});
    place(b.tag,{top:y+hh/2-17+'px',opacity:b.f?k(l,c+(b.f==='c'?.45:.85),c+(b.f==='c'?.75:1.1)):k(l,c+.95+i*.04,c+1.2+i*.04)});
    y+=hh+(b.f==='n'?14*k(l,c+.55,c+.95):14)});
  const md=document.getElementById('mdot');if(md){const u=.5+.42*Math.sin((l-c)*3),v=1-u;md.setAttribute('cx',v*v*14+2*v*u*150+u*u*286);md.setAttribute('cy',v*v*20+2*v*u*170+u*u*20)}
}
// ---- 04 remediation: a wrong answer inserts a review into the path
const D=stages[3], dS=sv(D,1920,1080);
const X0=[430,650,870,1090,1310], NL=['1.1','1.2','1.3','2.1','2.2'];
const track=path(dS,'M430 660 L1530 660','#E3E6EA',6), done=path(dS,'M430 660 L650 660','#0A7A3D',6);
const nodes=X0.map((x,i)=>{const e=h('div',`left:0;top:636px;width:48px;height:48px;border-radius:50%;border:4px solid ${i<2?'#0A7A3D':i===2?'#0A5CFF':'#AEB8C2'};background:${i<2?'#0A7A3D':'#fff'};opacity:0`,'',D);const lab=h('div','top:704px;width:120px;text-align:center;font-size:24px;font-weight:700;opacity:0',NL[i],D);return {e,lab}});
const quiz=h('div',`${card}top:430px;width:300px;height:132px;padding:22px 26px;opacity:0;box-shadow:0 18px 40px rgba(28,43,51,.08)`,'<div style="position:static;font-size:18px;color:#5B6B7A">Practice · exam style</div><div style="position:static;margin-top:10px;font-size:30px;font-weight:800;color:#A14D00">✕ Not quite</div>',D);
const rev=h('div','left:846px;top:636px;width:48px;height:48px;border-radius:50%;border:4px solid #A14D00;background:#fff;opacity:0','',D);
const revL=h('div','left:780px;top:704px;width:180px;text-align:center;font-size:24px;font-weight:700;color:#A14D00;opacity:0','Review<div style="position:static;font-size:18px;font-weight:500;margin-top:4px">added for you</div>',D);
function remed(l,d){
  const sh=k(l,d+.5,d+.9,E.inOut);
  draw(track,k(l,d-.15,d+.35,E.inOut));
  nodes.forEach((n,i)=>{const x=X0[i]+(i>=2?220*sh:0),p=k(l,d-.1+i*.06,d+.3+i*.06,E.expo);place(n.e,{left:x-24+'px',opacity:p,transform:`scale(${lerp(.5,1,p)})`});place(n.lab,{left:x-60+'px',opacity:p})});
  done.style.opacity=k(l,d+.1,d+.3);
  const q=k(l,d+.12,d+.42,E.expo);place(quiz,{left:X0[2]+220*sh-150+'px',opacity:q,transform:`translateY(${(1-q)*20}px)`});
  const r=k(l,d+.7,d+1.0,E.expo);place(rev,{opacity:r,transform:`scale(${lerp(.3,1,r)})`});place(revL,{opacity:k(l,d+.8,d+1.1)});
}
// ---- 05 routing: one command bar, the same tools as the UI
const F=stages[4], fS=sv(F,1920,1080);
const cmd=h('div',`${card}left:410px;top:400px;width:1100px;height:92px;border-radius:999px;display:flex;align-items:center;gap:18px;padding:0 20px 0 30px;opacity:0;box-shadow:0 18px 40px rgba(28,43,51,.08)`,'<span class="mono" style="position:static;border:1.5px solid #D4D9DE;border-radius:8px;padding:2px 10px;font-size:20px;color:#5B6B7A">/</span><span id="cmdt" style="position:static;flex:1;font-size:30px;font-family:\'Source Serif 4\',Georgia,serif"></span><span style="position:static;width:56px;height:56px;border-radius:50%;background:#0A5CFF;display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:700">↑</span>',F);
const TOOLS=['navigate','mutateBlock','addExercises','makeWidget','share','fork'], TX=[330,580,830,1090,1340,1590];
const tl=TOOLS.map((_,i)=>path(fS,`M960 492 C 960 620, ${TX[i]} 620, ${TX[i]} 736`,'#D4D9DE',3));
const tc=TOOLS.map((t,i)=>h('div',`${card}top:736px;height:64px;border-radius:999px;display:flex;align-items:center;padding:0 24px;opacity:0`,`<span class="mono" style="position:static;font-size:22px;font-weight:600">${t}</span>`,F));
const PICK=[1,3], TEXT='Simplify this and give me an example';
function route(l,e){
  const p=k(l,e-.15,e+.3,E.expo);place(cmd,{opacity:p,transform:`translateY(${(1-p)*20}px)`});
  const n=Math.round(TEXT.length*k(l,e+.05,e+.8));document.getElementById('cmdt').innerHTML=TEXT.slice(0,n)+(l<e+1.2&&Math.floor(l*3)%2?'<span style="color:#0A5CFF">|</span>':'');
  const pick=l>=e+.95;
  tl.forEach((pth,i)=>{draw(pth,k(l,e+.2+i*.04,e+.6+i*.04,E.inOut));pth.setAttribute('stroke',pick&&PICK.includes(i)?'#0A5CFF':'#D4D9DE');pth.setAttribute('stroke-width',pick&&PICK.includes(i)?4:3)});
  tc.forEach((c,i)=>{const q=k(l,e+.35+i*.05,e+.7+i*.05,E.expo),on=pick&&PICK.includes(i);place(c,{left:TX[i]-c.offsetWidth/2+'px',opacity:q*(pick&&!on?.55:1),borderColor:on?'#0A5CFF':'#E3E6EA',background:on?'#EAF1FF':'#fff',color:on?'#0A5CFF':'#1C2B33',transform:`translateY(${(1-q)*16}px)`})});
}
const runs=[ingest,synth,mutate,remed,route];
window.wfAnim=l=>{
  const out=k(l,END,END+.35,E.inOut);
  seg.forEach((g,i)=>{const p=k(l,11.9+i*.12,12.4+i*.12,E.expo),nx=i<4?AT[i+1]:END;
    place(g.s,{opacity:p*(1-out),transform:`translateY(${(1-p)*14}px)`});
    g.fill.style.width=324*k(l,AT[i],nx)+'px';
    g.lab.style.color=l>=AT[i]&&l<nx?'#1C2B33':l>=nx?'#5B6B7A':'#C2CAD2'});
  stages.forEach((s,i)=>{const a=AT[i],nx=i<4?AT[i+1]:END;const v=k(l,a-.2,a+.15)*(1-k(l,nx-.2,nx+.1));
    s.style.display=v>0?'block':'none';s.style.opacity=v;if(v>0)runs[i](l,a)});
};
})();
