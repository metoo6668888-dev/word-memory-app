(() => {
  const KEY = 'wordMemoryApp.v3';
  const OLD_KEYS = ['wordMemoryApp.v2','wordMemoryApp.v1'];
  const DAY = 24*60*60*1000;
  const HOUR = 60*60*1000;
  const DEFAULT_PLAN = [10*60*1000, 1*DAY, 2*DAY, 4*DAY, 7*DAY, 15*DAY, 30*DAY];
  const PRESETS = {
    classic:[10*60*1000,1*DAY,2*DAY,4*DAY,7*DAY,15*DAY,30*DAY],
    intensive:[5*60*1000,30*60*1000,6*HOUR,1*DAY,3*DAY,7*DAY,14*DAY,30*DAY],
    light:[1*HOUR,1*DAY,3*DAY,7*DAY,14*DAY,30*DAY]
  };
  let state = load();
  let sessionQueue = [];
  let sessionTotal = 0;
  let sessionDone = 0;
  let current = null;
  let revealed = false;
  let currentMode = 'en2zh';

  // PWA install / standalone mode
  let deferredInstallPrompt = null;
  const installBar = document.getElementById('installBar');
  const installBtn = document.getElementById('installBtn');
  const installHelpBtn = document.getElementById('installHelpBtn');
  const installTip = document.getElementById('installTip');
  const installedBadge = document.getElementById('installedBadge');
  const installTitle = document.getElementById('installTitle');
  const installDesc = document.getElementById('installDesc');
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  function updateInstallUI(){
    if(isStandalone()){
      installBtn.classList.add('install-hidden'); installHelpBtn.classList.add('install-hidden'); installedBadge.classList.remove('install-hidden'); installTip.classList.add('install-hidden');
      installTitle.textContent='✅ 单词砍砍乐已安装'; installDesc.textContent='当前正以独立 App 模式运行，可直接从桌面图标进入。';
      return;
    }
    installedBadge.classList.add('install-hidden');
    if(deferredInstallPrompt){ installBtn.classList.remove('install-hidden'); installHelpBtn.classList.add('install-hidden'); installTip.classList.add('install-hidden'); return; }
    installBtn.classList.add('install-hidden'); installHelpBtn.classList.remove('install-hidden');
    installDesc.textContent=isIOS?'iPhone / iPad 通过 Safari 的“添加到主屏幕”安装，安装后直接从桌面图标启动。':'通过支持 PWA 的浏览器完成一次安装，之后直接从桌面图标启动，不必再次打开浏览器。';
  }
  function showInstallHelp(){
    installTip.classList.remove('install-hidden');
    installTip.innerHTML = isIOS
      ? '<b>iPhone / iPad：</b>请用 Safari 打开本页面 → 点“分享”按钮 → 选择“添加到主屏幕” → 点“添加”。以后直接点桌面上的“单词砍砍乐”。'
      : '<b>Android：</b>打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。安装后可直接从桌面图标进入，页面会以独立 App 窗口显示。';
  }
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstallPrompt=e; updateInstallUI(); });
  window.addEventListener('appinstalled', ()=>{ deferredInstallPrompt=null; updateInstallUI(); });
  installBtn?.addEventListener('click', async()=>{ if(!deferredInstallPrompt){ showInstallHelp(); return; } deferredInstallPrompt.prompt(); try{ await deferredInstallPrompt.userChoice; }catch(e){} deferredInstallPrompt=null; updateInstallUI(); });
  installHelpBtn?.addEventListener('click', showInstallHelp);
  updateInstallUI();
  if('serviceWorker' in navigator){ window.addEventListener('load', ()=>navigator.serviceWorker.register('./sw.js').catch(()=>{})); }


  function defaultSettings(){ return {studyMode:'mixed', reviewPlan:[...DEFAULT_PLAN], dailyLimit:0, newDailyLimit:0, requireBothDirections:true}; }
  function defaultState(){ return {words:[], settings:defaultSettings(), meta:{createdAt:Date.now()}} }
  function normalizeSettings(x={}){
    const d=defaultSettings();
    const studyMode=['mixed','en2zh','zh2en'].includes(x.studyMode)?x.studyMode:(['mixed','en2zh','zh2en'].includes(x.mode)?x.mode:d.studyMode);
    const reviewPlan=Array.isArray(x.reviewPlan)&&x.reviewPlan.length?x.reviewPlan.map(Number).filter(v=>Number.isFinite(v)&&v>=60000):[...DEFAULT_PLAN];
    return {...d,...x,studyMode,reviewPlan,dailyLimit:Math.max(0,Number(x.dailyLimit)||0),newDailyLimit:Math.max(0,Number(x.newDailyLimit)||0),requireBothDirections:x.requireBothDirections!==false};
  }
  function load(){
    try{
      let raw=localStorage.getItem(KEY);
      if(!raw){ for(const k of OLD_KEYS){ raw=localStorage.getItem(k); if(raw) break; } }
      const st=raw?JSON.parse(raw):defaultState();
      if(!Array.isArray(st.words)) st.words=[];
      st.settings=normalizeSettings(st.settings||{});
      st.words=st.words.map(migrateWord);
      return st;
    }catch(e){ return defaultState(); }
  }
  function migrateWord(w){
    w={...w};
    if(!Array.isArray(w.senses)||!w.senses.length){ w.senses=w.zh?[{pos:'',abbr:'',zh:w.zh,definitionEn:''}]:[]; }
    w.phonetic=w.phonetic||''; w.audio=w.audio||''; w.example=w.example||''; w.exampleZh=w.exampleZh||''; w.source=w.source||'legacy';
    w.zh=w.zh||meaningText(w);
    w.directionStats=w.directionStats||{en2zh:{correct:0,wrong:0,streak:0},zh2en:{correct:0,wrong:0,streak:0}};
    for(const m of ['en2zh','zh2en']) w.directionStats[m]={correct:0,wrong:0,streak:0,...(w.directionStats[m]||{})};
    w.stagePass={en2zh:false,zh2en:false,...(w.stagePass||{})};
    w.lastDirection=w.lastDirection||'';
    w.stage=Math.max(0,Number(w.stage)||0);
    return w;
  }
  function save(){ localStorage.setItem(KEY, JSON.stringify(state)); renderAll(); }
  function id(){ return crypto?.randomUUID ? crypto.randomUUID() : 'w'+Date.now()+Math.random().toString(16).slice(2); }
  function esc(s=''){ return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function now(){ return Date.now(); }
  function getPlan(){ return (state?.settings?.reviewPlan?.length?state.settings.reviewPlan:DEFAULT_PLAN).map(Number); }
  function labelInterval(ms){
    ms=Math.max(60000,Number(ms)||60000);
    if(ms%DAY===0) return (ms/DAY)+'天';
    if(ms%HOUR===0) return (ms/HOUR)+'小时';
    return Math.round(ms/60000)+'分钟';
  }
  function toEditorInterval(ms){ if(ms%DAY===0) return [ms/DAY,'d']; if(ms%HOUR===0) return [ms/HOUR,'h']; return [Math.max(1,Math.round(ms/60000)),'m']; }
  function fromEditorInterval(v,u){ v=Math.max(1,Number(v)||1); return v*(u==='d'?DAY:u==='h'?HOUR:60000); }
  function fmt(ts){ if(!ts) return '现在'; const d=new Date(ts), diff=ts-now(); if(diff<=0) return '已到期'; if(diff<60*60*1000) return Math.ceil(diff/60000)+' 分钟后'; if(diff<DAY) return Math.ceil(diff/3600000)+' 小时后'; return d.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})+' '+d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}); }
  function status(w){ if(w.mastered) return 'mastered'; if((w.nextReview||0)<=now()) return 'due'; if(w.chopped) return 'chopped'; if((w.stage||0)===0 && (w.reviewCount||0)===0) return 'new'; return 'learning'; }
  function statusLabel(s){ return ({mastered:'完全掌握',chopped:'已砍掉·待巩固',due:'待复习',new:'新词',learning:'学习中'})[s]; }
  const POS_ABBR={noun:'n.',verb:'v.',adjective:'adj.',adverb:'adv.',pronoun:'pron.',preposition:'prep.',conjunction:'conj.',interjection:'int.',exclamation:'int.',determiner:'det.',article:'art.',numeral:'num.',phrase:'phr.','auxiliary verb':'aux.','modal verb':'modal.'};
  function posAbbr(pos=''){ const p=String(pos).toLowerCase().trim(); return POS_ABBR[p]|| (p?p.replace(/\s+/g,' ').slice(0,7)+'.':''); }
  function meaningText(w){
    if(Array.isArray(w?.senses)&&w.senses.length) return w.senses.map(x=>`${x.abbr||posAbbr(x.pos)} ${x.zh||''}`.trim()).filter(Boolean).join('  ');
    return w?.zh||'';
  }
  function renderSenses(w){
    const senses=Array.isArray(w.senses)&&w.senses.length?w.senses:[{pos:'',abbr:'',zh:w.zh||''}];
    return senses.map(x=>`<div class="posline"><span class="posbadge">${esc(x.abbr||posAbbr(x.pos)||'释义')}</span><span class="gloss">${esc(x.zh||'')}</span></div>`).join('');
  }
  function smartAnswerHtml(w,showWord=false){
    const head=showWord?`<div style="font-size:28px;font-weight:850;margin-bottom:4px">${esc(w.en)}</div>`:'';
    const phon=w.phonetic?`<div class="phonetic">/${esc(String(w.phonetic).replace(/^\/|\/$/g,''))}/</div>`:'';
    const ex=w.example?`<div class="examplebox"><div class="example-en"><b>例句：</b>${esc(w.example)}</div>${w.exampleZh?`<div class="example-zh">${esc(w.exampleZh)}</div>`:''}</div>`:'';
    return `${head}${phon}${renderSenses(w)}${ex}`;
  }
  function dueWords(){ return state.words.filter(w => !w.mastered && (w.nextReview||0)<=now()).sort((a,b)=>(a.nextReview||0)-(b.nextReview||0)); }
  function renderStats(){
    const total=state.words.length, due=dueWords().length, mastered=state.words.filter(w=>w.mastered).length, learning=total-mastered;
    sTotal.textContent=total; sDue.textContent=due; sLearning.textContent=learning; sMastered.textContent=mastered;
  }
  function renderPlan(){
    const plan=getPlan();
    scheduleChips.innerHTML=plan.map((ms,i)=>`<span class="chip">阶段 ${i+1} · ${labelInterval(ms)}</span>`).join('') + '<span class="chip done">完成 · 长期掌握</span>';
    planRows.innerHTML=plan.map((ms,i)=>{ const [v,u]=toEditorInterval(ms); return `<div class="plan-row" data-plan-row><span class="plan-stage">阶段 ${i+1}</span><input class="plan-value" type="number" min="1" value="${v}"><select class="plan-unit"><option value="m" ${u==='m'?'selected':''}>分钟</option><option value="h" ${u==='h'?'selected':''}>小时</option><option value="d" ${u==='d'?'selected':''}>天</option></select><button type="button" class="mini remove-plan" ${plan.length<=1?'disabled':''}>删除</button></div>`; }).join('');
    dailyLimit.value=state.settings.dailyLimit||0; newDailyLimit.value=state.settings.newDailyLimit||0; requireBothDirections.checked=state.settings.requireBothDirections!==false;
  }
  function renderModeButtons(){ document.querySelectorAll('[data-study-mode]').forEach(b=>b.classList.toggle('active',b.dataset.studyMode===state.settings.studyMode)); }
  function renderWords(){
    const q=searchWord.value.trim().toLowerCase();
    const list=state.words.filter(w=>!q || w.en.toLowerCase().includes(q) || meaningText(w).toLowerCase().includes(q) || (w.example||'').toLowerCase().includes(q)).sort((a,b)=>a.en.localeCompare(b.en));
    if(!list.length){ wordRows.innerHTML='<tr><td colspan="6"><div class="empty">没有匹配的单词</div></td></tr>'; return; }
    wordRows.innerHTML=list.map(w=>{
      const st=status(w), totalStages=getPlan().length, stage=w.mastered?'完成':`${Math.min((w.stage||0)+1,totalStages)} / ${totalStages}`;
      const phon=w.phonetic?`<span class="phonetic" style="font-size:13px;margin-left:6px">/${esc(String(w.phonetic).replace(/^\/|\/$/g,''))}/</span>`:'';
      const ex=w.example?`<div style="color:var(--muted);font-size:12px;margin-top:5px;max-width:360px">${esc(w.example)}${w.exampleZh?`<div style="margin-top:2px">${esc(w.exampleZh)}</div>`:''}</div>`:'';
      return `<tr><td><b>${esc(w.en)}</b>${phon}${ex}</td><td>${renderSenses(w)}</td><td><span class="tag ${st}">${statusLabel(st)}</span></td><td>${stage}</td><td>${w.mastered?'长期掌握':fmt(w.nextReview)}</td><td><button class="mini" data-act="speak" data-id="${w.id}">🔊</button> <button class="mini" data-act="enrich" data-id="${w.id}">✨补全</button> <button class="mini" data-act="reset" data-id="${w.id}">重学</button> <button class="mini" data-act="toggle" data-id="${w.id}">${w.mastered?'重新学习':(w.chopped?'恢复重点':'砍掉')}</button> <button class="mini" data-act="delete" data-id="${w.id}">删除</button></td></tr>`;
    }).join('');
  }
  function renderTodayNote(){
    const due=dueWords().length, modeLabel=state.settings.studyMode==='mixed'?'双向智能':state.settings.studyMode==='en2zh'?'隐藏中文 · 看英背中':'隐藏英文 · 看中背英';
    todayNote.innerHTML = due ? `现在有 <b>${due}</b> 个单词到期。当前：<b>${modeLabel}</b>${state.settings.dailyLimit?` · 每日上限 ${state.settings.dailyLimit}`:''}${state.settings.newDailyLimit?` · 新词上限 ${state.settings.newDailyLimit}`:''}。` : '目前没有到期单词。你可以添加新词，或等待下一次复习时间。';
    progressText.textContent=`${sessionDone} / ${sessionTotal}`;
    progressBar.style.width=sessionTotal?`${Math.min(100,sessionDone/sessionTotal*100)}%`:'0%';
  }
  function renderAll(){ renderStats(); renderWords(); renderPlan(); renderModeButtons(); renderTodayNote(); }

  function addWord(en,zh='',example='',meta={}){
    en=en.trim(); zh=(zh||'').trim(); example=(example||'').trim();
    const senses=Array.isArray(meta.senses)&&meta.senses.length?meta.senses:(zh?[{pos:'',abbr:'',zh,definitionEn:''}]:[]);
    const flatZh=zh||senses.map(x=>`${x.abbr||posAbbr(x.pos)} ${x.zh||''}`.trim()).join('  ');
    if(!en||!flatZh) return {ok:false,msg:'英文和中文释义不能为空'};
    const dup=state.words.find(w=>w.en.toLowerCase()===en.toLowerCase()); if(dup) return {ok:false,msg:`“${en}” 已存在词库中`};
    state.words.push({id:id(),en,zh:flatZh,senses,phonetic:meta.phonetic||'',audio:meta.audio||'',example:meta.example||example,exampleZh:meta.exampleZh||'',source:meta.source||'manual',generatedAt:meta.generatedAt||null,stage:0,reviewCount:0,correctCount:0,wrongCount:0,nextReview:now(),chopped:false,mastered:false,createdAt:now(),lastReview:null,directionStats:{en2zh:{correct:0,wrong:0,streak:0},zh2en:{correct:0,wrong:0,streak:0}},stagePass:{en2zh:false,zh2en:false},lastDirection:''});
    save(); return {ok:true};
  }
  function applySmartData(w,data){
    w.phonetic=data.phonetic||w.phonetic||''; w.audio=data.audio||w.audio||''; w.senses=data.senses?.length?data.senses:w.senses; w.zh=meaningText({...w,senses:w.senses}); w.example=data.example||w.example||''; w.exampleZh=data.exampleZh||w.exampleZh||''; w.source=data.source||'smart'; w.generatedAt=Date.now(); return w;
  }
  function sessionCandidates(){
    const all=dueWords();
    const reviews=all.filter(w=>(w.reviewCount||0)>0);
    let fresh=all.filter(w=>(w.reviewCount||0)===0);
    const newLimit=Math.max(0,Number(state.settings.newDailyLimit)||0); if(newLimit) fresh=fresh.slice(0,newLimit);
    let out=[...reviews,...fresh];
    const daily=Math.max(0,Number(state.settings.dailyLimit)||0); if(daily) out=out.slice(0,daily);
    return out;
  }
  function directionScore(w,m){ const d=w.directionStats?.[m]||{}; return (d.correct||0)*2-(d.wrong||0)*2+(d.streak||0); }
  function chooseMode(w){
    const setting=state.settings.studyMode; if(setting!=='mixed') return setting;
    if(state.settings.requireBothDirections!==false){ if(w.stagePass?.en2zh&&!w.stagePass?.zh2en) return 'zh2en'; if(w.stagePass?.zh2en&&!w.stagePass?.en2zh) return 'en2zh'; }
    const a=directionScore(w,'en2zh'), b=directionScore(w,'zh2en');
    if(a===b) return w.lastDirection==='en2zh'?'zh2en':'en2zh';
    return a<b?'en2zh':'zh2en';
  }
  function makeQueue(force=false){
    if(force || !sessionQueue.length){ sessionQueue=sessionCandidates().map(w=>w.id); sessionTotal=sessionQueue.length; sessionDone=0; }
    nextCard();
  }
  function presentCurrent(){
    if(!current) return; currentMode=chooseMode(current); current.lastDirection=currentMode;
    if(currentMode==='en2zh'){
      direction.textContent='隐藏中文 · 英 → 中'; prompt.textContent=current.en; subprompt.innerHTML=(current.phonetic?`<span class="phonetic">/${esc(String(current.phonetic).replace(/^\/|\/$/g,''))}/</span> · `:'')+'先回忆词性和中文释义，再显示答案'; typingBox.style.display='none'; answer.innerHTML=smartAnswerHtml(current,false);
    }else{
      direction.textContent='隐藏英文 · 中 → 英'; prompt.textContent=meaningText(current); subprompt.textContent='根据词性 + 中文释义输入对应英文，再核对答案'; typingBox.style.display='block'; answer.innerHTML=smartAnswerHtml(current,true); setTimeout(()=>typingInput.focus(),0);
    }
    if(state.settings.studyMode==='mixed'&&state.settings.requireBothDirections!==false){ const p=current.stagePass||{}; subprompt.insertAdjacentHTML?.('beforeend',`<div class="weak-hint">本阶段双向通过：英→中 ${p.en2zh?'✓':'○'}　中→英 ${p.zh2en?'✓':'○'}</div>`); }
  }
  function nextCard(){
    revealed=false; answer.classList.remove('show'); postActions.style.display='none'; preActions.style.display='flex'; typingFeedback.textContent=''; typingFeedback.className='feedback'; typingInput.value='';
    current=null;
    while(sessionQueue.length){ const wid=sessionQueue.shift(), w=state.words.find(x=>x.id===wid); if(w && !w.mastered){ current=w; break; } }
    if(!current){ prompt.textContent='本轮学习完成 🎉'; subprompt.textContent='很好！可以休息一下，或稍后按你的计划继续复习。'; direction.textContent='今日完成'; typingBox.style.display='none'; answer.classList.remove('show'); preActions.style.display='none'; postActions.style.display='none'; renderTodayNote(); return; }
    presentCurrent(); revealBtn.style.display='inline-block'; renderTodayNote();
  }
  function reveal(){ if(!current) return; revealed=true; answer.classList.add('show'); preActions.style.display='none'; postActions.style.display='flex'; if(currentMode==='en2zh') speak(current.en,current.audio); }
  function normalize(s){ return s.trim().toLowerCase().replace(/[.!?,;:]/g,''); }
  function checkTyping(){ if(!current || currentMode!=='zh2en') return; const ok=normalize(typingInput.value)===normalize(current.en); typingFeedback.textContent=ok?'✓ 正确':'✗ 再想一下，或直接显示答案'; typingFeedback.className='feedback '+(ok?'ok':'bad'); if(ok) reveal(); }
  function ensureDirectionStats(w){ w.directionStats=w.directionStats||{}; for(const m of ['en2zh','zh2en']) w.directionStats[m]={correct:0,wrong:0,streak:0,...(w.directionStats[m]||{})}; w.stagePass={en2zh:false,zh2en:false,...(w.stagePass||{})}; }
  function updateDirectionStats(w,kind){ ensureDirectionStats(w); const d=w.directionStats[currentMode]; if(kind==='again'||kind==='hard'){ d.wrong++; d.streak=0; } else { d.correct++; d.streak++; } }
  function scheduleForStage(w,stage,scale=1){ const plan=getPlan(); stage=Math.min(Math.max(0,stage),plan.length-1); w.stage=stage; w.nextReview=now()+Math.max(60000,Math.round(plan[stage]*scale)); }
  function grade(kind){
    if(!current) return; const w=current, plan=getPlan(), maxStage=plan.length-1; ensureDirectionStats(w); updateDirectionStats(w,kind); w.reviewCount=(w.reviewCount||0)+1; w.lastReview=now(); w.lastDirection=currentMode;
    const mixedGate=state.settings.studyMode==='mixed'&&state.settings.requireBothDirections!==false;
    if(kind==='again'){ w.wrongCount=(w.wrongCount||0)+1; w.stage=0; w.stagePass={en2zh:false,zh2en:false}; scheduleForStage(w,0,1); w.chopped=false; w.mastered=false; }
    if(kind==='hard'){ w.wrongCount=(w.wrongCount||0)+1; w.stagePass[currentMode]=false; const target=Math.max(0,(w.stage||0)-1); scheduleForStage(w,target,0.6); w.chopped=false; w.mastered=false; }
    if(kind==='good'||kind==='easy'){
      w.correctCount=(w.correctCount||0)+1; w.stagePass[currentMode]=true;
      if(mixedGate && !(w.stagePass.en2zh&&w.stagePass.zh2en)){
        w.nextReview=now(); w.chopped=false; w.mastered=false; sessionQueue.push(w.id); sessionTotal++;
      }else{
        const oldStage=Math.min(w.stage||0,maxStage), jump=kind==='easy'?2:1; w.stagePass={en2zh:false,zh2en:false};
        if(oldStage>=maxStage){ w.mastered=true; w.chopped=true; w.nextReview=null; }
        else{ const target=Math.min(maxStage,oldStage+jump); w.chopped=kind==='easy'; scheduleForStage(w,target,1); }
      }
    }
    sessionDone++; current=null; save(); nextCard();
  }
  function speak(text,audio=''){ if(audio){ try{ const a=new Audio(audio.startsWith('//')?'https:'+audio:audio); a.play().catch(()=>speakTts(text)); return; }catch(e){} } speakTts(text); }
  function speakTts(text){ if(!('speechSynthesis' in window)) return alert('当前浏览器不支持朗读'); const u=new SpeechSynthesisUtterance(text); u.lang='en-US'; u.rate=.9; speechSynthesis.cancel(); speechSynthesis.speak(u); }

  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.tab).classList.add('active');if(b.dataset.tab==='today') makeQueue(true);}));
  modeBar.addEventListener('click',e=>{ const b=e.target.closest('[data-study-mode]'); if(!b) return; state.settings.studyMode=b.dataset.studyMode; save(); if(current){ answer.classList.remove('show'); preActions.style.display='flex'; postActions.style.display='none'; revealed=false; presentCurrent(); } });
  addOne.onclick=()=>{const r=addWord(wordEn.value,wordZh.value,wordExample.value); if(!r.ok) return alert(r.msg); wordEn.value=wordZh.value=wordExample.value=''; alert('已加入词库，并进入今日学习。');};
  speakNew.onclick=()=>wordEn.value.trim()&&speak(wordEn.value.trim());
  function parseEnglishList(text){
    const out=[];
    text.split(/\r?\n/).forEach(line=>{
      let v=line.trim(); if(!v) return;
      if(v.includes('|')) v=v.split('|')[0].trim();
      else if(v.includes(',')) v=v.split(',')[0].replace(/^"|"$/g,'').trim();
      v=v.replace(/^[-*\d.\s]+(?=[A-Za-z])/,'').trim();
      if(v && /[A-Za-z]/.test(v)) out.push(v);
    });
    return [...new Map(out.map(x=>[x.toLowerCase(),x])).values()];
  }
  async function fetchJson(url,timeout=12000){
    const ctrl=new AbortController(), timer=setTimeout(()=>ctrl.abort(),timeout);
    try{ const res=await fetch(url,{signal:ctrl.signal,headers:{Accept:'application/json'}}); if(!res.ok) throw new Error('HTTP '+res.status); return await res.json(); }
    finally{ clearTimeout(timer); }
  }
  async function translateDetailed(text){
    const url='https://api.mymemory.translated.net/get?q='+encodeURIComponent(text)+'&langpair=en%7Czh-CN&mt=1';
    const data=await fetchJson(url,15000);
    const items=[data?.responseData?.translatedText,...(data?.matches||[]).map(x=>x.translation)].filter(Boolean).map(x=>String(x).trim());
    const clean=[];
    for(const x of items){ if(!x||x.toLowerCase()===String(text).toLowerCase()||/NO QUERY SPECIFIED|INVALID LANGUAGE PAIR/i.test(x)) continue; if(!clean.some(y=>y.toLowerCase()===x.toLowerCase())) clean.push(x); }
    if(!clean.length) throw new Error('无有效译文');
    return clean;
  }
  async function translateSegments(parts){
    if(!parts.length) return [];
    const mark=' ⟦SEP⟧ ';
    const clipped=parts.map(x=>String(x||'').slice(0,150));
    try{
      const joined=clipped.join(mark); const out=(await translateDetailed(joined))[0];
      const seg=out.split(/\s*⟦SEP⟧\s*/i);
      if(seg.length===parts.length) return seg.map(x=>x.trim());
    }catch(e){}
    const results=[];
    for(const part of clipped){ try{ results.push((await translateDetailed(part))[0]); }catch(e){ results.push(''); } }
    return results;
  }
  function compactGloss(s,max=34){
    s=String(s||'').replace(/^[“”"']|[“”"']$/g,'').replace(/[。.;；]+$/,'').replace(/^（|）$/g,'').trim();
    if(s.length>max) s=s.slice(0,max).replace(/[，,][^，,]*$/,'')+'…';
    return s;
  }
  async function lookupDictionary(en){
    try{
      const data=await fetchJson('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(en),12000);
      const entries=Array.isArray(data)?data:[]; if(!entries.length) return null;
      const e=entries[0]; const phon=(e.phonetic||e.phonetics?.find(x=>x.text)?.text||'').replace(/^\/|\/$/g,'');
      let audio=e.phonetics?.find(x=>x.audio)?.audio||''; if(audio?.startsWith('//')) audio='https:'+audio;
      const seen=new Set(), meanings=[];
      for(const entry of entries){ for(const m of (entry.meanings||[])){ const pos=m.partOfSpeech||''; if(seen.has(pos)) continue; const defs=(m.definitions||[]).filter(x=>x.definition); if(!defs.length) continue; seen.add(pos); meanings.push({pos,definition:defs[0].definition,example:defs.find(x=>x.example)?.example||'',synonyms:[...(m.synonyms||[]),...(defs[0].synonyms||[])].slice(0,3)}); if(meanings.length>=4) break; } if(meanings.length>=4) break; }
      const example=meanings.map(x=>x.example).find(Boolean)||'';
      return {phonetic:phon,audio,meanings,example};
    }catch(e){ return null; }
  }
  function flattenTranslations(v,out=[]){ if(!v) return out; if(Array.isArray(v)){v.forEach(x=>flattenTranslations(x,out));return out;} if(typeof v==='object'){ if(v.text&&(['cmn','zho','chi'].includes(v.lang)||!v.lang)) out.push(v.text); Object.values(v).forEach(x=>{if(x!==v.text)flattenTranslations(x,out)}); } return out; }
  async function lookupExample(en){
    try{
      const params=new URLSearchParams({lang:'eng',q:en,word_count:'4-16',sort:'words'}); params.append('showtrans:lang','cmn');
      const data=await fetchJson('https://api.tatoeba.org/v1/sentences?'+params.toString(),12000);
      const rows=Array.isArray(data)?data:(data?.data||[]); const wordRe=new RegExp('(^|[^A-Za-z])'+en.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^A-Za-z]|$)','i');
      const row=rows.find(x=>x?.text&&wordRe.test(x.text))||rows.find(x=>x?.text); if(!row) return null;
      const zh=flattenTranslations(row.translations||[]).find(Boolean)||'';
      return {example:row.text,exampleZh:zh,source:'Tatoeba'};
    }catch(e){ return null; }
  }
  function fallbackExample(en,pos=''){
    const p=String(pos).toLowerCase();
    if(p.includes('verb')) return `They tried to ${en} the situation carefully.`;
    if(p.includes('adjective')) return `It was a ${en} choice in that situation.`;
    if(p.includes('adverb')) return `She completed the task ${en}.`;
    if(p.includes('noun')) return `The ${en} became an important part of the discussion.`;
    return `We learned how to use “${en}” in an English sentence.`;
  }
  async function buildSmartEntry(en){
    en=en.trim(); if(!en) throw new Error('请输入英文');
    const [dictR,exR,baseR]=await Promise.allSettled([lookupDictionary(en),lookupExample(en),translateDetailed(en)]);
    const dict=dictR.status==='fulfilled'?dictR.value:null, exdata=exR.status==='fulfilled'?exR.value:null;
    const baseAll=baseR.status==='fulfilled'?baseR.value:[]; const shortBase=baseAll.filter(x=>/[\u3400-\u9fff]/.test(x)&&x.length<=24); const base=(shortBase.length?shortBase:baseAll).slice(0,3);
    const meanings=dict?.meanings?.length?dict.meanings:[{pos:'',definition:'',example:''}];
    let example=exdata?.example||dict?.example||fallbackExample(en,meanings[0]?.pos||'');
    let exampleZh=exdata?.exampleZh||'';
    const segInputs=meanings.map(x=>x.definition).filter(Boolean); const needExampleZh=!exampleZh&&example;
    if(needExampleZh) segInputs.push(example);
    const segZh=await translateSegments(segInputs);
    let idx=0;
    const senses=meanings.map((m,i)=>{
      const defZh=m.definition?compactGloss(segZh[idx++]||''):'';
      let zh='';
      if(i===0&&base.length) zh=base.map(x=>compactGloss(x,18)).filter(Boolean).slice(0,3).join('；');
      else zh=defZh||base[0]||'';
      return {pos:m.pos||'',abbr:posAbbr(m.pos||''),zh:zh||'释义待补充',definitionEn:m.definition||''};
    });
    if(needExampleZh) exampleZh=segZh[idx]||'';
    if(!senses.some(x=>x.zh&&x.zh!=='释义待补充')&&base.length) senses[0].zh=base.join('；');
    if(!senses.some(x=>x.zh&&x.zh!=='释义待补充')) throw new Error('未获得有效中文释义');
    return {en,phonetic:dict?.phonetic||'',audio:dict?.audio||'',senses,example,exampleZh,source:[dict?'Dictionary API':'',exdata?'Tatoeba':'','MyMemory'].filter(Boolean).join(' + '),generatedAt:Date.now()};
  }
  function setBatchStatus(html,kind=''){
    batchStatus.style.display='block'; batchStatus.innerHTML=html;
    batchStatus.style.borderColor=kind==='bad'?'#fecaca':kind==='ok'?'#bbf7d0':'var(--line)';
    batchStatus.style.background=kind==='bad'?'#fff7f7':kind==='ok'?'#f0fdf4':'#f9fafb';
  }
  async function smartAdd(en){ const data=await buildSmartEntry(en); return addWord(en,'','',data); }
  autoOne.onclick=async()=>{
    const en=wordEn.value.trim(); if(!en) return alert('请先输入英文单词。');
    autoOne.disabled=true; oneStatus.style.display='block'; oneStatus.innerHTML=`正在生成 <b>${esc(en)}</b> 的词性、释义和例句…`;
    try{ const data=await buildSmartEntry(en); const r=addWord(en,'','',data); if(!r.ok) throw new Error(r.msg); oneStatus.innerHTML=`✅ 已加入：<b>${esc(en)}</b><div class="smart-preview">${smartAnswerHtml(data,true)}</div>`; wordEn.value=''; makeQueue(true); }
    catch(e){ oneStatus.innerHTML=`❌ 生成失败：${esc(e.message||'网络服务暂时不可用')}。你也可以展开“手动录入”。`; }
    finally{ autoOne.disabled=false; }
  };
  addBatch.onclick=async()=>{
    const words=parseEnglishList(batchText.value);
    if(!words.length) return alert('请先粘贴英文单词，每行一个。');
    const existing=new Set(state.words.map(w=>w.en.toLowerCase()));
    const pending=words.filter(w=>!existing.has(w.toLowerCase())); const skipped=words.length-pending.length;
    if(!pending.length){ setBatchStatus(`这 ${words.length} 个单词都已经在词库中。`); return; }
    addBatch.disabled=true; batchFile.disabled=true; batchFailures.style.display='none'; failedWords.value='';
    let ok=0, failures=[];
    for(let i=0;i<pending.length;i++){
      const en=pending[i]; setBatchStatus(`正在生成完整词条：<b>${i+1} / ${pending.length}</b><br><span class="tiny">${esc(en)} · 词性 / 释义 / 例句</span>`);
      try{ const r=await smartAdd(en); if(r.ok) ok++; else failures.push(en+' —— '+r.msg); }
      catch(err){ failures.push(en+' —— 智能生成失败'); }
      if(i<pending.length-1) await new Promise(r=>setTimeout(r,220));
    }
    addBatch.disabled=false; batchFile.disabled=false;
    if(failures.length){ batchFailures.style.display='block'; failedWords.value=failures.join('\n'); }
    setBatchStatus(`完成：成功加入 <b>${ok}</b> 个完整词条${skipped?`，跳过已存在 <b>${skipped}</b> 个`:''}${failures.length?`，失败 <b>${failures.length}</b> 个。`:''}`, failures.length?'bad':'ok');
    if(ok){ batchText.value=failures.map(x=>x.split(' —— ')[0]).join('\n'); makeQueue(true); }
  };
  batchFile.addEventListener('change',async e=>{
    const f=e.target.files[0]; if(!f)return;
    try{ const text=await f.text(); const words=parseEnglishList(text); if(!words.length) throw new Error('未识别到英文单词'); batchText.value=words.join('\n'); setBatchStatus(`已从 <b>${esc(f.name)}</b> 读取 ${words.length} 个英文单词。点击“生成完整词条并加入词库”即可。`,'ok'); }
    catch(err){ setBatchStatus('文件读取失败，请使用 TXT 或 CSV，并确保第一列/每行是英文单词。','bad'); }
    e.target.value='';
  });
  loadSample.onclick=()=>batchText.value='abandon\naccurate\nbenefit\nchallenge\nconvenient\nachievement';
  revealBtn.onclick=reveal; postActions.querySelectorAll('[data-grade]').forEach(b=>b.onclick=()=>grade(b.dataset.grade)); typingInput.addEventListener('keydown',e=>{if(e.key==='Enter') checkTyping();}); typingInput.addEventListener('input',()=>{typingFeedback.textContent='';});
  searchWord.addEventListener('input',renderWords);
  function editorPlan(){ const rows=[...planRows.querySelectorAll('[data-plan-row]')]; const vals=rows.map(r=>fromEditorInterval(r.querySelector('.plan-value').value,r.querySelector('.plan-unit').value)); if(!vals.length) throw new Error('至少保留 1 个复习阶段'); for(let i=1;i<vals.length;i++) if(vals[i]<vals[i-1]) throw new Error('后一个复习阶段不能比前一个阶段更短'); return vals; }
  function paintEditor(plan){ state.settings.reviewPlan=plan; renderPlan(); }
  document.querySelectorAll('.plan-preset').forEach(b=>b.addEventListener('click',()=>paintEditor([...(PRESETS[b.dataset.preset]||DEFAULT_PLAN)])));
  addPlanStage.onclick=()=>{ const plan=editorPlan(), last=plan[plan.length-1]||DAY; plan.push(Math.max(last+DAY,last*2)); paintEditor(plan); };
  planRows.addEventListener('click',e=>{ const b=e.target.closest('.remove-plan'); if(!b||b.disabled) return; const rows=[...planRows.querySelectorAll('[data-plan-row]')], idx=rows.indexOf(b.closest('[data-plan-row]')); const plan=editorPlan(); plan.splice(idx,1); paintEditor(plan); });
  function commitPlan(reflow=false){
    try{
      const plan=editorPlan(); state.settings.reviewPlan=plan; state.settings.dailyLimit=Math.max(0,Number(dailyLimit.value)||0); state.settings.newDailyLimit=Math.max(0,Number(newDailyLimit.value)||0); state.settings.requireBothDirections=requireBothDirections.checked;
      const maxStage=plan.length-1; state.words.forEach(w=>{ w.stage=Math.min(Math.max(0,w.stage||0),maxStage); if(reflow&&!w.mastered){ if((w.reviewCount||0)===0) w.nextReview=now(); else w.nextReview=(w.lastReview||now())+plan[w.stage]; } });
      localStorage.setItem(KEY,JSON.stringify(state)); renderAll(); makeQueue(true); planStatus.style.display='block'; planStatus.innerHTML=`✓ 已保存 ${plan.length} 个阶段${reflow?'，并已按新计划重排未掌握单词':''}。`;
    }catch(err){ planStatus.style.display='block'; planStatus.textContent='保存失败：'+err.message; }
  }
  savePlan.onclick=()=>commitPlan(false); savePlanReflow.onclick=()=>commitPlan(true);
  wordRows.addEventListener('click',async e=>{
    const b=e.target.closest('button[data-act]'); if(!b)return; const w=state.words.find(x=>x.id===b.dataset.id); if(!w)return;
    if(b.dataset.act==='speak') speak(w.en,w.audio);
    if(b.dataset.act==='enrich'){ b.disabled=true; b.textContent='生成中…'; try{ const data=await buildSmartEntry(w.en); applySmartData(w,data); save(); }catch(err){ alert(`“${w.en}” 资料补全失败，请稍后重试。`); } finally{ if(document.body.contains(b)){b.disabled=false;b.textContent='✨补全';} } }
    if(b.dataset.act==='reset'){w.stage=0;w.reviewCount=0;w.correctCount=0;w.wrongCount=0;w.chopped=false;w.mastered=false;w.nextReview=now();w.stagePass={en2zh:false,zh2en:false};w.directionStats={en2zh:{correct:0,wrong:0,streak:0},zh2en:{correct:0,wrong:0,streak:0}};save();}
    if(b.dataset.act==='toggle'){ const plan=getPlan(), maxStage=plan.length-1; if(w.mastered){w.mastered=false;w.chopped=false;w.stage=0;w.stagePass={en2zh:false,zh2en:false};w.nextReview=now();} else if(w.chopped){w.chopped=false;w.stage=Math.max(0,(w.stage||0)-1);w.nextReview=now();} else {w.chopped=true;w.stage=Math.min(maxStage,(w.stage||0)+2);w.nextReview=now()+plan[w.stage];} save();}
    if(b.dataset.act==='delete'&&confirm(`删除 “${w.en}” 吗？`)){state.words=state.words.filter(x=>x.id!==w.id);save();}
  });
  enrichLegacy.onclick=async()=>{
    const pending=state.words.filter(w=>!w.generatedAt || !w.senses?.length || !w.example);
    if(!pending.length){ enrichStatus.style.display='block'; enrichStatus.textContent='现有词条都已经补全。'; return; }
    enrichLegacy.disabled=true; enrichStatus.style.display='block'; let ok=0,fail=0;
    for(let i=0;i<pending.length;i++){
      const w=pending[i]; enrichStatus.innerHTML=`正在补全旧词：<b>${i+1} / ${pending.length}</b> · ${esc(w.en)}`;
      try{ const data=await buildSmartEntry(w.en); applySmartData(w,data); ok++; }
      catch(e){ fail++; }
      if(i%3===2) save(); if(i<pending.length-1) await new Promise(r=>setTimeout(r,220));
    }
    save(); enrichLegacy.disabled=false; enrichStatus.innerHTML=`补全完成：成功 <b>${ok}</b> 个${fail?`，失败 <b>${fail}</b> 个`:''}。`;
  };
  exportJson.onclick=()=>download('word-memory-backup-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(state,null,2),'application/json');
  exportCsv.onclick=()=>{const lines=[['English','Phonetic','PartOfSpeech+Chinese','Example','ExampleChinese','Stage','Mastered','NextReview'],...state.words.map(w=>[w.en,w.phonetic||'',meaningText(w),w.example||'',w.exampleZh||'',w.stage||0,w.mastered?'yes':'no',w.nextReview?new Date(w.nextReview).toISOString():''])]; const csv='\uFEFF'+lines.map(r=>r.map(v=>'\"'+String(v??'').replace(/\"/g,'\"\"')+'\"').join(',')).join('\n'); download('word-list.csv',csv,'text/csv;charset=utf-8');};
  importJson.addEventListener('change',async e=>{const f=e.target.files[0]; if(!f)return; try{const obj=JSON.parse(await f.text()); if(!Array.isArray(obj.words))throw new Error(); if(confirm(`将导入 ${obj.words.length} 个单词并覆盖当前数据，继续吗？`)){state={...obj,settings:normalizeSettings(obj.settings||{}),words:obj.words.map(migrateWord)};save();makeQueue(true);alert('导入完成');}}catch(err){alert('文件格式不正确');} e.target.value='';});
  resetAll.onclick=()=>{if(confirm('确定清空全部单词和学习记录吗？此操作无法撤销。')){state=defaultState();save();makeQueue(true);}};
  function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  document.addEventListener('keydown',e=>{if(document.activeElement?.tagName==='INPUT'||document.activeElement?.tagName==='TEXTAREA')return;if(e.code==='Space'){e.preventDefault();reveal();} if(revealed&&['1','2','3','4'].includes(e.key))grade(({1:'again',2:'hard',3:'good',4:'easy'})[e.key]);});

  renderAll(); makeQueue(true);
})();
