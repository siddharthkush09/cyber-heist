const app = document.querySelector('#app');
const toastStack = document.querySelector('#toast-stack');
let state = {
  screen: 'entry', mode: 'create', sessionId: localStorage.getItem('cyberHeistSession') || '',
  playerId: localStorage.getItem('cyberHeistPlayer') || '', room: null, avatars: [], selectedAvatar: null,
  selectedAction: null, selectedTarget: null, countdown: 0, timer: null, lastResolutionKey: '', lastEventId: null, completedObjectiveIds: new Set(),
  lastAudioResolutionKey: '', lastAudioEventId: null, lastAudioTurn: null, lastAudioSecurity: null, audioReady: false, soundEnabled: localStorage.getItem('cyberHeistSound') !== 'off',
};
let eventSource = null;
const fallbackAvatars = [
  ['neon-ghost','Neon Ghost','#00f5d4'], ['byte-witch','Byte Witch','#ff4ecd'], ['null-fox','Null Fox','#8a7dff'], ['chrome-viper','Chrome Viper','#55d6ff'],
  ['glitch-monk','Glitch Monk','#ffd166'], ['data-wraith','Data Wraith','#7cf29a'], ['cipher-queen','Cipher Queen','#ff6b8a'], ['signal-rat','Signal Rat','#c0ff3e'],
  ['zero-day','Zero Day','#ff8c42'], ['dark-pulse','Dark Pulse','#a78bfa'], ['packet-reaper','Packet Reaper','#f43f5e'], ['quantum-jack','Quantum Jack','#22d3ee']
].map(([id,name,accent]) => ({id,name,accent}));
const AUDIO_STORAGE_KEY = 'cyberHeistSound';
const audio = {
  ctx: null, master: null, music: null, musicTimer: null, musicStep: 0,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
};
function audioContext(){
  if(audio.ctx) return audio.ctx;
  const Ctx=window.AudioContext||window.webkitAudioContext;
  if(!Ctx) return null;
  audio.ctx=new Ctx();
  audio.master=audio.ctx.createGain();
  audio.master.gain.value=state.soundEnabled?.28:0;
  audio.master.connect(audio.ctx.destination);
  return audio.ctx;
}
function setSoundEnabled(enabled){
  state.soundEnabled=Boolean(enabled); localStorage.setItem(AUDIO_STORAGE_KEY,state.soundEnabled?'on':'off');
  const ctx=audioContext();
  if(ctx&&audio.master) audio.master.gain.setTargetAtTime(state.soundEnabled?.28:0,ctx.currentTime,.025);
  updateSoundControls();
  if(state.soundEnabled && state.room?.phase==='game') startMusic(); else stopMusic();
}
function updateSoundControls(){
  document.querySelectorAll('[data-sound-toggle]').forEach(button=>{
    const on=state.soundEnabled;
    button.textContent=on?'🔊 SOUND ON':'🔇 SOUND OFF';
    button.setAttribute('aria-pressed',String(on));
    button.setAttribute('aria-label',on?'Mute game audio':'Unmute game audio');
    button.title=on?'Mute game audio':'Unmute game audio';
  });
}
async function unlockAudio(){
  const ctx=audioContext();
  if(!ctx) return false;
  try{await ctx.resume();state.audioReady=ctx.state==='running';}catch{state.audioReady=false;}
  if(state.audioReady&&state.soundEnabled&&state.room?.phase==='game') startMusic();
  updateSoundControls();
  return state.audioReady;
}
function tone(freq,duration=.09,type='sine',volume=.035,delay=0){
  const ctx=audioContext(); if(!ctx||!state.soundEnabled||!state.audioReady)return;
  const now=ctx.currentTime+delay,osc=ctx.createOscillator(),gain=ctx.createGain();
  osc.type=type;osc.frequency.setValueAtTime(freq,now);gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
  osc.connect(gain).connect(audio.master);osc.start(now);osc.stop(now+duration+.025);
}
function noise(duration=.1,volume=.025,filterFreq=1800){
  const ctx=audioContext(); if(!ctx||!state.soundEnabled||!state.audioReady)return;
  const length=Math.max(1,Math.floor(ctx.sampleRate*duration)),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,2);
  const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();filter.type='bandpass';filter.frequency.value=filterFreq;filter.Q.value=.7;gain.gain.value=volume;src.buffer=buffer;src.connect(filter).connect(gain).connect(audio.master);src.start();
}
function playSfx(kind){
  if(!state.soundEnabled||!state.audioReady)return;
  const map={
    select:{notes:[520],type:'square',volume:.025},
    collect:{notes:[440,660],type:'sine',volume:.032},
    steal:{notes:[330,520],type:'triangle',volume:.032},
    secure:{notes:[220,330],type:'sine',volume:.028},
    decoy:{notes:[390,585,780],type:'triangle',volume:.028},
    lock:{notes:[180,260],type:'square',volume:.035},
    success:{notes:[440,660,880],type:'sine',volume:.04},
    fail:{notes:[260,190],type:'sawtooth',volume:.03},
    stealSuccess:{notes:[500,750,1000],type:'triangle',volume:.038},
    blockedSteal:{notes:[280,180,120],type:'square',volume:.032},
    decoySuccess:{notes:[500,700,980],type:'triangle',volume:.036},
    defense:{notes:[240,360,480],type:'sine',volume:.03},
    countdown:{notes:[620],type:'sine',volume:.018},
    warning:{notes:[740,740],type:'square',volume:.022},
    finalLock:{notes:[300,180,90],type:'square',volume:.04},
    securityUp:{notes:[300,420],type:'sawtooth',volume:.028},
    securityDown:{notes:[520,380],type:'sine',volume:.024},
    elevated:{notes:[360,520,700],type:'triangle',volume:.03},
    critical:{notes:[180,240,180],type:'sawtooth',volume:.035},
    event:{notes:[420,630,945],type:'triangle',volume:.03},
    cryptoLockdown:{notes:[260,180,120],type:'square',volume:.03},
    dataSurge:{notes:[520,780,1040],type:'sine',volume:.032},
    firewallSweep:{notes:[180,260,180,110],type:'sawtooth',volume:.032},
    marketShift:{notes:[380,570,760,570],type:'triangle',volume:.03},
    objective:{notes:[620,830,1040],type:'sine',volume:.035},
    result:{notes:[260,390,520],type:'sine',volume:.032},
    winner:{notes:[520,780,1040,1560],type:'sine',volume:.045},
  }[kind];
  if(!map)return;
  map.notes.forEach((n,i)=>tone(n,.07+i*.012,map.type,map.volume,i*.065));
  if(['lock','warning','finalLock','securityUp','securityDown','critical','blockedSteal'].includes(kind))noise(.055,.012,kind==='critical'?500:1500);
}
function playEventSfx(id){const map={'crypto-lockdown':'cryptoLockdown','data-surge':'dataSurge','firewall-sweep':'firewallSweep','market-shift':'marketShift'};playSfx(map[id]||'event');}
function flashGameFeel(kind){if(audio.reducedMotion)return;const el=document.querySelector('.game-main,.results-layout,.game-topbar');if(!el)return;el.classList.remove('feel-'+kind);void el.offsetWidth;el.classList.add('feel-'+kind);setTimeout(()=>el.classList.remove('feel-'+kind),420);}
function startMusic(){
  const ctx=audioContext(); if(!ctx||!state.soundEnabled||!state.audioReady||audio.music)return;
  const master=ctx.createGain();master.gain.value=.13;master.connect(audio.master);
  const pad=ctx.createOscillator(),padGain=ctx.createGain(),bass=ctx.createOscillator(),bassGain=ctx.createGain();
  pad.type='sine';pad.frequency.value=110;padGain.gain.value=.055;bass.type='triangle';bass.frequency.value=55;bassGain.gain.value=.035;
  pad.connect(padGain).connect(master);bass.connect(bassGain).connect(master);pad.start();bass.start();
  audio.music={master,pad,padGain,bass,bassGain};
  const chords=[110,123.47,130.81,98];
  audio.musicStep=0;
  audio.musicTimer=setInterval(()=>{
    if(!audio.music||!state.soundEnabled||!state.audioReady)return;
    const now=ctx.currentTime,root=chords[audio.musicStep%chords.length];
    pad.frequency.setTargetAtTime(root,now,.25);bass.frequency.setTargetAtTime(root/2,now,.25);audio.musicStep++;
  },2400);
}
function stopMusic(){
  if(audio.musicTimer)clearInterval(audio.musicTimer);audio.musicTimer=null;
  if(!audio.music)return;
  const m=audio.music,ctx=audio.ctx;try{m.master.gain.setTargetAtTime(.0001,ctx.currentTime,.08);m.pad.stop(ctx.currentTime+.3);m.bass.stop(ctx.currentTime+.3);}catch{}
  audio.music=null;
}
function soundControl(){return `<button class="sound-toggle secondary-button" type="button" data-sound-toggle aria-pressed="${state.soundEnabled}" aria-label="${state.soundEnabled?'Mute game audio':'Unmute game audio'}" title="${state.soundEnabled?'Mute game audio':'Unmute game audio'}">${state.soundEnabled?'🔊 SOUND ON':'🔇 SOUND OFF'}</button>`;}
function audioRenderState(){
  if(state.room?.phase==='game'){if(state.audioReady&&state.soundEnabled)startMusic();}else stopMusic();
  updateSoundControls();
}
function handleAudioResolution(g){
  const r=g.lastResolution;if(!r)return;
  const key=`${g.turn}:${JSON.stringify(r.outcomes||[])}:${r.securityDelta||0}:${r.event?.id||''}`;
  if(key===state.lastAudioResolutionKey)return;state.lastAudioResolutionKey=key;
  const mine=(r.outcomes||[]).find(o=>o.playerId===state.playerId);
  if(mine){
    const text=String(mine.text||'').toLowerCase();
    if(mine.success){
      if(mine.action==='steal'||text.includes('steal'))playSfx('stealSuccess');
      else if(mine.action==='decoy'||text.includes('decoy'))playSfx('decoySuccess');
      else if(mine.action==='secure'||text.includes('defend'))playSfx('defense');
      else playSfx('success');
    }else if(mine.action==='steal'||text.includes('blocked'))playSfx('blockedSteal');
    else playSfx('fail');
  }
  if(r.event){playEventSfx(r.event.id);flashGameFeel('event');}
  if(typeof r.securityDelta==='number'&&r.securityDelta!==0){playSfx(r.securityDelta>0?'securityUp':'securityDown');if(r.securityLevel==='ELEVATED')playSfx('elevated');if(r.securityLevel==='CRITICAL')playSfx('critical');flashGameFeel(r.securityDelta>0?'security-up':'security-down');}
}
const ACTION_INFO = {
  collect: { icon:'⚡', label:'HACK / COLLECT', desc:'Recover +1 server-selected resource. A trace can make the hack fail.', tone:'cyan' },
  steal: { icon:'🕵', label:'STEAL', desc:'Attempt to steal +1 resource from one opponent.', tone:'pink' },
  secure: { icon:'🛡', label:'SECURE / DEFEND', desc:'Block steals targeting you for this turn.', tone:'green' },
  decoy: { icon:'🎭', label:'DECOY / TRICK', desc:'Punish a thief who targets your decoy.', tone:'violet' },
};
async function api(path, options={}) {
  const headers={'Content-Type':'application/json',...(options.headers||{})}; if(state.sessionId) headers['X-Session-Id']=state.sessionId;
  const response=await fetch(path,{...options,headers}); const data=await response.json().catch(()=>({}));
  if(!response.ok) throw Object.assign(new Error(data.error||'REQUEST_FAILED'),{title:data.title,message:data.message,status:response.status}); return data;
}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function toast(title,message){const el=document.createElement('div');el.className='toast panel';el.innerHTML=`<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;toastStack.append(el);setTimeout(()=>el.remove(),4000);}
function setSession(data){state.sessionId=data.sessionId;state.playerId=data.playerId;state.room=data.room;localStorage.setItem('cyberHeistSession',state.sessionId);localStorage.setItem('cyberHeistPlayer',state.playerId);}
async function loadAvatars(){try{state.avatars=(await api('/api/avatars')).avatars;}catch{state.avatars=fallbackAvatars;}}
function avatarById(id){return state.avatars.find(a=>a.id===id)||fallbackAvatars.find(a=>a.id===id)||fallbackAvatars[0];}
function avatarMarkup(id,size='medium'){const a=avatarById(id),initials=a.name.split(/\s+/).map(x=>x[0]).join('').slice(0,2);return `<div class="avatar avatar-${size}" style="--avatar-accent:${a.accent}" title="${escapeHtml(a.name)}"><span class="avatar-core">${escapeHtml(initials)}</span></div>`;}
function stopTimer(){if(state.timer)clearInterval(state.timer);state.timer=null;}
function startTimer(endAt){stopTimer();let lastCountdown=null;const tick=()=>{state.countdown=Math.max(0,Math.ceil((endAt-Date.now())/1000));if(state.countdown!==lastCountdown){if(state.countdown<=3&&state.countdown>0)playSfx(state.countdown===1?'finalLock':'warning');else if(state.countdown<=5&&state.countdown>3)playSfx('countdown');lastCountdown=state.countdown;}const card=document.querySelector('.turn-panel');const el=document.querySelector('#decision-countdown');if(el){el.textContent=String(state.countdown).padStart(2,'0');el.setAttribute('aria-label',`${state.countdown} seconds remaining`);}if(card){card.classList.toggle('timer-warning',state.countdown<=5&&state.countdown>0);card.classList.toggle('timer-critical',state.countdown<=3&&state.countdown>0);}const bar=document.querySelector('#timer-bar');if(bar){const total=15000;bar.style.width=`${Math.max(0,Math.min(100,(endAt-Date.now())/total*100))}%`;}};tick();state.timer=setInterval(tick,200);}
function render(){if(state.room?.phase==='game'){if(state.room.game?.phase==='results')renderResults();else renderGame();}else if(state.room&&state.screen==='lobby')renderLobby();else renderEntry();}
function renderEntry(){stopTimer();stopMusic();document.title='Cyber Heist — Lobby';app.innerHTML=`<header class="topbar"><div class="brand-lockup"><div class="brand-mark"><span></span><span></span><span></span></div><div><p class="eyebrow">MULTIPLAYER PROTOCOL // ROOM ACCESS</p><h1>CYBER <span>HEIST</span></h1></div></div><div class="header-tools"><div class="system-status"><span class="status-dot"></span><span>NETWORK ONLINE</span></div>${soundControl()}</div></header><section class="entry-grid"><div class="hero-copy panel"><p class="kicker">HACK. BLUFF. OUTSMART.</p><h2>Assemble your crew.<br><span>Own the network.</span></h2><p class="hero-text">Create a private room or join an existing heist. Stage 3C adds security pressure, server events, private objectives, and transparent final scoring.</p><div class="protocol-strip"><span>03–08 OPERATORS</span><i></i><span>7 TURNS</span><i></i><span>NO ACCOUNT</span></div></div><div class="entry-card panel"><div class="panel-header"><span>ACCESS TERMINAL</span><span class="panel-code">RM-03</span></div><div class="tabs"><button class="tab active" data-mode="create">CREATE ROOM</button><button class="tab" data-mode="join">JOIN ROOM</button></div><form id="entry-form" class="entry-form"><label>HACKER NAME<input name="name" maxlength="18" required autocomplete="off" placeholder="Choose your alias"></label><label class="room-field hidden">ROOM CODE<input name="code" maxlength="6" autocomplete="off" placeholder="ABCDE"></label><div><div class="field-label">SELECT AVATAR</div><div class="avatar-picker" id="avatar-picker"></div></div><button class="primary-button" type="submit"><span id="entry-submit-label">CREATE ROOM</span><b>↗</b></button></form><p class="form-note" id="form-note">You become host automatically.</p></div></section><footer><span>CYBER HEIST // 7-TURN PROTOCOL</span><span>REAL-TIME ROOMS</span></footer>`;
  populatePicker(); app.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>{state.mode=tab.dataset.mode;app.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab));app.querySelector('.room-field').classList.toggle('hidden',state.mode!=='join');app.querySelector('#entry-submit-label').textContent=state.mode==='join'?'JOIN ROOM':'CREATE ROOM';app.querySelector('#form-note').textContent=state.mode==='join'?'Enter the room code shared by your host.':'You become host automatically.';}));
  app.querySelector('#entry-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),avatar=app.querySelector('.avatar-choice.selected')?.dataset.avatar;try{const data=await api(state.mode==='create'?'/api/rooms':'/api/rooms/join',{method:'POST',body:JSON.stringify({name:f.get('name'),code:f.get('code'),avatar})});setSession(data);state.screen='lobby';connectEvents();render();}catch(err){toast(err.title||'Access denied',err.message||'Unable to enter the room.');}});
}
function populatePicker(){const picker=app.querySelector('#avatar-picker');if(!picker)return;const selected=state.selectedAvatar||state.avatars[0]?.id;picker.innerHTML=state.avatars.map(a=>`<button type="button" class="avatar-choice ${a.id===selected?'selected':''}" data-avatar="${a.id}" style="--avatar-accent:${a.accent}">${avatarMarkup(a.id,'small')}<b>${escapeHtml(a.name)}</b></button>`).join('');picker.querySelectorAll('.avatar-choice').forEach(b=>b.addEventListener('click',()=>{state.selectedAvatar=b.dataset.avatar;picker.querySelectorAll('.avatar-choice').forEach(x=>x.classList.toggle('selected',x===b));}));}
function playerCard(p){const me=p.id===state.playerId,host=p.id===state.room.hostId;return `<article class="player-card panel ${me?'is-me':''} ${p.connected?'':'is-away'}">${host?'<div class="host-ribbon">HOST</div>':''}${avatarMarkup(p.avatar)}<div class="player-meta"><span class="connection-dot ${p.connected?'online':''}"></span><strong>${escapeHtml(p.name)}</strong><span>${me?'YOU':p.connected?'CONNECTED':'RECONNECTING'}</span></div><div class="ready-chip ${p.ready?'ready':''}">${p.ready?'READY':'WAITING'}</div>${state.room.hostId===state.playerId&&p.id!==state.playerId?`<button class="remove-player" data-player="${p.id}">×</button>`:''}</article>`;}
function renderLobby(){stopTimer();stopMusic();document.title='Cyber Heist — Lobby';const room=state.room,me=room.players.find(p=>p.id===state.playerId),host=room.hostId===state.playerId;app.innerHTML=`<header class="topbar"><div class="brand-lockup"><div class="brand-mark"><span></span><span></span><span></span></div><div><p class="eyebrow">MULTIPLAYER PROTOCOL // LOBBY</p><h1>CYBER <span>HEIST</span></h1></div></div><div class="header-tools"><div class="system-status"><span class="status-dot"></span><span>ROOM SYNCED</span></div>${soundControl()}</div></header><section class="lobby-layout"><aside class="lobby-sidebar"><div class="panel room-code-card"><p class="kicker">SECURE ROOM</p><div class="room-code">${room.code}</div><button id="copy-code" class="secondary-button">COPY ROOM CODE</button><small>Share this code with your crew.</small></div><div class="panel identity-card"><div class="panel-header"><span>YOUR IDENTITY</span><span>UNLOCKED</span></div><form id="identity-form"><label>HACKER NAME<input name="name" maxlength="18" value="${escapeHtml(me?.name||'')}" required></label><div class="field-label">AVATAR</div><div class="avatar-picker compact" id="identity-picker"></div><button class="secondary-button" type="submit">SAVE IDENTITY</button></form></div></aside><main class="lobby-main"><div class="lobby-heading"><div><p class="kicker">CREW ASSEMBLY</p><h2>Choose your operators.</h2></div><div class="player-count"><strong>${room.playerCount}/8</strong><span>OPERATORS</span></div></div><div class="player-grid">${room.players.map(playerCard).join('')}</div><div class="panel lobby-controls"><div><strong>${room.playerCount<3?`Need ${3-room.playerCount} more player${3-room.playerCount===1?'':'s'}.`:room.canStart?'All operators ready.':'Everyone must ready up.'}</strong><small>Stage 3C: identities are locked and the seven-turn heist protocol begins.</small></div>${host?`<button id="start-game" class="primary-button" ${room.canStart?'':'disabled'}>START HEIST <b>↗</b></button>`:`<button id="ready" class="primary-button">${me?.ready?'UNREADY':'READY UP'} <b>✓</b></button>`}</div></main></section><footer><span>CYBER HEIST // ROOM ${room.code}</span><span>SERVER SYNCHRONIZED</span></footer>`;
  app.querySelector('#copy-code')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(room.code);toast('Room code copied',room.code);}catch{toast('Room code',room.code);}});
  const picker=app.querySelector('#identity-picker');picker.innerHTML=state.avatars.map(a=>`<button type="button" class="avatar-choice ${a.id===me?.avatar?'selected':''}" data-avatar="${a.id}" style="--avatar-accent:${a.accent}">${avatarMarkup(a.id,'small')}<b>${escapeHtml(a.name)}</b></button>`).join('');picker.querySelectorAll('.avatar-choice').forEach(b=>b.addEventListener('click',()=>{state.selectedAvatar=b.dataset.avatar;picker.querySelectorAll('.avatar-choice').forEach(x=>x.classList.toggle('selected',x===b));}));
  app.querySelector('#identity-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{state.room=(await api('/api/rooms/identity',{method:'PATCH',body:JSON.stringify({name:f.get('name'),avatar:state.selectedAvatar||me.avatar})})).room;render();}catch(err){toast(err.title||'Identity update failed',err.message||'Try another name or avatar.');}});
  app.querySelector('#ready')?.addEventListener('click',async()=>{try{state.room=(await api('/api/rooms/ready',{method:'POST',body:JSON.stringify({ready:!me.ready})})).room;render();}catch(err){toast(err.title,err.message);}});
  app.querySelector('#start-game')?.addEventListener('click',async()=>{try{state.room=(await api('/api/rooms/start',{method:'POST'})).room;state.selectedAction=null;state.selectedTarget=null;render();}catch(err){toast(err.title,err.message);}});
  app.querySelectorAll('.remove-player').forEach(b=>b.addEventListener('click',async()=>{try{state.room=(await api('/api/rooms/remove',{method:'POST',body:JSON.stringify({playerId:b.dataset.player})})).room;render();}catch(err){toast(err.title,err.message);}}));
}
function resourcePill(key, value, market){const labels={credits:'CREDITS',data:'DATA',crypto:'CRYPTO'};const icons={credits:'₡',data:'◈',crypto:'₿'};return `<div class="resource-pill resource-${key}"><span>${icons[key]}</span><div><b>${labels[key]}</b><strong>${value}</strong></div><small>×${market[key]}</small></div>`;}
function renderGame(){const g=state.room.game;if(g.phase==='decision'&&g.decisionEndsAt)startTimer(g.decisionEndsAt);else stopTimer();const submitted=Boolean(g.mySubmittedAction);const selected=state.selectedAction;const targets=g.players.filter(p=>p.id!==state.playerId&&p.connected);const inv=g.myInventory||{credits:0,data:0,crypto:0};const market=g.marketValues||{credits:1,data:3,crypto:5};const security=Math.max(0,Math.min(2,Number(g.security)||0));const levels=['LOW','ELEVATED','CRITICAL'];const event=g.activeEvent;const objectives=g.myObjectives||[];const phase=g.phase==='resolution'?'RESOLVING':submitted?'LOCKED':'DECISION';app.innerHTML=`<header class="topbar game-topbar"><div class="brand-lockup"><div class="brand-mark"><span></span><span></span><span></span></div><div><p class="eyebrow">STAGE 3C // HEIST CONTROL</p><h1>CYBER <span>HEIST</span></h1></div></div><div class="header-tools"><div class="system-status"><span class="status-dot"></span><span>LIVE SYNC // SERVER AUTHORITY</span></div>${soundControl()}</div></header><section class="game-layout"><aside class="game-sidebar game-left"><div class="panel turn-card turn-panel phase-${phase.toLowerCase()}" aria-live="polite"><p class="kicker">CURRENT TURN</p><strong>${g.turn}<span>/7</span></strong>${phase==='DECISION'?`<div class="timer"><b id="decision-countdown" aria-label="Decision seconds remaining">--</b><small>SECONDS</small></div><div class="timer-bar" role="progressbar" aria-label="Decision time remaining"><i id="timer-bar"></i></div>`:`<div class="phase-state"><b>${phase}</b><small>${phase==='LOCKED'?'WAITING FOR ALL OPERATORS':'REVEALING RESULTS'}</small></div>`}</div><div class="panel security-panel security-${levels[security].toLowerCase()}" aria-live="polite"><div class="panel-header"><span>NETWORK SECURITY</span><span>${levels[security]}</span></div><div class="security-meter" aria-label="Security ${levels[security]}">${levels.map((x,i)=>`<i class="${i<=security?'active ':''}level-${i}"></i>`).join('')}</div><strong>${levels[security]}</strong><p>${security===0?'Quiet network. Hacks are safer and defensive play can cool the room.':security===1?'The firewall is watching. Aggressive actions are raising attention.':'Critical alert. Hacks are more likely to be traced and the network is at maximum heat.'}</p></div><div class="panel event-panel ${event?'event-active':''}" aria-live="polite"><div class="panel-header"><span>SERVER EVENT</span><span>${event?'ACTIVE':'QUIET'}</span></div>${event?`<div class="event-icon" aria-hidden="true">${event.icon}</div><strong>${escapeHtml(event.name)}</strong><p>${escapeHtml(event.description)}</p>`:`<strong>No active event</strong><p>The server may trigger an event on a later turn.</p>`}</div><div class="panel inventory-card"><div class="panel-header"><span>YOUR ASSETS</span><span>SERVER OWNED</span></div><div class="resource-grid">${['credits','data','crypto'].map(k=>resourcePill(k,inv[k],market)).join('')}</div></div><div class="panel market-card"><div class="panel-header"><span>MARKET VALUES</span><span>${event?.id==='market-shift'?'SHIFTED':'BASE'}</span></div><div class="market-grid">${['credits','data','crypto'].map(k=>`<div><span>${k.toUpperCase()}</span><b>${market[k]}</b></div>`).join('')}</div></div><div class="panel objective-panel"><div class="panel-header"><span>PRIVATE OBJECTIVES</span><span>${objectives.filter(o=>o.completed).length}/${objectives.length}</span></div>${objectives.map(o=>`<div class="objective ${o.completed?'complete':''}" aria-label="${escapeHtml(o.label)} ${Math.min(o.progress,o.target)} of ${o.target}${o.completed?' complete':''}"><span class="objective-mark" aria-hidden="true">${o.completed?'✓':'○'}</span><div><strong>${escapeHtml(o.label)}</strong><small>${escapeHtml(o.description)} <em>${Math.min(o.progress,o.target)}/${o.target} · +${o.bonus}</em></small></div></div>`).join('')}</div></aside><main class="game-main"><div class="panel player-board"><div class="panel-header"><span>NETWORK OPERATORS</span><span>TURN ${g.turn}/7</span></div><div class="live-player-grid">${g.players.map(p=>`<article class="live-player panel ${p.id===state.playerId?'self':''} ${p.connected?'':'disconnected'}" aria-label="${escapeHtml(p.name)} ${p.connected?'online':'disconnected'}${p.id===state.playerId?', you':''}">${avatarMarkup(p.avatar,'small')}<div class="live-player-meta"><strong>${escapeHtml(p.name)}${p.id===state.playerId?' <em>YOU</em>':''}</strong><span>${p.connected?'ONLINE':'DISCONNECTED'}</span></div><span class="submitted-mark ${p.submitted?'is-locked':''}">${p.submitted?'LOCKED':'CHOOSING'}</span></article>`).join('')}</div></div>${g.phase==='resolution'?renderResolution(g):renderActionPanel(g,targets,selected,submitted)}</main></section><footer><span>CYBER HEIST // SERVER AUTHORITATIVE</span><span>SECURITY ${levels[security]} // TURN ${g.turn}/7</span></footer>`;bindGame(g,targets);announceGameFeedback(g);handleAudioResolution(g);audioRenderState();} 
function renderActionPanel(g,targets,selected,submitted){return `<div class="panel action-panel ${submitted?'action-locked':''}" aria-live="polite"><div class="action-panel-head"><div><p class="kicker">SECRET DECISION</p><h2>${submitted?'Action locked.':'Choose your move.'}</h2></div><span>${submitted?'LOCKED // WAITING FOR CREW':'PRIVATE UNTIL RESOLUTION'}</span></div><div class="current-action"><span>CURRENT ACTION</span><b>${submitted?escapeHtml(ACTION_INFO[g.mySubmittedAction.action]?.label||g.mySubmittedAction.action.toUpperCase()):selected?escapeHtml(ACTION_INFO[selected].label):'NONE'}</b></div><div class="action-grid">${Object.entries(ACTION_INFO).map(([key,i])=>`<button class="game-action ${selected===key?'selected':''} action-${i.tone}" data-action="${key}" aria-pressed="${selected===key}" ${submitted?'disabled':''}><span aria-hidden="true">${i.icon}</span><b>${i.label}</b><small>${i.desc}</small></button>`).join('')}</div>${selected==='steal'&&!submitted?`<div class="sub-choice"><span>SELECT PRIVATE TARGET</span><div class="target-grid">${targets.length?targets.map(p=>`<button class="target-choice ${state.selectedTarget===p.id?'selected':''}" data-target="${p.id}" aria-pressed="${state.selectedTarget===p.id}">${avatarMarkup(p.avatar,'small')}<b>${escapeHtml(p.name)}</b></button>`).join(''):'<small>No connected opponents available.</small>'}</div></div>`:''}<div class="action-confirm"><span>${selected?escapeHtml(ACTION_INFO[selected].label):'No action selected'}</span><button id="lock-action" class="primary-button" aria-label="Lock selected action" ${submitted||!selected||(selected==='steal'&&!state.selectedTarget)?'disabled':''}>LOCK ACTION <b>✓</b></button></div></div>`;} 
function renderResolution(g){const r=g.lastResolution;return `<div class="panel action-panel resolution-card"><div class="action-panel-head"><div><p class="kicker">TURN ${g.turn} // RESOLUTION</p><h2>Signals resolved.</h2></div><span>SIMULTANEOUS REVEAL</span></div>${r?.event?`<div class="event-resolution"><b>${r.event.icon} ${escapeHtml(r.event.name)}</b><span>${escapeHtml(r.event.description)}</span></div>`:''}<div class="security-resolution"><span>SECURITY</span><b>${escapeHtml(r?.securityLevel||g.securityLevel||'LOW')}</b><span>${(r?.securityDelta||0)>0?`+${r.securityDelta}`:(r?.securityDelta||0)} heat</span></div><div class="resolution-outcomes">${(r?.outcomes||[]).map(o=>`<div class="resolution-line ${o.success?'success':'failure'}"><i></i><span>${escapeHtml(o.text)}</span></div>`).join('')}</div><div class="resolution-assets"><span>YOUR ASSETS</span><div>${Object.entries(g.myInventory||{}).map(([k,v])=>`<b>${k.toUpperCase()} ${v}</b>`).join(' · ')}</div></div><div class="action-confirm"><span>All resource changes were applied atomically.</span><span>Next turn loading…</span></div></div>`;}
function bindGame(g,targets){app.querySelectorAll('.game-action').forEach(b=>b.addEventListener('click',()=>{state.selectedAction=b.dataset.action;if(state.selectedAction!=='steal')state.selectedTarget=null;playSfx(state.selectedAction==='collect'?'collect':state.selectedAction);toast('Action selected',ACTION_INFO[state.selectedAction].label);render();flashGameFeel('action-selected');}));app.querySelectorAll('.target-choice').forEach(b=>b.addEventListener('click',()=>{state.selectedTarget=b.dataset.target;playSfx('select');const target=targets.find(p=>p.id===b.dataset.target);toast('Target selected',target?`${target.name} marked for Steal`:'Target selected');render();flashGameFeel('target-selected');}));app.querySelector('#lock-action')?.addEventListener('click',async()=>{const body={action:state.selectedAction};if(body.action==='steal')body.targetId=state.selectedTarget;try{playSfx('lock');state.room=(await api('/api/rooms/action',{method:'POST',body:JSON.stringify(body)})).room;toast('Action locked',`${ACTION_INFO[body.action].label} is committed for this turn.`);render();flashGameFeel('locked');}catch(err){toast(err.title||'Action rejected',err.message||'The server rejected that action.');}});} 
function announceGameFeedback(g){const resolution=g.lastResolution;const resolutionKey=resolution?`${g.turn}:${JSON.stringify(resolution.outcomes||[])}:${resolution.security||0}:${resolution.event?.id||''}`:'';if(g.phase==='resolution'&&resolution&&resolutionKey!==state.lastResolutionKey){state.lastResolutionKey=resolutionKey;const mine=(resolution.outcomes||[]).find(o=>o.playerId===state.playerId);if(mine)toast(mine.success?'Action resolved':'Action blocked',mine.text||'Turn resolved.');if(resolution.event)toast(`${resolution.event.icon} ${resolution.event.name}`,'Server event revealed for this turn.');if(typeof resolution.securityDelta==='number'&&resolution.securityDelta!==0)toast('Security changed',`${resolution.securityLevel}${resolution.securityDelta>0?' ↑':' ↓'}`);}const eventId=g.activeEvent?.id||null;if(eventId&&eventId!==state.lastEventId&&g.phase==='decision'){state.lastEventId=eventId;playEventSfx(g.activeEvent.id);flashGameFeel('event');toast(`${g.activeEvent.icon} ${g.activeEvent.name}`,g.activeEvent.description);}const completed=(g.myObjectives||[]).filter(o=>o.completed).map(o=>o.id);for(const id of completed){if(!state.completedObjectiveIds.has(id)){const objective=g.myObjectives.find(o=>o.id===id);state.completedObjectiveIds.add(id);playSfx('objective');flashGameFeel('objective');toast('Objective complete',`${objective?.label||'Objective'} · +${objective?.bonus||0}`);}}} 
function renderResults(){stopTimer();document.title='Cyber Heist — Complete';const g=state.room.game;const rows=g.results||[];const winner=rows.find(r=>r.winner)||rows[0];if(state.lastAudioResolutionKey!=='RESULTS'){state.lastAudioResolutionKey='RESULTS';playSfx('winner');flashGameFeel('results');}app.innerHTML=`<header class="topbar game-topbar"><div class="brand-lockup"><div class="brand-mark"><span></span><span></span><span></span></div><div><p class="eyebrow">STAGE 3C // MATCH COMPLETE</p><h1>CYBER <span>HEIST</span></h1></div></div><div class="header-tools"><div class="system-status"><span class="status-dot"></span><span>ROUND COMPLETE</span></div>${soundControl()}</div></header><section class="results-layout"><div class="panel winner-panel"><p class="kicker">SEVEN TURNS COMPLETE</p>${winner?avatarMarkup(winner.avatar,'medium'):''}<h2>CYBER HEIST COMPLETE</h2>${winner?`<strong>${escapeHtml(winner.name)}</strong><span class="winner-score">${winner.finalScore} <small>FINAL SCORE</small></span>`:''}<p>Scores are server-calculated. Tie-break: higher Crypto, then higher Data, then lower player ID.</p></div><div class="panel results-board"><div class="panel-header"><span>FINAL SCOREBOARD</span><span>ASSET + OBJECTIVES + RISK</span></div>${rows.map((r,i)=>`<article class="result-row ${r.winner?'winner':''}"><span class="rank">${String(i+1).padStart(2,'0')}</span>${avatarMarkup(r.avatar,'small')}<div><strong>${escapeHtml(r.name)} ${r.winner?'<em class="winner-badge">WINNER</em>':''}</strong><small>Credits ${r.inventory.credits} · Data ${r.inventory.data} · Crypto ${r.inventory.crypto}</small></div><b class="result-value">${r.assetScore}</b><b class="result-bonus">+${r.objectiveBonus+r.securityBonus}</b><b class="result-score">${r.finalScore}</b></article>`).join('')}</div><div class="panel results-detail"><div><div class="panel-header"><span>WINNER BREAKDOWN</span><span>SERVER VERIFIED</span></div><div class="final-assets"><span>ASSET SCORE <b>${winner?.assetScore||0}</b></span><span>OBJECTIVE BONUS <b>+${winner?.objectiveBonus||0}</b></span><span>SECURITY BONUS <b>+${winner?.securityBonus||0}</b></span><span>FINAL <b>${winner?.finalScore||0}</b></span></div><div class="log-list">${(winner?.objectives||[]).map(o=>`<div class="log-line"><i class="log-dot ${o.completed?'success':'warning'}"></i><span>${o.completed?'✓ '+escapeHtml(o.label)+' · +'+o.bonus:'○ '+escapeHtml(o.label)+' · '+o.progress+'/'+o.target}</span></div>`).join('')}</div></div><div><div class="panel-header"><span>ALL OBJECTIVE RESULTS</span><span>PUBLIC AFTER MATCH</span></div><div class="results-objectives">${rows.map(r=>`<div class="result-objective-card"><strong>${escapeHtml(r.name)}</strong>${r.objectives.map(o=>`<span class="${o.completed?'done':''}">${o.completed?'✓':'○'} ${escapeHtml(o.label)} · ${o.progress}/${o.target}${o.completed?' · +'+o.bonus:''}</span>`).join('')}</div>`).join('')}</div></div></div><div class="results-actions"><button id="rematch" class="primary-button">PLAY AGAIN <b>↻</b></button><button id="results-lobby" class="secondary-button">RETURN TO LOBBY</button></div></section><footer><span>CYBER HEIST // STAGE 3C</span><span>FINAL SCORE SERVER VERIFIED</span></footer>`;app.querySelector('#rematch')?.addEventListener('click',rematch);app.querySelector('#results-lobby')?.addEventListener('click',rematch);}
async function rematch(){state.lastResolutionKey='';state.lastEventId=null;state.lastAudioResolutionKey='';state.lastAudioEventId=null;state.completedObjectiveIds=new Set();try{state.room=(await api('/api/rooms/rematch',{method:'POST'})).room;state.screen='lobby';state.selectedAction=null;state.selectedTarget=null;connectEvents();render();}catch(err){toast(err.title||'Rematch unavailable',err.message||'Wait for the round to finish.');}}
function connectEvents(){if(!state.sessionId)return;eventSource?.close();eventSource=new EventSource(`/api/rooms/events?session=${encodeURIComponent(state.sessionId)}`);eventSource.onmessage=handleEvent;['room:update','game:starting','turn:started','turn:resolved','game:results','room:rematch','player:left','player:disconnected','host:transferred'].forEach(n=>eventSource.addEventListener(n,handleEvent));eventSource.onerror=()=>{};}
function handleEvent(e){try{const room=JSON.parse(e.data);const previousTurn=state.lastTurn;state.room=room;if(room.phase==='lobby')state.screen='lobby';if(room.phase==='game'&&room.game?.phase==='decision'&&room.game.turn!==previousTurn){state.selectedAction=null;state.selectedTarget=null;if(previousTurn!==null)playSfx('select');flashGameFeel('turn-start');state.lastAudioTurn=room.game.turn;}if(e.type==='game:results'){playSfx('result');flashGameFeel('results');}state.lastTurn=room.game?.turn;render();}catch{}}
async function restoreSession(){await loadAvatars();if(!state.sessionId){render();return;}try{state.room=(await api('/api/rooms/me')).room;state.screen='lobby';connectEvents();render();}catch{localStorage.removeItem('cyberHeistSession');localStorage.removeItem('cyberHeistPlayer');state.sessionId='';state.playerId='';render();}}
document.addEventListener('pointerdown',()=>{unlockAudio();},{once:false,passive:true});
document.addEventListener('keydown',()=>{unlockAudio();},{once:false});
document.addEventListener('click',e=>{const button=e.target.closest('[data-sound-toggle]');if(button){e.preventDefault();unlockAudio().finally(()=>setSoundEnabled(!state.soundEnabled));}else if(state.room?.phase==='game')unlockAudio();});
window.addEventListener('beforeunload',()=>{eventSource?.close();stopTimer();stopMusic();});
window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change',e=>{audio.reducedMotion=e.matches;});
restoreSession();
