"use strict";
// --- FLY BIRDY ---------------------------------------------------------------
// Pure HTML5 Canvas game. No external libraries.
// Logical canvas: 400�600. CSS stretches to fill the full WebView.
// State machine: screen variable drives which draw/update function runs each frame.
// -----------------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = 400, H = 600; // virtual UI coordinate space � do not change
let RW = window.innerWidth, RH = window.innerHeight; // real screen dimensions
canvas.width = RW; canvas.height = RH;
window.addEventListener('resize', () => {
  RW=window.innerWidth; RH=window.innerHeight;
  canvas.width=RW; canvas.height=RH;
  BX=Math.round(RW*0.2);
  generateGameStars();
});

// Screen states
const S = { LOADING:'loading', WELCOME:'welcome', MODE_SELECT:'mode_select', LEVEL_SELECT:'level_select', BIRD_SELECT:'bird_select', SETTINGS:'settings', HIGH_SCORES:'highscores', GAME:'game', PAUSED:'paused', AUDIO:'audio', ACHIEVEMENTS:'achievements', CHALLENGE:'challenge', UNLIMITED_OPTS:'unlimited_opts' };
let screen = S.LOADING;

// --- AUDIO -------------------------------------------------------------------
// All sound generated via Web Audio API oscillators � no audio files needed.
// resumeAudio() must be called from a user-gesture handler (autoplay policy).
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let musicPlaying=false, bgNodes=[], musicEnabled=true, soundEnabled=true;
const masterMusicGain=audioCtx.createGain(); masterMusicGain.connect(audioCtx.destination);
const masterSFXGain=audioCtx.createGain();   masterSFXGain.connect(audioCtx.destination);
function resumeAudio(){ if(audioCtx.state==='suspended') audioCtx.resume(); }
function applyVolume(){ masterMusicGain.gain.value=save.settings.musicVol??0.8; masterSFXGain.gain.value=save.settings.soundVol??0.8; }
// Plays a single short oscillator tone (fire-and-forget)
function playTone(freq,type='square',dur=0.1,vol=0.3){
  if(!soundEnabled)return; resumeAudio();
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.connect(g);g.connect(masterSFXGain);
  o.type=type;o.frequency.value=freq;
  g.gain.setValueAtTime(vol,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);
  o.start();o.stop(audioCtx.currentTime+dur);
}
const SFX={
  flap:()=>{if(!playCustomOnce('flap'))playTone(520,'square',0.08,0.25);},
  // satisfying two-note ding when passing a pillar
  score:()=>{if(!playCustomOnce('score')){playTone(660,'sine',0.07,0.22);setTimeout(()=>playTone(990,'sine',0.12,0.28),75);}},
  die:()=>{if(!playCustomOnce('die'))playTone(200,'sawtooth',0.5,0.4);},
  coin:()=>playTone(1200,'sine',0.1,0.2),
  shoot:()=>playTone(900,'square',0.04,0.15),
  hit:()=>{if(!playCustomOnce('hit'))playTone(300,'sawtooth',0.2,0.3);},
  click:()=>{playTone(440,'sine',0.05,0.15);playTone(110,'sine',0.1,0.2);}, // click + bass thud
  levelup:()=>{if(!playCustomOnce('levelWin'))[523,659,784,1046].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.2,0.3),i*120));},
  highScore:()=>{if(!playCustomOnce('highScore'))[523,784,1046,1568].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.18,0.32),i*130));},
  lowHealth:()=>{if(!playCustomOnce('lowHealth'))playTone(220,'sawtooth',0.3,0.35);},
  // nature-specific powerup sounds
  heart:()=>{[523,659,784].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.12,0.3),i*90));},
  shield:()=>{playTone(180,'square',0.06,0.25);setTimeout(()=>playTone(360,'square',0.12,0.3),60);},
  magnet:()=>{[0,1,2,3,4].forEach(i=>setTimeout(()=>playTone(280+i*60,'square',0.04,0.18),i*35));}
};
// Background music loops MELODY endlessly by scheduling each note individually
// so stopMusic() can cancel pending nodes at any time without clicks or pops
const MELODY=[523,659,784,659,523,392,440,523];
function startMusic(){
  if(musicPlaying||!musicEnabled)return;
  musicPlaying=true;
  // Use custom music if loaded, otherwise fall back to oscillator melody
  if(customMusicBuffer){ startCustomMusic(); return; }
  resumeAudio(); scheduleLoop(audioCtx.currentTime);
}
function scheduleLoop(t){
  if(!musicPlaying)return;
  MELODY.forEach((f,i)=>{
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g);g.connect(masterMusicGain);o.frequency.value=f;
    g.gain.setValueAtTime(0.14,t+i*0.22);
    g.gain.exponentialRampToValueAtTime(0.001,t+i*0.22+0.2);
    o.start(t+i*0.22);o.stop(t+i*0.22+0.22);
    bgNodes.push(o);
    if(i===MELODY.length-1) o.onended=()=>{bgNodes=[];scheduleLoop(audioCtx.currentTime);};
  });
}
function stopMusic(){
  musicPlaying=false;
  bgNodes.forEach(n=>{try{n.stop();}catch(_){}});
  bgNodes=[];
  stopCustomMusic();
  releaseWakeLock();
}

// --- SAVE / LOAD -------------------------------------------------------------
// Fields merged individually so new fields always fall back to defaults in `save`.
const SAVE_KEY='flybirdy_v1';
let save={
  unlockedLevels:1,coins:0,
  highScores:[{name:'SWIFT',score:500},{name:'BLAZE',score:400},{name:'NOVA',score:300},{name:'REX',score:200},{name:'ACE',score:100}],
  settings:{music:true,sound:true,musicVol:0.8,soundVol:0.8,graphics:'high',shake:true,vibrate:true,hapticStrength:'medium',ghost:true,gapPreview:false,birdTrail:false,colorblind:false,showFPS:false,comboMultOn:true,particles:true},
  runHistory:[],
  unlockedBirds:['sparrow'],selectedBird:'sparrow',
  purchasedSkins:['sparrow_default'],
  selectedSkins:{sparrow:'sparrow_default',eagle:'eagle_default',owl:'owl_default',parrot:'parrot_default',flamingo:'flamingo_default'},
  achievements:{},   // id -> true when unlocked
  lastChallengeDate:'',challengeProgress:[0,0,0],challengeDone:[false,false,false]
};
function loadSave(){
  try{
    const d=JSON.parse(localStorage.getItem(SAVE_KEY));
    if(d){
      if(d.unlockedLevels) save.unlockedLevels=d.unlockedLevels;
      if(typeof d.coins==='number') save.coins=d.coins;
      if(d.highScores&&d.highScores.length){save.highScores=d.highScores.slice(0,5);}
      if(d.settings) save.settings={...save.settings,...d.settings};
      if(d.achievements) save.achievements={...save.achievements,...d.achievements};
      if(d.lastChallengeDate) save.lastChallengeDate=d.lastChallengeDate;
      if(d.challengeProgress) save.challengeProgress=d.challengeProgress;
      if(d.challengeDone) save.challengeDone=d.challengeDone;
      if(d.unlockedBirds) save.unlockedBirds=d.unlockedBirds;
      if(d.selectedBird) save.selectedBird=d.selectedBird;
      if(d.purchasedSkins) save.purchasedSkins=d.purchasedSkins;
      if(d.selectedSkins) save.selectedSkins={...save.selectedSkins,...d.selectedSkins};
      if(d.runHistory) save.runHistory=d.runHistory.slice(0,10);
    }
  }catch(_){}
  musicEnabled=save.settings.music; soundEnabled=save.settings.sound;
}
function writeSave(){ try{localStorage.setItem(SAVE_KEY,JSON.stringify(save));}catch(_){} }
// Returns true when score qualifies for the top-5 leaderboard
function isTopScore(score){
  return save.highScores.length<5||score>save.highScores[save.highScores.length-1].score;
}
function addHighScore(name,score){
  save.highScores.push({name:(name||'BIRD').substring(0,12).toUpperCase(),score});
  save.highScores.sort((a,b)=>b.score-a.score);
  save.highScores=save.highScores.slice(0,5);
  writeSave();
}

// --- LEVEL DATA --------------------------------------------------------------
// pipeSpeed: px/frame  |  gap: bird passage height (px)  |  interval: spacing factor
// targetScore: pipes to clear to win the adventure level
const LEVELS=[
  {pipeSpeed:2,  gap:200,interval:180,targetScore:5, bg:'day',   hasEnemies:false,hasBoss:false},
  {pipeSpeed:2.5,gap:195,interval:175,targetScore:8, bg:'day',   hasEnemies:false,hasBoss:false},
  {pipeSpeed:3,  gap:190,interval:168,targetScore:10,bg:'day',   hasEnemies:false,hasBoss:false},
  {pipeSpeed:3.2,gap:185,interval:165,targetScore:12,bg:'sunset',hasEnemies:false,hasBoss:false},
  {pipeSpeed:3.5,gap:178,interval:160,targetScore:15,bg:'sunset',hasEnemies:true, hasBoss:false},
  {pipeSpeed:3.8,gap:172,interval:155,targetScore:18,bg:'sunset',hasEnemies:true, hasBoss:false},
  {pipeSpeed:4,  gap:166,interval:152,targetScore:20,bg:'night', hasEnemies:true, hasBoss:false},
  {pipeSpeed:4.5,gap:160,interval:150,targetScore:22,bg:'night', hasEnemies:true, hasBoss:false},
  {pipeSpeed:5,  gap:154,interval:148,targetScore:25,bg:'night', hasEnemies:true, hasBoss:false},
  {pipeSpeed:5,  gap:148,interval:145,targetScore:30,bg:'space', hasEnemies:true, hasBoss:true}
];

// --- BIRD DATA ---------------------------------------------------------------
// Each bird has a passive or active skill that modifies gameplay behaviour.
const BIRDS={
  sparrow: {name:'Sparrow', cost:0,  color:'#FFD700',body:'#FFA500',skillType:'passive',skillDesc:'Double coins from pipes'},
  eagle:   {name:'Eagle',   cost:50, color:'#C8A050',body:'#8B6318',skillType:'active', skillDesc:'Stronger boost when falling hard'},
  owl:     {name:'Owl',     cost:80, color:'#B0B0B0',body:'#707070',skillType:'passive',skillDesc:'Ghost preview of upcoming pipes'},
  parrot:  {name:'Parrot',  cost:100,color:'#00D060',body:'#008040',skillType:'passive',skillDesc:'Start with 2 HP'},
  flamingo:{name:'Flamingo',cost:150,color:'#FF69B4',body:'#FF1493',skillType:'passive',skillDesc:'Slower gravity � floats gently'}
};
const BIRD_KEYS=Object.keys(BIRDS);

// --- SKIN DATA ---------------------------------------------------------------
// 5 skins per bird: 1 free default + 4 purchasable colour variants.
const SKINS={
  sparrow:[
    {id:'sparrow_default',name:'Default',  cost:0,  color:'#FFD700',body:'#FFA500'},
    {id:'sparrow_ruby',   name:'Ruby',     cost:25, color:'#FF4455',body:'#CC1122'},
    {id:'sparrow_sky',    name:'Sky',      cost:25, color:'#44AAFF',body:'#0066CC'},
    {id:'sparrow_lime',   name:'Lime',     cost:30, color:'#88FF44',body:'#448800'},
    {id:'sparrow_royal',  name:'Royal',    cost:40, color:'#CC44FF',body:'#7700BB'},
  ],
  eagle:[
    {id:'eagle_default',  name:'Default',  cost:0,  color:'#C8A050',body:'#8B6318'},
    {id:'eagle_midnight', name:'Midnight', cost:30, color:'#445588',body:'#223366'},
    {id:'eagle_crimson',  name:'Crimson',  cost:30, color:'#DD2233',body:'#991122'},
    {id:'eagle_snow',     name:'Snow',     cost:35, color:'#E8E8FF',body:'#AAAACC'},
    {id:'eagle_gold',     name:'Gold',     cost:45, color:'#FFD700',body:'#CC9900'},
  ],
  owl:[
    {id:'owl_default',    name:'Default',  cost:0,  color:'#B0B0B0',body:'#707070'},
    {id:'owl_rust',       name:'Rust',     cost:25, color:'#CC6622',body:'#884411'},
    {id:'owl_teal',       name:'Teal',     cost:25, color:'#22CCAA',body:'#118866'},
    {id:'owl_violet',     name:'Violet',   cost:35, color:'#9966DD',body:'#663399'},
    {id:'owl_ivory',      name:'Ivory',    cost:40, color:'#FFEECC',body:'#CCAA88'},
  ],
  parrot:[
    {id:'parrot_default', name:'Default',  cost:0,  color:'#00D060',body:'#008040'},
    {id:'parrot_scarlet', name:'Scarlet',  cost:30, color:'#FF3322',body:'#CC1100'},
    {id:'parrot_cobalt',  name:'Cobalt',   cost:30, color:'#2255FF',body:'#0033BB'},
    {id:'parrot_lemon',   name:'Lemon',    cost:35, color:'#FFEE22',body:'#BBAA00'},
    {id:'parrot_coral',   name:'Coral',    cost:45, color:'#FF7755',body:'#CC4422'},
  ],
  flamingo:[
    {id:'flamingo_default',name:'Default', cost:0,  color:'#FF69B4',body:'#FF1493'},
    {id:'flamingo_peach',  name:'Peach',   cost:30, color:'#FFAA77',body:'#EE7744'},
    {id:'flamingo_lavender',name:'Lavender',cost:30,color:'#CC88FF',body:'#9944CC'},
    {id:'flamingo_mint',   name:'Mint',    cost:35, color:'#88FFCC',body:'#44BB88'},
    {id:'flamingo_dusk',   name:'Dusk',    cost:45, color:'#FF8866',body:'#CC5533'},
  ]
};
// Returns the currently equipped skin object for a bird, falling back to default
function getActiveSkin(birdKey){
  const id=save.selectedSkins[birdKey]||birdKey+'_default';
  const skins=SKINS[birdKey]||[];
  return skins.find(s=>s.id===id)||skins[0]||BIRDS[birdKey];
}

let shopTab='birds'; // persists between shop visits: 'birds' | 'skins'
let hsTab='top5';   // high-scores screen tab: 'top5' | 'history'
let fps=60, _loopFPS=0, _lastFPSTime=Date.now();
let wakeLock=null;
async function requestWakeLock(){if('wakeLock' in navigator){try{wakeLock=await navigator.wakeLock.request('screen');}catch(_){}}}
function releaseWakeLock(){if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}}

// --- SCREEN TRANSITIONS -------------------------------------------------------
let trans={alpha:0,dir:0,cb:null}; // dir: 1=fading out, -1=fading in
function goScreen(newScreenFn){
  if(trans.dir!==0)return;
  trans.dir=1;trans.alpha=0;
  trans.cb=()=>{ newScreenFn(); trans.dir=-1; };
}
function drawTransition(){
  if(trans.dir===0)return;
  trans.alpha+=trans.dir*0.08;
  if(trans.alpha>=1&&trans.dir===1){ trans.alpha=1; if(trans.cb){trans.cb();trans.cb=null;} }
  if(trans.alpha<=0&&trans.dir===-1){ trans.alpha=0; trans.dir=0; return; }
  ctx.fillStyle=`rgba(0,0,0,${trans.alpha})`;
  ctx.fillRect(0,0,RW,RH);
}

// --- CONFETTI BURST -----------------------------------------------------------
const confetti=[];
const CONFETTI_COLS=['#FF4444','#FFD700','#44FF88','#44AAFF','#FF44FF','#FF8844'];
function spawnConfetti(){
  for(let i=0;i<80;i++){
    confetti.push({
      x:Math.random()*RW, y:Math.random()*RH*0.4,
      vx:(Math.random()-0.5)*6, vy:1+Math.random()*4,
      life:120+Math.random()*60, maxLife:180,
      r:3+Math.random()*4, color:CONFETTI_COLS[Math.floor(Math.random()*CONFETTI_COLS.length)],
      rot:Math.random()*Math.PI*2, rotV:(Math.random()-0.5)*0.2
    });
  }
}
function drawConfetti(){
  if(confetti.length===0)return;
  for(let i=confetti.length-1;i>=0;i--){
    const c=confetti[i];
    c.x+=c.vx;c.y+=c.vy;c.vy+=0.06;c.rot+=c.rotV;c.life--;
    ctx.globalAlpha=Math.min(1,c.life/40);
    ctx.fillStyle=c.color;
    ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.rot);
    ctx.fillRect(-c.r,-c.r/2,c.r*2,c.r);
    ctx.restore();
    if(c.life<=0) confetti.splice(i,1);
  }
  ctx.globalAlpha=1;
}

// --- NAME ENTRY --------------------------------------------------------------
// Uses a hidden <input> so the native keyboard appears on mobile (prompt() is unreliable in Capacitor)
let nameEntry={active:false,text:'',onDone:null};
function askPlayerName(cb){
  nameEntry.active=true;nameEntry.text='PLAYER';nameEntry.onDone=cb;
  const el=document.getElementById('nameInput');
  if(el){el.value='PLAYER';el.select();el.focus();}
}
function submitPlayerName(){
  const el=document.getElementById('nameInput');
  const name=((el?el.value:nameEntry.text)||'BIRD').trim().substring(0,12)||'BIRD';
  nameEntry.active=false;
  document.getElementById('nameInput').blur();
  if(nameEntry.onDone) nameEntry.onDone(name.toUpperCase());
}
function drawNameEntry(){
  if(!nameEntry.active)return;
  const el=document.getElementById('nameInput');
  if(el) nameEntry.text=el.value; // sync live typing from native keyboard
  ctx.fillStyle='rgba(0,0,0,0.78)';ctx.fillRect(0,0,W,H);
  roundRect(40,185,320,175,14,'#1a1a2e','#FFD700',2);
  ctx.fillStyle='#FFD700';ctx.font='bold 22px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('★ New Top 5!',W/2,218);
  ctx.fillStyle='#ddd';ctx.font='15px Arial';ctx.fillText('Enter your name:',W/2,248);
  roundRect(60,262,280,42,8,'#2a2a4a','#FFD700');
  const display=(nameEntry.text||'').toUpperCase().substring(0,12);
  ctx.fillStyle='#fff';ctx.font='bold 20px Arial';ctx.fillText(display+'|',W/2,283);
  btn(100,322,200,46,'Done ?','#27AE60',submitPlayerName,16);
}

// --- POPUP --------------------------------------------------------------------
// Auto-dismissing overlay message (e.g. "Not enough coins!"). Fades out over last 30 frames.
let popup={msg:'',timer:0};
function showPopup(msg){popup.msg=msg;popup.timer=120;} // 120 frames � 2 s
function drawPopup(){
  if(popup.timer<=0)return;
  popup.timer--;
  const alpha=popup.timer<30?popup.timer/30:1;
  ctx.globalAlpha=alpha;
  roundRect(W/2-130,H/2-28,260,56,12,'rgba(30,0,0,0.88)','#FF4444',2);
  ctx.fillStyle='#FF6666';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(popup.msg,W/2,H/2);
  ctx.globalAlpha=1;
}

// --- GAME STATE --------------------------------------------------------------
let gs={};          // mutable runtime game state, reset on each new game
const BR=14;        // bird collision radius (px)
let BX=Math.round(RW*0.2); // bird X position: 20% from left edge, scales with screen width

// Builds a shuffled [heart, shield, magnet] queue; prevents two identical back-to-back types
function makePuQueue(lastType){
  const base=['heart','shield','magnet'];
  for(let i=base.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[base[i],base[j]]=[base[j],base[i]];}
  // prevent first of new cycle matching last of previous cycle
  if(lastType&&base[0]===lastType){const swap=1+Math.floor(Math.random()*(base.length-1));[base[0],base[swap]]=[base[swap],base[0]];}
  return base;
}

// --- ENDLESS MODIFIERS -------------------------------------------------------
// Active modifiers for unlimited mode only. Rotated every 20 pipes.
const ENDLESS_MODS=['mirror','tiny','zen','weather','reverse','slow_miss','milestone','pipe_rush','double_gap','moving_pipes','low_grav','fog','coin_frenzy','ghost_pipes'];
const MOD_LABELS={mirror:'Mirror',tiny:'Tiny Bird',zen:'Zen',weather:'Weather',reverse:'Reverse',slow_miss:'Slow-mo',milestone:'Milestone',pipe_rush:'Pipe Rush',double_gap:'Double Gap',moving_pipes:'Moving Pipes',low_grav:'Low Grav',fog:'Fog',coin_frenzy:'Coin Frenzy',ghost_pipes:'Ghost Pipes'};
// Pairs that cannot coexist: each entry blocks its counterpart when selected
const MOD_CONFLICTS={
  zen:       ['ghost_pipes'],   // both remove all collision danger
  ghost_pipes:['zen','double_gap'], // ghost bypasses barriers; redundant with zen
  double_gap: ['ghost_pipes'],  // barrier meaningless when you can fly through pipes
  pipe_rush:  ['slow_miss'],    // opposing speed modifiers
  slow_miss:  ['pipe_rush'],
  mirror:     ['reverse'],      // flipping both axes makes controls incomprehensible
  reverse:    ['mirror'],
};
let activeMods=new Set(); // currently active modifier set
let modRotateAt=20;       // score threshold for next modifier rotation
// User-selected mods for the upcoming unlimited run; 'random' means auto-rotation
let selectedMods=new Set();          // empty = random auto-rotation
let unlimitedDropOpen=false;
let practiceMode=false;   // set in Unlimited Opts; unlimited lives, score not saved

function pickMods(){
  // empty set = random auto-rotation; otherwise respect manual selections
  if(selectedMods.size>0)return;
  // 1-2 random mods, never more than 2 at once
  activeMods.clear();
  const shuffled=[...ENDLESS_MODS].sort(()=>Math.random()-0.5);
  const count=1+Math.floor(Math.random()*2);
  for(let i=0;i<count;i++) activeMods.add(shuffled[i]);
  modRotateAt=gs.score+15+Math.floor(Math.random()*10);
  showPopup('Mode: '+[...activeMods].map(m=>MOD_LABELS[m]||m).join(' + '));
}

// --- GHOST REPLAY SYSTEM -----------------------------------------------------
const GHOST_KEY='flybirdy_ghost_v1';
let ghostFrames=[];         // records birdY each frame during a run
let ghostPlayback=[];       // loaded from storage for display
let ghostFrame=0;

function recordGhostFrame(){ if(save.settings.ghost) ghostFrames.push(gs.birdY); }
function saveGhostIfBest(){
  if(!save.settings.ghost||ghostFrames.length===0)return;
  try{ localStorage.setItem(GHOST_KEY,JSON.stringify(ghostFrames)); }catch(_){}
}
function loadGhost(){
  try{ const d=localStorage.getItem(GHOST_KEY); if(d) ghostPlayback=JSON.parse(d); }catch(_){ ghostPlayback=[]; }
  ghostFrame=0;
}
function drawGhost(){
  if(!save.settings.ghost||ghostPlayback.length===0)return;
  const gy=ghostPlayback[Math.min(ghostFrame,ghostPlayback.length-1)];
  ghostFrame++;
  ctx.globalAlpha=0.28;
  drawBirdAt(BX,gy,gs.bird);
  ctx.globalAlpha=1;
}

// --- SCREEN SHAKE ------------------------------------------------------------
let shakeTimer=0, shakeAmt=0;
function triggerShake(amt=8,dur=12){
  if(!save.settings.shake)return;
  shakeAmt=amt; shakeTimer=dur;
}
function applyShake(){
  if(shakeTimer<=0)return;
  shakeTimer--;
  const decay=shakeTimer/12;
  ctx.translate((Math.random()-0.5)*shakeAmt*decay,(Math.random()-0.5)*shakeAmt*decay);
}

// --- VIBRATION ---------------------------------------------------------------
function vibrate(ms=60){
  if(!save.settings.vibrate)return;
  const mult=save.settings.hapticStrength==='light'?0.4:save.settings.hapticStrength==='strong'?2:1;
  try{ navigator.vibrate&&navigator.vibrate(Math.round(ms*mult)); }catch(_){}
}

// --- ACHIEVEMENTS ------------------------------------------------------------
const ACHV=[
  {id:'first_pipe',   icon:'🎯', name:'First Blood',     desc:'Pass your first pipe'},
  {id:'score_10',     icon:'⚡', name:'Speedy',          desc:'Score 10 in any mode'},
  {id:'score_50',     icon:'🌟', name:'50 Club',         desc:'Score 50 in Unlimited'},
  {id:'score_100',    icon:'💯', name:'Century',         desc:'Score 100 in Unlimited'},
  {id:'die_pipe1',    icon:'💀', name:'Instant Shame',   desc:'Die on the very first pipe'},
  {id:'all_birds',    icon:'🦅', name:'Bird Collector',  desc:'Unlock all 5 birds'},
  {id:'beat_lvl5',    icon:'🏆', name:'Halfway Hero',    desc:'Beat adventure level 5'},
  {id:'beat_all',     icon:'👑', name:'Champion',        desc:'Beat all 10 adventure levels'},
  {id:'coins_100',    icon:'💰', name:'Coin Hoarder',    desc:'Collect 100 total coins'},
  {id:'coins_500',    icon:'💎', name:'Rich Bird',       desc:'Collect 500 total coins'},
  {id:'owl_freeze',   icon:'❄️', name:'Ice Cold',        desc:'Use Owl freeze 5 times'},
  {id:'eagle_charge', icon:'⚡', name:'Thunder Strike',  desc:'Use Eagle charge flap 10 times'},
  {id:'parrot_shield',icon:'🛡️', name:'Untouchable',     desc:'Let parrot auto-shield trigger 5 times'},
  {id:'flamingo_glide',icon:'🪶',name:'Graceful',        desc:'Glide for 3 seconds total'},
  {id:'milestone_10', icon:'🔥', name:'On Fire',         desc:'Hit 10-pipe milestone in Unlimited'},
  {id:'all_mods',     icon:'🎲', name:'Chaos Master',    desc:'Experience all 7 endless modifiers'},
  {id:'ghost_beat',   icon:'👻', name:'Ghost Buster',    desc:'Beat your own ghost replay'},
  {id:'zen_20',       icon:'☮️', name:'Zen Master',      desc:'Score 20 in Zen mode'},
  {id:'mirror_10',    icon:'🪞', name:'Mirror Mirror',   desc:'Score 10 in Mirror mode'},
  {id:'tiny_15',      icon:'🐣', name:'Tiny Terror',     desc:'Score 15 in Tiny Bird mode'},
];
let achvStats={owlFreezeCount:0,eagleChargeCount:0,parrotShieldCount:0,flamingoGlideFrames:0,modsSeen:new Set(),ghostBeaten:false};

function unlockAchv(id){
  if(save.achievements[id])return;
  save.achievements[id]=true;
  writeSave();
  const a=ACHV.find(x=>x.id===id);
  if(a) showPopup(a.icon+' Achieved: '+a.name);
}
function checkAchievements(){
  if(gs.score>=1) unlockAchv('first_pipe');
  if(gs.score>=10) unlockAchv('score_10');
  if(gs.mode==='unlimited'){
    if(gs.score>=50) unlockAchv('score_50');
    if(gs.score>=100) unlockAchv('score_100');
    if(activeMods.has('milestone')&&gs.score>0&&gs.score%10===0) unlockAchv('milestone_10');
    if(activeMods.has('zen')&&gs.score>=20) unlockAchv('zen_20');
    if(activeMods.has('mirror')&&gs.score>=10) unlockAchv('mirror_10');
    if(activeMods.has('tiny')&&gs.score>=15) unlockAchv('tiny_15');
  }
  if(save.unlockedBirds.length>=5) unlockAchv('all_birds');
  if(save.coins>=100) unlockAchv('coins_100');
  if(save.coins>=500) unlockAchv('coins_500');
  if(achvStats.owlFreezeCount>=5) unlockAchv('owl_freeze');
  if(achvStats.eagleChargeCount>=10) unlockAchv('eagle_charge');
  if(achvStats.parrotShieldCount>=5) unlockAchv('parrot_shield');
  if(achvStats.flamingoGlideFrames>=180) unlockAchv('flamingo_glide');
  if(achvStats.modsSeen.size>=7) unlockAchv('all_mods');
  if(achvStats.ghostBeaten) unlockAchv('ghost_beat');
}

// --- DAILY CHALLENGE ---------------------------------------------------------
const CHALLENGE_POOL=[
  {desc:'Score 5 in Unlimited',   check:gs=>gs.mode==='unlimited'&&gs.score>=5,   reward:20},
  {desc:'Score 10 in Unlimited',  check:gs=>gs.mode==='unlimited'&&gs.score>=10,  reward:35},
  {desc:'Score 20 in Unlimited',  check:gs=>gs.mode==='unlimited'&&gs.score>=20,  reward:60},
  {desc:'Collect 15 coins in one run', check:gs=>gs.sessionCoins>=15,             reward:25},
  {desc:'Collect 30 coins in one run', check:gs=>gs.sessionCoins>=30,             reward:50},
  {desc:'Use Eagle charge 3 times',check:gs=>achvStats.eagleChargeCount>=3,       reward:30},
  {desc:'Survive 5 pipes with Parrot', check:gs=>gs.bird==='parrot'&&gs.score>=5, reward:30},
  {desc:'Play in Mirror mode',    check:gs=>gs.mode==='unlimited'&&activeMods.has('mirror')&&gs.score>=1, reward:20},
  {desc:'Play in Zen mode',       check:gs=>gs.mode==='unlimited'&&activeMods.has('zen')&&gs.score>=1,    reward:20},
  {desc:'Score 8 in Tiny Bird mode',check:gs=>gs.mode==='unlimited'&&activeMods.has('tiny')&&gs.score>=8,reward:40},
];
let dailyChallenges=[];

function todayStr(){ return new Date().toISOString().slice(0,10); }
function refreshDailyChallenges(){
  const today=todayStr();
  if(save.lastChallengeDate===today) return;
  // Seed selection with date string for determinism
  const seed=today.replace(/-/g,'').split('').reduce((a,c)=>a*31+c.charCodeAt(0),0);
  const pick=(i)=>CHALLENGE_POOL[(seed+i*13)%CHALLENGE_POOL.length];
  dailyChallenges=[pick(0),pick(1),pick(2)];
  save.lastChallengeDate=today;
  save.challengeProgress=[0,0,0];
  save.challengeDone=[false,false,false];
  writeSave();
}
function checkDailyChallenges(){
  refreshDailyChallenges();
  dailyChallenges.forEach((ch,i)=>{
    if(save.challengeDone[i])return;
    if(ch.check(gs)){
      save.challengeDone[i]=true;
      save.coins+=ch.reward;
      writeSave();
      showPopup('Challenge done! +'+ch.reward+' coins');
    }
  });
}

// --- BIRD ACTIVE SKILLS ------------------------------------------------------
let holdStartTime=0;    // for eagle charge and flamingo glide
let isHolding=false;
let owlFreezeLeft=1;    // resets each game; how many freezes remain
let owlFreezeTimer=0;   // frames remaining of active freeze
let parrotShieldPipes=0;// pipes scored since last auto-shield

// Initialises all mutable game state for a fresh run
function initGameState(levelId,mode){
  const lvl=(mode==='unlimited')?{...LEVELS[0],bg:'day'}:{...LEVELS[levelId-1]};
  if(mode==='adventure') lvl.gap+=40; // adventure is more forgiving
  const startHp=mode==='survival'?5:save.selectedBird==='parrot'?2:1;
  // Gauntlet: generate 30 deterministic gap positions seeded by today's date
  let gauntletGaps=null;
  if(mode==='gauntlet'){
    const seed=new Date().toISOString().slice(0,10).replace(/-/g,'').split('').reduce((a,c)=>a*31+c.charCodeAt(0),1);
    let s=seed;
    gauntletGaps=Array.from({length:30},()=>{s=(s*1664525+1013904223)&0x7fffffff;return 60+(s%Math.round(RH*0.55));});
  }
  gs={
    mode,levelId,level:lvl,bird:save.selectedBird,
    birdY:RH/2,velocity:0,score:0,sessionCoins:0,
    hp:startHp,maxHp:startHp,
    pipes:[],coinItems:[],powerups:[],enemies:[],bullets:[],enemyBullets:[],
    boss:null,bossSpawned:false,canShoot:false,shootCooldown:0,
    frameCount:0,invincible:0,shieldTimer:0,magnetTimer:0,
    started:false,over:false,won:false,
    pipeSpeed:lvl.pipeSpeed,speedMult:1,particles:[],nameEntered:false,
    puQueue:[],lastPuType:null,puCountdown:mode==='unlimited'?10+Math.floor(Math.random()*3):5,
    bgClouds:Array.from({length:6},()=>({x:Math.random()*RW,y:40+Math.random()*(RH*0.35),w:60+Math.random()*80,h:25+Math.random()*20,speed:0.3+Math.random()*0.4})),
    // death animation state
    deathAngle:0,deathVX:0,deathVY:0,
    // slow-mo state
    slowMoTimer:0,
    // new per-run state
    timeLeft:mode==='time_trial'?60*60:0,
    comboStreak:0, pbToastShown:false, trail:[], pipeRushMult:1,
    practice:(mode==='unlimited'&&practiceMode),
    gauntletGaps, gauntletPipe:0, // fixed pipe sequence for Gauntlet mode
    // weather
    rainDrops:Array.from({length:60},()=>({x:Math.random()*RW,y:Math.random()*RH,spd:8+Math.random()*6})),
    snowFlakes:Array.from({length:50},()=>({x:Math.random()*RW,y:Math.random()*RH,r:1+Math.random()*2,spd:1+Math.random()*2})),
  };
  // reset per-run bird skill state
  holdStartTime=0; isHolding=false;
  owlFreezeLeft=1; owlFreezeTimer=0; parrotShieldPipes=0;
  // modifiers: apply manual selections or prepare for random rotation
  if(mode==='unlimited'){
    activeMods.clear();
    if(selectedMods.size===0){
      modRotateAt=20; // auto-rotate via pickMods()
    }else{
      ENDLESS_MODS.forEach(m=>{ if(selectedMods.has(m)) activeMods.add(m); });
      modRotateAt=Infinity; // no auto-rotation when mods are manually chosen
    }
    ghostFrames=[]; loadGhost();
  } else { activeMods.clear(); }
  if(mode==='gauntlet') activeMods.clear(); // gauntlet has no modifiers
  refreshDailyChallenges();
}

// UI stars in virtual 400�600 space; game stars generated for real screen dimensions
const UI_SPACE_STARS=[[20,30,0.55,1],[70,15,0.7,1],[140,60,0.45,2],[210,8,0.8,1],[280,45,0.6,1],[360,25,0.75,2],[45,180,0.5,1],[175,140,0.65,1],[310,170,0.4,1],[90,250,0.7,1],[250,220,0.55,2],[380,260,0.8,1],[50,350,0.6,1],[200,320,0.45,1],[350,380,0.7,2]];
const UI_NIGHT_STARS=[[50,40],[110,25],[190,55],[275,20],[340,60],[80,110],[230,80],[370,35],[30,160],[155,130]];
let GAME_SPACE_STARS=[], GAME_NIGHT_STARS=[];
function generateGameStars(){
  GAME_SPACE_STARS=Array.from({length:40},()=>[Math.random()*RW,Math.random()*RH*0.85,0.45+Math.random()*0.35,1+Math.floor(Math.random()*2)]);
  GAME_NIGHT_STARS=Array.from({length:20},()=>[Math.random()*RW,Math.random()*RH*0.3]);
}
generateGameStars();
let inGameDraw=false; // true when rendering game world at real screen coordinates

// Shared clouds for menu/non-game screens
const menuClouds=Array.from({length:6},()=>({x:Math.random()*W,y:40+Math.random()*200,w:60+Math.random()*80,h:25+Math.random()*20,speed:0.25+Math.random()*0.35}));
setInterval(()=>{for(const c of menuClouds){c.x-=c.speed;if(c.x+c.w<0){c.x=W+c.w;c.y=40+Math.random()*200;}}},16);

// --- BUTTON SYSTEM -------------------------------------------------------------
// btns[] is rebuilt each frame. btn() draws and registers; hitBtn() resolves taps.
let btns=[];
// Draws a rounded rectangle, optionally filled and/or stroked
function roundRect(x,y,w,h,r,fill,stroke,lineW=2){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
  if(fill){ctx.fillStyle=fill;ctx.fill();}
  if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lineW;ctx.stroke();}
}
// Registers a hit-test button in real screen coords, accounting for any active scale transform
function pushBtn(x,y,w,h,action){
  const t=ctx.getTransform(); btns.push({x:x*t.a+t.e,y:y*t.d+t.f,w:w*t.a,h:h*t.d,action});
}
// Draws a button and registers its hit-test region; disabled=true greys it out and blocks taps
function btn(x,y,w,h,label,color,action,fontSize=15,disabled=false){
  const t=ctx.getTransform(); btns.push({x:x*t.a+t.e,y:y*t.d+t.f,w:w*t.a,h:h*t.d,action:disabled?null:action});
  const prevAlpha=ctx.globalAlpha; ctx.globalAlpha=1; // always fully opaque
  roundRect(x,y,w,h,8,disabled?'#555':color,disabled?'#888':'rgba(255,255,255,0.9)',2.5);
  ctx.fillStyle=disabled?'#aaa':'#fff';
  ctx.font=`bold ${fontSize}px Arial`;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(label,x+w/2,y+h/2);
  ctx.globalAlpha=prevAlpha;
}
// Walks btns[] front-to-back and fires the first hit action; returns true if something was hit
function hitBtn(px,py){
  for(const b of btns){
    if(b.action&&px>=b.x&&px<=b.x+b.w&&py>=b.y&&py<=b.y+b.h){
      SFX.click();b.action();return true;
    }
  }
  return false;
}

// --- BACKGROUNDS --------------------------------------------------------------
// drawClouds() reads gs.bgClouds during gameplay, menuClouds on menu screens
function drawBg(type){
  const BW=inGameDraw?RW:W, BH=inGameDraw?RH:H;
  const S_STARS=inGameDraw?GAME_SPACE_STARS:UI_SPACE_STARS;
  const N_STARS=inGameDraw?GAME_NIGHT_STARS:UI_NIGHT_STARS;
  let g;
  if(type==='day'){
    g=ctx.createLinearGradient(0,0,0,BH);
    g.addColorStop(0,'#5BC8F5');g.addColorStop(1,'#C8F0FA');
    ctx.fillStyle=g;ctx.fillRect(0,0,BW,BH);
    drawClouds();
    ctx.fillStyle='#7EC850';ctx.fillRect(0,BH-40,BW,40);
    ctx.fillStyle='#5A9630';ctx.fillRect(0,BH-12,BW,12);
  }else if(type==='sunset'){
    g=ctx.createLinearGradient(0,0,0,BH);
    g.addColorStop(0,'#FF5544');g.addColorStop(0.4,'#FF8C00');g.addColorStop(1,'#FFD080');
    ctx.fillStyle=g;ctx.fillRect(0,0,BW,BH);
    ctx.fillStyle='#FFF176';ctx.beginPath();ctx.arc(BW*0.8,BH-80,35,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#4A2810';ctx.fillRect(0,BH-40,BW,40);
    ctx.fillStyle='#3A1E08';ctx.fillRect(0,BH-12,BW,12);
  }else if(type==='night'){
    g=ctx.createLinearGradient(0,0,0,BH);
    g.addColorStop(0,'#0A0E2A');g.addColorStop(1,'#1A2244');
    ctx.fillStyle=g;ctx.fillRect(0,0,BW,BH);
    N_STARS.forEach(([sx,sy])=>{
      ctx.globalAlpha=0.45+Math.sin(Date.now()/1200+sx)*0.25;
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(sx,sy,1.5,0,Math.PI*2);ctx.fill();
    });
    ctx.globalAlpha=1;
    ctx.fillStyle='#FFFACD';ctx.beginPath();ctx.arc(BW*0.825,70,28,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#0A0E2A';ctx.beginPath();ctx.arc(BW*0.795,62,24,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#303060';ctx.fillRect(0,BH-40,BW,40);
  }else if(type==='space'){
    ctx.fillStyle='#000010';ctx.fillRect(0,0,BW,BH);
    S_STARS.forEach(([sx,sy,a,r])=>{
      ctx.globalAlpha=a;
      ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(sx,sy,r,0,Math.PI*2);ctx.fill();
    });
    ctx.globalAlpha=1;
    const neb=ctx.createRadialGradient(BW*0.5,BH*0.58,0,BW*0.5,BH*0.58,BH*0.22);
    neb.addColorStop(0,'rgba(80,0,120,0.22)');neb.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=neb;ctx.fillRect(0,0,BW,BH);
  }
}
function drawClouds(){
  const clouds=gs.bgClouds||menuClouds;
  for(const c of clouds){
    ctx.fillStyle='rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(c.x,c.y,c.w/2,c.h/2,0,0,Math.PI*2);
    ctx.ellipse(c.x-c.w*0.25,c.y+6,c.w*0.32,c.h*0.42,0,0,Math.PI*2);
    ctx.ellipse(c.x+c.w*0.22,c.y+6,c.w*0.32,c.h*0.42,0,0,Math.PI*2);
    ctx.fill();
  }
}
// Advances in-game cloud positions; menu clouds are moved by their own setInterval
function moveClouds(){
  if(!gs.bgClouds)return;
  for(const c of gs.bgClouds){c.x-=c.speed;if(c.x+c.w<0){c.x=RW+c.w;c.y=40+Math.random()*(RH*0.35);}}
}

// --- BIRD SPRITE ---------------------------------------------------------------
// Renders the bird using canvas primitives. skinOverride lets the shop preview any skin.
// flapUp=true tilts the wing upward for the mid-flap frame.
function drawBirdAt(x,y,birdKey,flapUp=false,skinOverride=null){
  const skin=skinOverride||getActiveSkin(birdKey);
  const b={...BIRDS[birdKey]||BIRDS.sparrow, color:skin.color, body:skin.body};
  ctx.save();ctx.translate(x,y);
  ctx.fillStyle=b.body;ctx.beginPath();ctx.ellipse(0,0,17,12,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=b.color;ctx.beginPath();ctx.ellipse(-3,flapUp?-10:6,11,5,flapUp?-0.5:0.3,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=b.color;ctx.beginPath();ctx.arc(9,-8,10,0,Math.PI*2);ctx.fill();
  if(birdKey==='owl'){
    ctx.fillStyle=b.body;
    [[4,-18,-0.5],[14,-18,0.5]].forEach(([ex,ey,a])=>{
      ctx.save();ctx.translate(ex,ey);ctx.rotate(a);
      ctx.beginPath();ctx.moveTo(-3,0);ctx.lineTo(0,-9);ctx.lineTo(3,0);ctx.closePath();ctx.fill();
      ctx.restore();
    });
  }
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(14,-10,4,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#111';ctx.beginPath();ctx.arc(15,-10,2,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(15.5,-11,0.8,0,Math.PI*2);ctx.fill();
  ctx.fillStyle=birdKey==='eagle'?'#FFD700':'#FF8C00';
  ctx.beginPath();
  if(birdKey==='eagle'){ctx.moveTo(20,-10);ctx.lineTo(30,-14);ctx.lineTo(26,-7);ctx.closePath();}
  else{ctx.moveTo(20,-9);ctx.lineTo(28,-11);ctx.lineTo(28,-7);ctx.closePath();}
  ctx.fill();
  if(birdKey==='flamingo'){ctx.strokeStyle=b.body;ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(6,-5);ctx.lineTo(12,-18);ctx.stroke();}
  ctx.restore();
}

// --- WORLD DRAW --------------------------------------------------------------
function drawPipes(){
  const bg=gs.level.bg;
  const col=save.settings.colorblind?'#FF8800':(bg==='space'?'#4B4BA0':bg==='night'?'#1A6A1A':'#2DA02D');
  const dark=save.settings.colorblind?'#CC5500':(bg==='space'?'#353580':bg==='night'?'#0E500E':'#1A7A1A');
  for(const p of gs.pipes){
    const savedAlpha=ctx.globalAlpha;
    if(p.ghostPipe) ctx.globalAlpha=0.35+0.65*(Math.sin(gs.frameCount*0.05+p.x*0.005)*0.5+0.5);
    const pGap=p.gap||gs.level.gap;
    const gapY=p.topH+pGap;
    ctx.fillStyle=col;ctx.fillRect(p.x,0,50,p.topH);ctx.fillRect(p.x,gapY,50,RH-gapY);
    ctx.fillStyle=dark;ctx.fillRect(p.x-4,p.topH-14,58,14);ctx.fillRect(p.x-4,gapY,58,14);
    ctx.fillStyle='rgba(255,255,255,0.12)';ctx.fillRect(p.x+6,0,8,p.topH-14);ctx.fillRect(p.x+6,gapY+14,8,RH-gapY-14);
    if(p.barrier){
      ctx.fillStyle=col;ctx.fillRect(p.x,p.barrier.y,50,p.barrier.h);
      ctx.fillStyle=dark;ctx.fillRect(p.x-4,p.barrier.y,58,4);ctx.fillRect(p.x-4,p.barrier.y+p.barrier.h-4,58,4);
    }
    ctx.globalAlpha=savedAlpha;
  }
  if(save.settings.gapPreview){
    ctx.save();ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.setLineDash([5,7]);ctx.lineWidth=1.5;
    for(const p of gs.pipes){
      if(p.x>BX){const pGap=p.gap||gs.level.gap;const mid=p.topH+pGap/2;ctx.beginPath();ctx.moveTo(p.x+2,mid);ctx.lineTo(p.x+48,mid);ctx.stroke();}
    }
    ctx.setLineDash([]);ctx.restore();
  }
}

function drawCoins(){
  for(const c of gs.coinItems){
    if(c.collected)continue;
    ctx.save();ctx.translate(c.x,c.y);
    const grd=ctx.createRadialGradient(-2,-2,1,0,0,7);
    grd.addColorStop(0,'#FFEE88');grd.addColorStop(1,'#E09000');
    ctx.fillStyle=grd;ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#B87000';ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle='#B87000';ctx.font='bold 8px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('c',0,1);
    ctx.restore();
  }
}

const PU_COLOR={heart:'#FF3355',shield:'#3388FF',magnet:'#BB44FF'};
function drawPowerups(){
  for(const p of gs.powerups){
    if(p.collected)continue;
    ctx.save();ctx.translate(p.x,p.y);
    if(save.settings.graphics!=='low'){
      const glw=ctx.createRadialGradient(0,0,4,0,0,26);
      glw.addColorStop(0,PU_COLOR[p.type]+'88');glw.addColorStop(1,'transparent');
      ctx.fillStyle=glw;ctx.beginPath();ctx.arc(0,0,26,0,Math.PI*2);ctx.fill();
    }
    roundRect(-18,-18,36,36,8,PU_COLOR[p.type],'rgba(255,255,255,0.5)');
    ctx.fillStyle='#fff';ctx.font='bold 20px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    const icons={heart:'♥',shield:'S',magnet:'M'};
    ctx.fillText(icons[p.type]||'?',0,1);
    ctx.restore();
  }
}

function drawEnemies(){
  for(const e of gs.enemies){
    if(e.dead)continue;
    ctx.save();ctx.translate(e.x,e.y);
    ctx.fillStyle='#CC1100';ctx.beginPath();ctx.arc(0,0,16,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#FF3322';ctx.beginPath();ctx.arc(-5,-6,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(5,-6,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-5,-6,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(5,-6,3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#000';ctx.beginPath();ctx.arc(-5,-6,1.5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(5,-6,1.5,0,Math.PI*2);ctx.fill();
    for(let i=0;i<e.hp;i++){ctx.fillStyle='#FF0';ctx.beginPath();ctx.arc(-4+i*8,22,3,0,Math.PI*2);ctx.fill();}
    ctx.restore();
  }
  if(gs.boss&&!gs.boss.dead) drawBoss();
}
function drawBoss(){
  const b=gs.boss;
  ctx.save();ctx.translate(b.x,b.y);
  if(save.settings.graphics!=='low'){
    const glw=ctx.createRadialGradient(0,0,10,0,0,60);
    glw.addColorStop(0,'rgba(180,0,0,0.35)');glw.addColorStop(1,'transparent');
    ctx.fillStyle=glw;ctx.beginPath();ctx.arc(0,0,60,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle='#8B0000';ctx.beginPath();ctx.arc(0,0,40,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle='#FF0000';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,40,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle='#FF6600';ctx.beginPath();ctx.arc(-14,-12,10,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(14,-12,10,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#000';ctx.beginPath();ctx.arc(-14,-12,5,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(14,-12,5,0,Math.PI*2);ctx.fill();
  // reuse same strokeStyle/lineWidth from above
  ctx.beginPath();ctx.moveTo(-22,-22);ctx.lineTo(-6,-18);ctx.stroke();
  ctx.beginPath();ctx.moveTo(22,-22);ctx.lineTo(6,-18);ctx.stroke();
  ctx.beginPath();ctx.arc(0,10,18,0.3,Math.PI-0.3);ctx.stroke();
  ctx.fillStyle='#300';ctx.fillRect(-42,50,84,12);
  ctx.fillStyle='#F00';ctx.fillRect(-42,50,84*(b.hp/b.maxHp),12);
  ctx.strokeStyle='#FF4444';ctx.lineWidth=1;ctx.strokeRect(-42,50,84,12);
  ctx.fillStyle='#fff';ctx.font='9px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('BOSS',0,56);
  ctx.restore();
}

function drawBullets(){
  for(const b of gs.bullets){
    ctx.save();ctx.translate(b.x,b.y);
    ctx.fillStyle='#FFEE00';ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(-1,-1,2,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
  for(const b of gs.enemyBullets){
    ctx.save();ctx.translate(b.x,b.y);
    ctx.fillStyle='#FF2200';ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fill();
    ctx.restore();
  }
}

function spawnParticles(x,y,color,count=8){
  if(!save.settings.particles||save.settings.graphics==='low')return;
  for(let i=0;i<count;i++){gs.particles.push({x,y,vx:(Math.random()-0.5)*5,vy:(Math.random()-0.5)*5,life:30+Math.random()*15,maxLife:45,r:2+Math.random()*3,color});}
}
function updateDrawParticles(){
  gs.particles=gs.particles.filter(p=>p.life>0);
  for(const p of gs.particles){
    p.x+=p.vx;p.y+=p.vy;p.vx*=0.95;p.vy*=0.95;p.life--;
    ctx.globalAlpha=p.life/p.maxLife;ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
  }
  ctx.globalAlpha=1;
}

// HUD: score (top-left), coins, hearts (top-right), mode badge (centre), active effect timers
function drawHUD(){
  roundRect(5,5,120,34,6,'rgba(0,0,0,0.45)');
  ctx.fillStyle='#fff';ctx.font='bold 18px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillText('Score: '+gs.score,14,22);
  roundRect(5,44,105,28,6,'rgba(0,0,0,0.45)');
  ctx.fillStyle='#FFD700';ctx.font='bold 15px Arial';ctx.fillText('\u00a2 '+gs.sessionCoins,14,58);
  for(let i=0;i<gs.maxHp;i++){ctx.fillStyle=i<gs.hp?'#FF2244':'rgba(255,255,255,0.25)';ctx.font='22px Arial';ctx.textAlign='right';ctx.fillText('♥',RW-8-i*26,26);}
  if(gs.mode==='adventure'){
    roundRect(RW/2-42,5,84,24,5,'rgba(0,0,0,0.45)');
    ctx.fillStyle='#FFD700';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Level '+gs.levelId,RW/2,17);
    // pipe progress bar on the left edge
    const prog=Math.min(1,gs.score/gs.level.targetScore);
    const bh=Math.round(RH*0.35),by=RH/2-bh/2;
    roundRect(4,by,12,bh,4,'rgba(0,0,0,0.5)');
    ctx.fillStyle='#27AE60';ctx.fillRect(5,by+bh*(1-prog),10,bh*prog);
    ctx.fillStyle='#FFD700';ctx.font='bold 10px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(gs.score+'/'+gs.level.targetScore,10,by+bh+10);
  }else if(gs.mode==='time_trial'){
    const secs=Math.ceil(gs.timeLeft/60);
    roundRect(RW/2-42,5,84,24,5,'rgba(100,40,0,0.7)');
    ctx.fillStyle=secs<=10?'#FF5555':'#FFB300';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('\u23F1 '+secs+'s',RW/2,17);
  }else if(gs.mode==='survival'){
    roundRect(RW/2-44,5,88,24,5,'rgba(80,0,0,0.7)');
    ctx.fillStyle='#FF8888';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('SURVIVAL',RW/2,17);
  }else if(gs.mode==='gauntlet'){
    roundRect(RW/2-44,5,88,24,5,'rgba(0,40,80,0.8)');
    ctx.fillStyle='#00BFFF';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('GAUNTLET '+gs.score+'/30',RW/2,17);
  }else{
    roundRect(RW/2-44,5,88,24,5,'rgba(80,0,120,0.6)');
    ctx.fillStyle='#DA70D6';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('UNLIMITED',RW/2,17);
  }
  if(gs.canShoot){ctx.fillStyle='rgba(255,60,60,0.9)';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('TAP = FLAP + SHOOT',RW/2,RH-30);}
  if(gs.comboStreak>=3&&save.settings.comboMultOn){
    const cmult=gs.comboStreak>=10?3:gs.comboStreak>=5?2:1;
    roundRect(5,76,74,22,4,'rgba(0,0,0,0.55)');
    ctx.fillStyle='#FF9900';ctx.font='bold 11px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText('x'+cmult+' COMBO',10,87);
  }
  if(save.settings.showFPS){
    ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='10px Arial';ctx.textAlign='right';ctx.textBaseline='top';
    ctx.fillText('FPS:'+fps,RW-5,36);
  }
  let effY=100;
  if(gs.shieldTimer>0){ctx.fillStyle='rgba(68,136,255,0.8)';ctx.font='12px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('Shield '+Math.ceil(gs.shieldTimer/60)+'s',8,effY);effY+=18;}
  if(gs.magnetTimer>0){ctx.fillStyle='rgba(187,68,255,0.8)';ctx.font='12px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('Magnet '+Math.ceil(gs.magnetTimer/60)+'s',8,effY);}
}

// --- GAME LOGIC --------------------------------------------------------------
// Spawns a pipe pair at a random gap position, plus coins and optionally a power-up
function spawnPipe(){
  const margin=60;
  // Gauntlet: use pre-seeded gap positions instead of random
  if(gs.mode==='gauntlet'&&gs.gauntletGaps){
    if(gs.gauntletPipe>=gs.gauntletGaps.length)return; // all 30 spawned
    const topH=gs.gauntletGaps[gs.gauntletPipe++];
    gs.pipes.push({x:RW,topH,gap:gs.level.gap,scored:false});
    const gapMid=topH+gs.level.gap/2;
    const n=save.selectedBird==='sparrow'?6:3;
    for(let i=0;i<n;i++) gs.coinItems.push({x:RW+12+i*16,y:gapMid+(Math.random()-0.5)*(gs.level.gap*0.5),collected:false});
    return;
  }
  const pGap=activeMods.has('coin_frenzy')?Math.floor(gs.level.gap*0.85):gs.level.gap;
  const topH=margin+Math.random()*(RH-pGap-margin*2);
  const p={x:RW,topH,gap:pGap,scored:false};
  if(activeMods.has('moving_pipes')){p.baseTopH=topH;p.sinPhase=Math.random()*Math.PI*2;}
  if(activeMods.has('double_gap')){p.barrier={y:topH+Math.floor(pGap*0.42),h:20};}
  if(activeMods.has('ghost_pipes')) p.ghostPipe=true;
  gs.pipes.push(p);
  const gapMid=topH+pGap/2;
  const coinMult=activeMods.has('coin_frenzy')?3:1;
  const n=(save.selectedBird==='sparrow'?6:3)*coinMult; // sparrow skill: double coins
  for(let i=0;i<n;i++){gs.coinItems.push({x:RW+12+i*16,y:gapMid+(Math.random()-0.5)*(pGap*0.5),collected:false});}
  if(gs.mode==='survival')return; // no powerups in survival
  gs.puCountdown--;
  if(gs.puCountdown<=0){
    if(gs.puQueue.length===0) gs.puQueue=makePuQueue(gs.lastPuType);
    const puType=gs.puQueue.shift(); gs.lastPuType=puType;
    const puY=gapMid+(Math.random()-0.5)*pGap*0.4;
    gs.powerups.push({x:RW+38,y:puY,vy:0,type:puType,collected:false});
    gs.puCountdown=gs.mode==='unlimited'?10+Math.floor(Math.random()*3):5;
  }
}
// 35% chance shooter (fires aimed projectiles), 65% basic contact-damage enemy
function spawnEnemy(){
  const shooter=Math.random()<0.35;
  gs.enemies.push({x:RW+20,y:80+Math.random()*(RH-160),vx:-(gs.pipeSpeed+1.2),type:shooter?'shooter':'basic',hp:shooter?2:1,shootTimer:70+Math.random()*50,dead:false});
}
// Spawns the level-10 boss and enables player shooting ability
function spawnBoss(){
  gs.boss={x:RW+60,y:RH/2,vx:-2,vy:1.2,hp:30,maxHp:30,shootTimer:80,dead:false};
  gs.canShoot=true;
}
// Applies a collected power-up: SFX + particles + stat change
function applyPowerup(type){
  (SFX[type]||SFX.heart)();spawnParticles(BX,gs.birdY,PU_COLOR[type],12);
  if(type==='heart'){gs.hp=Math.min(gs.hp+1,3);gs.maxHp=Math.max(gs.maxHp,gs.hp);}
  if(type==='shield') gs.shieldTimer=200;
  if(type==='magnet') gs.magnetTimer=200;
}
// Handles incoming damage. Order: invincibility check ? shield absorb ? HP loss ? death.
function takeDamage(){
  if(gs.invincible>0)return;
  if(activeMods.has('zen'))return; // zen mode: no damage
  // time trial: no death, subtract 3 seconds instead
  if(gs.mode==='time_trial'){
    gs.timeLeft=Math.max(0,gs.timeLeft-180);
    gs.invincible=60;triggerShake(9,14);vibrate(80);SFX.hit();
    spawnParticles(BX,gs.birdY,'#FF2244',8);return;
  }
  if(gs.shieldTimer>0){gs.shieldTimer=0;gs.invincible=60;SFX.hit();spawnParticles(BX,gs.birdY,'#3388FF',10);triggerShake(5,8);vibrate(30);return;}
  gs.hp--;gs.invincible=100;
  gs.comboStreak=0;
  triggerShake(9,14);
  try{save.settings.vibrate&&navigator.vibrate&&navigator.vibrate(80);}catch(_){} // always medium on hit
  if(gs.hp===1) SFX.lowHealth();
  else SFX.hit();
  spawnParticles(BX,gs.birdY,'#FF2244',8);
  if(gs.hp<=0){
    if(gs.practice){ gs.hp=gs.maxHp; gs.invincible=90; showPopup('Respawned! (Practice)'); SFX.hit(); return; }
    SFX.die();
    try{save.settings.vibrate&&navigator.vibrate&&navigator.vibrate([80,30,80,30,160]);}catch(_){} // fixed strong pattern; only Off toggle can suppress
    // death animation: give bird a tumble velocity
    gs.deathAngle=0; gs.deathVX=2; gs.deathVY=-3;
    gs.over=true;stopMusic();save.coins+=gs.sessionCoins;
    if(gs.mode==='unlimited') saveGhostIfBest();
    if(!save.runHistory)save.runHistory=[];
    save.runHistory.unshift({mode:gs.mode,score:gs.score,bird:gs.bird,mods:[...activeMods].join(','),date:new Date().toLocaleDateString()});
    save.runHistory=save.runHistory.slice(0,10);
    checkAchievements(); checkDailyChallenges(); writeSave();
    if(!gs.nameEntered){
      gs.nameEntered=true;
      if(isTopScore(gs.score)){
        SFX.highScore();
        if(gs.mode==='adventure'){
          addHighScore('ADVENTURE',gs.score);
        }else{
          askPlayerName(name=>addHighScore(name,gs.score));
        }
      }
    }
  }
}
// Tap/spacebar handler: starts game on first input, applies flap impulse, fires if shooting active
function playerFlap(){
  if(gs.over||gs.won)return;
  if(!gs.started){gs.started=true;startMusic();requestWakeLock();}
  // Owl active: freeze pipes for 2s once per game
  if(save.selectedBird==='owl'&&owlFreezeLeft>0&&gs.started){
    owlFreezeLeft=0; owlFreezeTimer=120;
    achvStats.owlFreezeCount++; SFX.shield();
    spawnParticles(BX,gs.birdY,'#88DDFF',14);
    return; // freeze uses the tap, no flap
  }
  // Flamingo: begin tracking hold for glide
  if(save.selectedBird==='flamingo'){ isHolding=true; holdStartTime=gs.frameCount; }
  // Eagle: begin tracking hold for charge
  if(save.selectedBird==='eagle'){ isHolding=true; holdStartTime=gs.frameCount; }
  const impulse=(save.selectedBird==='eagle'&&gs.velocity>3)?-5.2:-4.3;
  gs.velocity=impulse;SFX.flap();
  if(gs.canShoot&&gs.shootCooldown<=0){gs.bullets.push({x:BX+22,y:gs.birdY});gs.shootCooldown=18;SFX.shoot();}
}
function playerRelease(){
  if(!gs.started||gs.over||gs.won){isHolding=false;return;}
  if(save.selectedBird==='eagle'&&isHolding){
    const held=(gs.frameCount-holdStartTime)/60; // seconds held
    if(held>=0.4){ gs.velocity=-7.5; SFX.flap(); achvStats.eagleChargeCount++; spawnParticles(BX,gs.birdY,'#FFD700',10); }
  }
  isHolding=false;
}

// --- UPDATE LOOP --------------------------------------------------------------
// Order: timers ? spawning ? physics ? coins ? power-ups ? enemies ? bullets ? collision
function updateGame(){
  if(!gs.started||gs.over||gs.won)return;
  gs.frameCount++;
  // tick all per-frame countdown timers
  if(gs.invincible>0)gs.invincible--;if(gs.shieldTimer>0)gs.shieldTimer--;if(gs.magnetTimer>0)gs.magnetTimer--;if(gs.shootCooldown>0)gs.shootCooldown--;
  if(gs.mode==='time_trial'){gs.timeLeft--;if(gs.timeLeft<=0){gs.over=true;stopMusic();save.coins+=gs.sessionCoins;if(!save.runHistory)save.runHistory=[];save.runHistory.unshift({mode:'time_trial',score:gs.score,bird:gs.bird,mods:[...activeMods].join(','),date:new Date().toLocaleDateString()});save.runHistory=save.runHistory.slice(0,10);writeSave();return;}}
  if(gs.mode==='unlimited') gs.speedMult=1+gs.frameCount/3600; // speed ramps gradually
  gs.pipeSpeed=gs.level.pipeSpeed*gs.speedMult*(activeMods.has('pipe_rush')?gs.pipeRushMult:1);
  // spawn when last pipe has scrolled exactly spawnDist pixels � guarantees equal visual spacing
  const spawnDist=gs.level.interval*gs.level.pipeSpeed;
  const lastPipe=gs.pipes.length>0?gs.pipes[gs.pipes.length-1]:null;
  if(!lastPipe||lastPipe.x<=RW-spawnDist) spawnPipe();
  if(gs.level.hasEnemies&&!gs.boss&&gs.frameCount%220===0) spawnEnemy(); // ~3.5 s intervals
  if(gs.level.hasBoss&&!gs.bossSpawned&&gs.score>=20){gs.bossSpawned=true;spawnBoss();}
  if(gs.level.bg==='day'||gs.level.bg==='sunset') moveClouds();
  const grav=activeMods.has('low_grav')?0.12:(save.selectedBird==='flamingo'?0.22:0.35); // low_grav / flamingo reduce gravity
  gs.velocity+=grav;gs.birdY+=gs.velocity;
  for(const p of gs.pipes){
    if(p.sinPhase!==undefined) p.topH=p.baseTopH+Math.sin(gs.frameCount*0.04+p.sinPhase)*28; // moving pipes oscillate
    if(owlFreezeTimer<=0) p.x-=gs.pipeSpeed;
    if(!p.scored&&p.x+50<BX){
      p.scored=true;gs.score++;SFX.score();
      gs.comboStreak++;
      if(activeMods.has('pipe_rush')&&gs.score%5===0) gs.pipeRushMult=Math.min(gs.pipeRushMult*1.1,3);
      if(!gs.pbToastShown&&gs.score>(save.highScores[0]?.score||0)){gs.pbToastShown=true;showPopup('\uD83D\uDD25 New Personal Best!');if(gs.mode!=='adventure')spawnConfetti();}
      // Gauntlet: win when all 30 pipes are scored
      if(gs.mode==='gauntlet'&&gs.score>=30){
        gs.won=true;SFX.levelup();save.coins+=gs.sessionCoins;writeSave();return;
      }
      // parrot auto-shield counter
      if(save.selectedBird==='parrot') parrotShieldPipes++;
      // milestone flash
      if(activeMods.has('milestone')&&gs.score%10===0) triggerShake(4,6);
      checkAchievements(); checkDailyChallenges();
      if(gs.mode==='adventure'&&gs.score>=gs.level.targetScore){
        gs.won=true;SFX.levelup();
        if(gs.levelId<10&&gs.levelId>=save.unlockedLevels) save.unlockedLevels=gs.levelId+1;
        save.coins+=gs.sessionCoins;writeSave();return;
      }
    }
  }
  gs.pipes=gs.pipes.filter(p=>p.x+50>0);
  // coins: magnetic pull (90px) or direct touch collection
  for(const c of gs.coinItems){
    c.x-=gs.pipeSpeed;if(c.collected)continue;
    const dx=c.x-BX,dy=c.y-gs.birdY,dist=Math.sqrt(dx*dx+dy*dy);
    const collect=(gs.magnetTimer>0&&dist<90)||dist<BR+9;
    if(collect){c.collected=true;gs.sessionCoins++;spawnParticles(c.x,c.y,'#FFD700',5);SFX.coin();}
  }
  gs.coinItems=gs.coinItems.filter(c=>!c.collected&&c.x>-20);
  // power-ups: scroll left, bounce off top/bottom edges, collect on proximity
  for(const p of gs.powerups){
    p.x-=gs.pipeSpeed;p.y+=p.vy;if(p.collected)continue;
    if(p.y<=20){p.y=20;p.vy=Math.abs(p.vy);}
    if(p.y>=RH-20){p.y=RH-20;p.vy=-Math.abs(p.vy);}
    const dx=p.x-BX,dy=p.y-gs.birdY;
    if(Math.sqrt(dx*dx+dy*dy)<BR+20){p.collected=true;applyPowerup(p.type);}
  }
  gs.powerups=gs.powerups.filter(p=>!p.collected&&p.x>-30);
  // enemies: scroll left and fire aimed shots toward the bird
  for(const e of gs.enemies){
    if(e.dead)continue;e.x+=e.vx;
    if(e.type==='shooter'){
      e.shootTimer--;
      if(e.shootTimer<=0){
        const dx=BX-e.x,dy=gs.birdY-e.y,len=Math.sqrt(dx*dx+dy*dy);
        gs.enemyBullets.push({x:e.x,y:e.y,vx:dx/len*4,vy:dy/len*4});
        e.shootTimer=80+Math.random()*60;
      }
    }
  }
  gs.enemies=gs.enemies.filter(e=>!e.dead&&e.x>-50);
  // boss: patrol horizontally, fires spread + aimed shots when HP < 50%
  if(gs.boss&&!gs.boss.dead){
    const b=gs.boss;
    b.x+=b.vx;if(b.x<RW*0.55){b.x=RW*0.55;b.vx= Math.abs(b.vx)||2;}if(b.x>RW*0.82){b.x=RW*0.82;b.vx=-Math.abs(b.vx)||2;}
    b.y+=b.vy;if(b.y<RH*0.15){b.y=RH*0.15;b.vy= Math.abs(b.vy)||1.2;}if(b.y>RH*0.82){b.y=RH*0.82;b.vy=-Math.abs(b.vy)||1.2;}
    b.shootTimer--;
    if(b.shootTimer<=0){
      if(b.hp<b.maxHp/2){for(let a=0;a<Math.PI*2;a+=Math.PI/4){gs.enemyBullets.push({x:b.x,y:b.y,vx:Math.cos(a)*3,vy:Math.sin(a)*3});}}
      const ddx=BX-b.x,ddy=gs.birdY-b.y,len=Math.sqrt(ddx*ddx+ddy*ddy);
      gs.enemyBullets.push({x:b.x,y:b.y,vx:ddx/len*5,vy:ddy/len*5});
      b.shootTimer=b.hp<b.maxHp/2?35:55;
    }
  }
  // player bullets vs enemies and boss
  for(const b of gs.bullets){
    b.x+=9;
    for(const e of gs.enemies){if(!e.dead&&Math.abs(b.x-e.x)<18&&Math.abs(b.y-e.y)<18){e.hp--;b.hit=true;spawnParticles(e.x,e.y,'#FF6600',6);SFX.hit();if(e.hp<=0){e.dead=true;spawnParticles(e.x,e.y,'#FF4400',12);}}}
    if(gs.boss&&!gs.boss.dead&&Math.abs(b.x-gs.boss.x)<46&&Math.abs(b.y-gs.boss.y)<46){gs.boss.hp--;b.hit=true;spawnParticles(gs.boss.x,gs.boss.y,'#FF6600',5);SFX.hit();if(gs.boss.hp<=0){gs.boss.dead=true;gs.canShoot=false;spawnParticles(gs.boss.x,gs.boss.y,'#FF4400',25);gs.score+=10;}}
  }
  gs.bullets=gs.bullets.filter(b=>!b.hit&&b.x<RW+20);
  // enemy bullets: let takeDamage() handle shield/invincibility so shield is consumed correctly
  for(const b of gs.enemyBullets){
    b.x+=b.vx;b.y+=b.vy;
    if(Math.sqrt((BX-b.x)**2+(gs.birdY-b.y)**2)<BR+5){b.hit=true;takeDamage();}
  }
  gs.enemyBullets=gs.enemyBullets.filter(b=>!b.hit&&b.x>-20&&b.x<RW+20&&b.y>-20&&b.y<RH+20);
  // pipe AABB collision — uses per-pipe gap; also checks double_gap barrier
  for(const p of gs.pipes){const bL=BX-BR,bR2=BX+BR,bT=gs.birdY-BR,bBot=gs.birdY+BR,pGap=p.gap||gs.level.gap,gapY=p.topH+pGap;if(bR2>p.x&&bL<p.x+50&&(bT<p.topH||bBot>gapY)){takeDamage();break;}if(p.barrier){const bY=p.barrier.y,bH=p.barrier.h;if(bR2>p.x&&bL<p.x+50&&bT<bY+bH&&bBot>bY){takeDamage();break;}}}
  for(const e of gs.enemies){if(!e.dead&&Math.sqrt((BX-e.x)**2+(gs.birdY-e.y)**2)<BR+16) takeDamage();}
  if(gs.boss&&!gs.boss.dead&&Math.sqrt((BX-gs.boss.x)**2+(gs.birdY-gs.boss.y)**2)<BR+42) takeDamage();
  // floor/ceiling – reverse gravity flips which kills you
  if(!activeMods.has('reverse')){
    if(gs.birdY+BR>RH){gs.birdY=RH-BR;gs.velocity=0;takeDamage();}
    if(gs.birdY-BR<0){gs.birdY=BR;gs.velocity=0;}
  }else{
    if(gs.birdY-BR<0){gs.birdY=BR;gs.velocity=0;takeDamage();}
    if(gs.birdY+BR>RH){gs.birdY=RH-BR;gs.velocity=0;}
  }
  // ghost: check if player is ahead of ghost for achievement
  if(save.settings.ghost&&ghostPlayback.length>0&&ghostFrame<ghostPlayback.length){
    if(gs.score>0&&ghostFrame>ghostPlayback.length){ achvStats.ghostBeaten=true; }
  }
}

// --- WEATHER OVERLAY ---------------------------------------------------------
function drawWeather(){
  if(!activeMods.has('weather'))return;
  const bg=gs.level?gs.level.bg:'day';
  if(bg==='night'||bg==='space'){
    // snow
    ctx.fillStyle='rgba(220,240,255,0.7)';
    for(const s of gs.snowFlakes){
      s.y+=s.spd; s.x+=Math.sin(gs.frameCount*0.02+s.r)*0.4;
      if(s.y>RH){s.y=0;s.x=Math.random()*RW;}
      ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();
    }
  }else{
    // rain + lightning
    ctx.strokeStyle='rgba(150,180,255,0.55)';ctx.lineWidth=1;
    for(const d of gs.rainDrops){
      d.y+=d.spd; d.x-=1;
      if(d.y>RH){d.y=0;d.x=Math.random()*RW;}
      ctx.beginPath();ctx.moveTo(d.x,d.y);ctx.lineTo(d.x-2,d.y+10);ctx.stroke();
    }
    // random lightning flash
    if(Math.random()<0.004){
      ctx.fillStyle='rgba(200,220,255,0.18)';ctx.fillRect(0,0,RW,RH);
      triggerShake(3,4);
    }
  }
}

// --- BIRD DEATH ANIMATION ----------------------------------------------------
function updateDrawDeathAnim(){
  // Only runs after game over, before full overlay covers the screen
  if(!gs.over)return;
  gs.deathAngle+=0.18;
  gs.deathVY+=0.35;
  gs.birdY+=gs.deathVY;
  gs.birdX=(gs.birdX||BX)+gs.deathVX;
  ctx.save();
  ctx.translate(gs.birdX||BX,gs.birdY);
  ctx.rotate(gs.deathAngle);
  ctx.translate(-(gs.birdX||BX),-gs.birdY);
  drawBirdAt(gs.birdX||BX,gs.birdY,gs.bird);
  ctx.restore();
}

// --- LOADING SCREEN -------------------------------------------------------------
// Two-phase crossfade: studio name (phase 0) ? game title (phase 1), then loadSave() + WELCOME
let loadTimer=0,loadPhase=0;
const LOAD_DUR=[140,90]; // frame duration per phase
function drawLoading(){
  ctx.fillStyle='#000';ctx.fillRect(0,0,W,H);
  loadTimer++;const dur=LOAD_DUR[loadPhase];
  let alpha=1;
  if(loadTimer<30) alpha=loadTimer/30;
  else if(loadTimer>dur-28) alpha=(dur-loadTimer)/28;
  ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
  ctx.textAlign='center';ctx.textBaseline='middle';
  if(loadPhase===0){
    ctx.fillStyle='#FFD700';ctx.font='bold 34px Arial';ctx.fillText('SAINTSWAR',W/2,H/2-22);
    ctx.fillStyle='#aaa';ctx.font='20px Arial';ctx.fillText('presents',W/2,H/2+22);
  }else{
    ctx.fillStyle='#FFD700';ctx.font='bold 54px Arial';ctx.fillText('FLY BIRDY',W/2,H/2-30);
    ctx.fillStyle='#ddd';ctx.font='20px Arial';ctx.fillText('Loading...',W/2,H/2+40);
    // loading bar
    const prog=Math.min(1,loadTimer/dur);
    roundRect(W/2-100,H/2+70,200,12,6,'rgba(255,255,255,0.12)');
    ctx.fillStyle='#FFD700';ctx.beginPath();ctx.roundRect(W/2-100,H/2+70,Math.round(200*prog),12,6);ctx.fill();
  }
  ctx.globalAlpha=1;
  if(loadTimer>=dur){loadTimer=0;loadPhase++;if(loadPhase>=2){loadSave();loadCustomAudio();refreshDailyChallenges();applyVolume();screen=S.WELCOME;}}
}

// --- SCREEN: WELCOME ------------------------------------------------------------
function drawWelcome(){
  const hour=new Date().getHours();
  const welcomeBg=(hour>=20||hour<6)?'night':'day';
  drawBg(welcomeBg);
  roundRect(30,85,340,135,18,'rgba(0,20,60,0.78)','rgba(255,215,0,0.45)');
  ctx.fillStyle='rgba(255,215,0,0.75)';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Welcome to',W/2,122);
  ctx.fillStyle='#FFD700';ctx.font="bold 48px Arial";ctx.fillText("'Fly Birdy'",W/2,174);
  drawBirdAt(W/2,265,save.selectedBird,true);
  btn(60,295,280,50,'PLAY','#2ECC71',()=>{screen=S.MODE_SELECT;},20);
  btn(50,358,135,42,'Scores','#E67E22',()=>{screen=S.HIGH_SCORES;},13);
  btn(215,358,135,42,'Settings','#3498DB',()=>{screen=S.SETTINGS;},13);
  btn(50,412,135,42,'Birds','#9B59B6',()=>{screen=S.BIRD_SELECT;},13);
  btn(215,412,135,42,'Achieve','#1A6A6A',()=>{screen=S.ACHIEVEMENTS;},13);
  btn(50,466,135,42,'Challenge','#8B2500',()=>{screen=S.CHALLENGE;},13);
  roundRect(215,466,135,42,8,'#B06000','#F39C12');
  ctx.fillStyle='#FFD700';ctx.font='bold 15px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Coins: '+save.coins,215+135/2,466+21);
}

// --- SCREEN: MODE SELECT -------------------------------------------------------
function drawModeSelect(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 28px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Select Mode',W/2,40);

  // Adventure
  roundRect(16,56,368,90,12,'rgba(0,60,20,0.85)','rgba(50,200,100,0.4)');
  ctx.fillStyle='#7CFC00';ctx.font='bold 20px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Adventure',W/2,83);
  ctx.fillStyle='#c8ffc8';ctx.font='12px Arial';ctx.fillText('10 levels  \u2022  enemies  \u2022  boss fights',W/2,101);
  btn(220,118,150,22,'PLAY \u25ba','#27AE60',()=>{screen=S.LEVEL_SELECT;},12);

  // Unlimited
  roundRect(16,154,368,90,12,'rgba(60,0,90,0.85)','rgba(180,80,255,0.35)');
  ctx.fillStyle='#DA70D6';ctx.font='bold 20px Arial';ctx.fillText('Unlimited',W/2,181);
  ctx.fillStyle='#e8c0ff';ctx.font='12px Arial';ctx.fillText('Endless  \u2022  modifiers  \u2022  high score',W/2,199);
  btn(220,216,150,22,'PLAY \u25ba','#8E44AD',()=>{screen=S.UNLIMITED_OPTS;},12);

  // Time Trial
  roundRect(16,252,368,90,12,'rgba(80,40,0,0.85)','rgba(255,160,0,0.4)');
  ctx.fillStyle='#FFB300';ctx.font='bold 20px Arial';ctx.fillText('Time Trial',W/2,279);
  ctx.fillStyle='#ffe4b0';ctx.font='12px Arial';ctx.fillText('60 seconds  \u2022  hits cost 3s  \u2022  no death',W/2,297);
  btn(220,314,150,22,'PLAY \u25ba','#B06000',()=>{initGameState(1,'time_trial');screen=S.GAME;startMusic();},12);

  // Survival
  roundRect(16,350,368,90,12,'rgba(80,0,0,0.85)','rgba(255,60,60,0.35)');
  ctx.fillStyle='#FF6666';ctx.font='bold 20px Arial';ctx.fillText('Survival',W/2,377);
  ctx.fillStyle='#ffc0c0';ctx.font='12px Arial';ctx.fillText('5 lives  \u2022  no powerups  \u2022  endless pipes',W/2,395);
  btn(220,412,150,22,'PLAY \u25ba','#8B0000',()=>{initGameState(1,'survival');screen=S.GAME;startMusic();},12);

  // Gauntlet
  roundRect(16,448,368,90,12,'rgba(0,40,80,0.85)','rgba(0,180,255,0.35)');
  ctx.fillStyle='#00BFFF';ctx.font='bold 20px Arial';ctx.fillText('Gauntlet',W/2,475);
  ctx.fillStyle='#b0e8ff';ctx.font='12px Arial';ctx.fillText('30 fixed pipes  \u2022  same seed daily  \u2022  beat them all',W/2,493);
  btn(220,510,150,22,'PLAY \u25ba','#005A9E',()=>{initGameState(1,'gauntlet');screen=S.GAME;startMusic();},12);
}

// --- SCREEN: LEVEL SELECT -------------------------------------------------------
// LVL_CLRS and LVL_ICONS are parallel arrays indexed 0-9, matching LEVELS[]
const LVL_CLRS=['#27AE60','#27AE60','#27AE60','#D4821C','#D4821C','#D4821C','#7D3C98','#7D3C98','#7D3C98','#C0392B'];
const LVL_ICONS=['s','s','s','n','n','n','m','m','m','S'];
function drawLevelSelect(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.MODE_SELECT;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 28px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Select Level',W/2,42);
  const cols=5,bw=62,bh=62,gx=10,gy=16,startX=(W-cols*bw-(cols-1)*gx)/2;
  for(let i=0;i<10;i++){
    const col=i%cols,row=Math.floor(i/cols),x=startX+col*(bw+gx),y=80+row*(bh+gy),lvl=i+1;
    const unlocked=lvl<=save.unlockedLevels;
    pushBtn(x,y,bw,bh,unlocked?(()=>{initGameState(lvl,'adventure');screen=S.GAME;startMusic();}):null);
    roundRect(x,y,bw,bh,10,unlocked?LVL_CLRS[i]:'#3A3A3A',unlocked?'rgba(255,255,255,0.25)':'#555');
    ctx.fillStyle=unlocked?'#fff':'#666';ctx.font='bold 20px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(unlocked?String(lvl):'?',x+bw/2,y+bh/2-5);
    ctx.font='11px Arial';ctx.fillStyle=unlocked?'rgba(255,255,255,0.75)':'#555';
    ctx.fillText(unlocked?LVL_ICONS[i]:'',x+bw/2,y+bh/2+13);
  }
  ctx.fillStyle='#ddd';ctx.font='12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Green=Easy  Orange=Med  Purple=Hard  Red=BOSS',W/2,243);
  roundRect(22,260,356,46,10,'#5A0090','#9B59B6');
  ctx.fillStyle='#fff';ctx.font='13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Bird: '+BIRDS[save.selectedBird].name+' - '+BIRDS[save.selectedBird].skillDesc,W/2,283);
  pushBtn(22,260,356,46,()=>{screen=S.BIRD_SELECT;});
}

// --- SCREEN: BIRD SELECT / SHOP ------------------------------------------------
function drawBirdSelect(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.WELCOME;},12);
  // Header
  ctx.fillStyle='#FFD700';ctx.font='bold 22px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('Shop',W/2,24);
  ctx.fillStyle='#FFD700';ctx.font='bold 14px Arial';
  ctx.fillText('Coins: '+save.coins,W/2,46);
  // Tabs
  btn(20,55,175,40,shopTab==='birds'?'Birds (active)':'Birds',shopTab==='birds'?'#27AE60':'#555',()=>{shopTab='birds';},14);
  btn(205,55,175,40,shopTab==='skins'?'Skins (active)':'Skins',shopTab==='skins'?'#9B59B6':'#555',()=>{shopTab='skins';},14);

  if(shopTab==='birds'){
    BIRD_KEYS.forEach((key,i)=>{
      const bird=BIRDS[key],unlocked=save.unlockedBirds.includes(key),selected=save.selectedBird===key;
      const y=108+i*82;
      roundRect(14,y,372,74,12,
        selected?'rgba(0,180,90,0.3)':(unlocked?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.35)'),
        selected?'#00FF88':(unlocked?'#666':'#444'));
      drawBirdAt(58,y+38,key);
      ctx.fillStyle=unlocked?'#fff':'#777';ctx.font='bold 15px Arial';ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText(bird.name+(selected?' \u2714':''),98,y+7);
      ctx.fillStyle='#aaa';ctx.font='11px Arial';
      ctx.fillText((bird.skillType==='active'?'Active':'Passive')+': '+bird.skillDesc,98,y+27);
      if(!unlocked){
        ctx.fillStyle='#FFD700';ctx.font='12px Arial';ctx.fillText(bird.cost+' coins',98,y+48);
        btn(256,y+16,110,38,'Unlock','#E67E22',()=>{
          if(save.coins>=bird.cost){save.coins-=bird.cost;save.unlockedBirds.push(key);save.selectedBird=key;writeSave();SFX.levelup();}
          else showPopup('Not enough coins!');
        },13);
      }else if(!selected){
        btn(256,y+16,110,38,'Equip','#27AE60',()=>{save.selectedBird=key;writeSave();},13);
      }
    });

  }else{
    // Skins tab � show skins for the currently selected bird
    const birdKey=save.selectedBird;
    const skins=SKINS[birdKey]||[];
    ctx.fillStyle='#fff';ctx.font='bold 14px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('Skins for '+BIRDS[birdKey].name,W/2,108);
    // 2-column grid
    skins.forEach((skin,i)=>{
      const col=i%2, row=Math.floor(i/2);
      const x=14+col*193, y=124+row*108;
      const owned=save.purchasedSkins.includes(skin.id);
      const active=save.selectedSkins[birdKey]===skin.id;
      roundRect(x,y,183,96,12,
        active?'rgba(0,200,100,0.25)':(owned?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.35)'),
        active?'#00FF88':(owned?'#666':'#444'));
      // Preview bird with this skin
      drawBirdAt(x+40,y+42,birdKey,true,skin);
      ctx.fillStyle=active?'#00FF88':(owned?'#fff':'#aaa');
      ctx.font='bold 13px Arial';ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText(skin.name+(active?' \u2714':''),x+72,y+10);
      if(skin.cost===0){
        ctx.fillStyle='#aaa';ctx.font='11px Arial';ctx.fillText('Default',x+72,y+30);
      }else if(!owned){
        ctx.fillStyle='#FFD700';ctx.font='12px Arial';ctx.fillText(skin.cost+' coins',x+72,y+30);
        btn(x+68,y+52,106,34,'Buy','#E67E22',()=>{
          if(save.coins>=skin.cost){
            save.coins-=skin.cost;
            save.purchasedSkins.push(skin.id);
            save.selectedSkins[birdKey]=skin.id;
            writeSave();SFX.levelup();
          }else showPopup('Not enough coins!');
        },13);
      }else if(!active){
        btn(x+68,y+52,106,34,'Equip','#27AE60',()=>{
          save.selectedSkins[birdKey]=skin.id;writeSave();
        },13);
      }
    });
  }
}

// --- SCREEN: UNLIMITED OPTIONS -----------------------------------------------
function drawUnlimitedOpts(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.MODE_SELECT;unlimitedDropOpen=false;},12);
  ctx.fillStyle='#DA70D6';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('Unlimited Options',W/2,44);

  // dropdown header
  const ddX=30,ddY=80,ddW=W-60,ddH=48;
  const anyOn=selectedMods.size>0;
  const headerLabel=selectedMods.size===0?'Select Modes'
    :selectedMods.size<=2?[...selectedMods].map(m=>MOD_LABELS[m]||m).join(', ')
    :selectedMods.size+' mods selected';
  roundRect(ddX,ddY,ddW,ddH,10,'rgba(0,0,0,0.55)',anyOn?'#DA70D6':'#666',2);
  ctx.fillStyle=anyOn?'#fff':'#999';ctx.font='bold 15px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
  ctx.fillText(headerLabel,ddX+14,ddY+ddH/2);
  ctx.fillStyle=anyOn?'#DA70D6':'#888';ctx.font='bold 16px Arial';ctx.textAlign='right';
  ctx.fillText(unlimitedDropOpen?'\u25b2':'\u25bc',ddX+ddW-14,ddY+ddH/2);
  pushBtn(ddX,ddY,ddW,ddH,()=>{unlimitedDropOpen=!unlimitedDropOpen;SFX.click();});

  // dropdown list
  const rowH=44,listY=ddY+ddH+2;
  if(unlimitedDropOpen){
    const listH=ENDLESS_MODS.length*rowH+8;
    roundRect(ddX,listY,ddW,listH,10,'rgba(10,10,30,0.93)','#8E44AD',1.5);
    ENDLESS_MODS.forEach((mod,i)=>{
      const ry=listY+4+i*rowH;
      const on=selectedMods.has(mod);
      // a mod is blocked if any selected mod lists it as a conflict
      const blocked=!on&&[...selectedMods].some(s=>(MOD_CONFLICTS[s]||[]).includes(mod));
      if(i>0){ctx.strokeStyle='rgba(255,255,255,0.07)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(ddX+12,ry);ctx.lineTo(ddX+ddW-12,ry);ctx.stroke();}
      // checkbox
      const cbX=ddX+12,cbY=ry+(rowH-26)/2;
      const cbFill=blocked?'rgba(80,80,80,0.4)':on?'#8E44AD':'rgba(255,255,255,0.06)';
      const cbStroke=blocked?'#555':on?'#DA70D6':'#555';
      roundRect(cbX,cbY,26,26,5,cbFill,cbStroke,1.5);
      if(on){ctx.fillStyle='#fff';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('\u2714',cbX+13,cbY+13);}
      if(blocked){ctx.fillStyle='#666';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('\u2715',cbX+13,cbY+13);}
      ctx.fillStyle=blocked?'#555':on?'#fff':'#aaa';
      ctx.font=(on?'bold ':'')+'15px Arial';
      ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(MOD_LABELS[mod],cbX+36,ry+rowH/2);
      // show conflict reason in small text
      if(blocked){
        const blocker=[...selectedMods].find(s=>(MOD_CONFLICTS[s]||[]).includes(mod));
        ctx.fillStyle='#c0392b';ctx.font='10px Arial';ctx.textAlign='right';ctx.textBaseline='middle';
        ctx.fillText('conflicts with '+MOD_LABELS[blocker],ddX+ddW-12,ry+rowH/2);
      }
      if(!blocked){
        pushBtn(ddX,ry,ddW,rowH,()=>{
          if(selectedMods.has(mod)) selectedMods.delete(mod); else selectedMods.add(mod);
          SFX.click();
        });
      }
    });
  }

  // summary
  const belowList=unlimitedDropOpen?listY+ENDLESS_MODS.length*rowH+8:listY;
  const summary=selectedMods.size===0?'Random auto-rotation (no fixed mods)':[...selectedMods].map(m=>MOD_LABELS[m]||m).join(' + ');
  ctx.fillStyle='#FFD700';ctx.font='13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('Active: '+summary,W/2,belowList+20);

  const startY=Math.max(belowList+50,510);
  // practice toggle
  const practY=startY-44;
  roundRect(80,practY,240,36,10,'rgba(0,0,0,0.4)',practiceMode?'#27AE60':'#666',1.5);
  ctx.fillStyle=practiceMode?'#2ECC71':'#aaa';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText((practiceMode?'\u2714 ':'')+'Practice Mode (unlimited lives)',W/2,practY+18);
  pushBtn(80,practY,240,36,()=>{practiceMode=!practiceMode;SFX.click();});
  btn(80,startY,240,52,'START','#8E44AD',()=>{
    unlimitedDropOpen=false;
    initGameState(1,'unlimited');screen=S.GAME;startMusic();
  },18);
}

// --- SCREEN: HIGH SCORES -------------------------------------------------------
function drawHighScores(){
  drawBg('night');
  btn(6,6,70,26,'< Back','#555',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 30px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('High Scores',W/2,42);
  btn(20,56,175,32,hsTab==='top5'?'\u2605 Top 5 (active)':'\u2605 Top 5',hsTab==='top5'?'#E67E22':'#555',()=>{hsTab='top5';},12);
  btn(205,56,175,32,hsTab==='history'?'Run History (active)':'Run History',hsTab==='history'?'#3498DB':'#555',()=>{hsTab='history';},12);
  if(hsTab==='top5'){
    roundRect(26,94,348,270,14,'rgba(0,0,0,0.65)','rgba(255,215,0,0.28)');
    save.highScores.slice(0,5).forEach((hs,i)=>{
      const y=154+i*42;
      ctx.fillStyle=i<3?['#FFD700','#C8C8C8','#CD7F32'][i]:'#ccc';
      ctx.font=`bold ${i<3?17:15}px Arial`;ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText((i<3?['1st','2nd','3rd'][i]:(i+1)+'.')+' '+(hs.name||'BIRD'),50,y);
      ctx.textAlign='right';ctx.fillText(hs.score,354,y);
      if(i<save.highScores.length-1){ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+16);ctx.lineTo(360,y+16);ctx.stroke();}
    });
  }else{
    const hist=save.runHistory||[];
    if(hist.length===0){
      ctx.fillStyle='#888';ctx.font='15px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('No runs yet \u2014 play a game first!',W/2,280);
    }else{
      hist.slice(0,8).forEach((r,i)=>{
        const y=96+i*58;
        roundRect(16,y,368,52,8,'rgba(0,0,0,0.55)','#444');
        const modeCol={adventure:'#7CFC00',unlimited:'#DA70D6',time_trial:'#FFB300',survival:'#FF6666',gauntlet:'#00BFFF'}[r.mode]||'#aaa';
        ctx.fillStyle=modeCol;ctx.font='bold 13px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
        ctx.fillText((r.mode||'?').replace('_',' ').toUpperCase()+' \u2014 Score: '+r.score,30,y+16);
        ctx.fillStyle='#aaa';ctx.font='11px Arial';
        ctx.fillText((r.bird||'?')+' \u00b7 '+(r.mods||'no mods')+' \u00b7 '+r.date,30,y+36);
      });
    }
  }
}

// --- SCREEN: SETTINGS ------------------------------------------------------------
let settingsScroll=0;
function drawSettings(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.WELCOME;settingsScroll=0;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 28px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Settings',W/2,44);

  const sc=settingsScroll;
  // only draw+register rows that are within the visible band [56, 600]
  function toggleRow(label,val,y,action){
    const vy=y-sc; if(vy+46<56||vy>H)return;
    roundRect(28,vy,344,46,10,'rgba(0,0,0,0.35)','#555');
    ctx.fillStyle='#fff';ctx.font='15px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,46,vy+22);
    btn(244,vy+6,106,34,val?'ON':'OFF',val?'#27AE60':'#E74C3C',action,13);
  }
  function multiRow(label,y,items){
    const vy=y-sc; if(vy+46<56||vy>H)return;
    roundRect(28,vy,344,46,10,'rgba(0,0,0,0.35)','#555');
    ctx.fillStyle='#fff';ctx.font='15px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,46,vy+22);
    items.forEach(({label:lbl,active,action},i)=>{btn(196+i*54,vy+6,52,34,lbl,active?'#3498DB':'#555',action,11);});
  }

  toggleRow('Music',save.settings.music,62,()=>{save.settings.music=!save.settings.music;musicEnabled=save.settings.music;if(!musicEnabled)stopMusic();writeSave();});
  toggleRow('Sound',save.settings.sound,116,()=>{save.settings.sound=!save.settings.sound;soundEnabled=save.settings.sound;writeSave();});
  toggleRow('Screen Shake',save.settings.shake,170,()=>{save.settings.shake=!save.settings.shake;writeSave();});
  toggleRow('Ghost Replay',save.settings.ghost,224,()=>{save.settings.ghost=!save.settings.ghost;writeSave();});
  toggleRow('Gap Preview Line',save.settings.gapPreview,278,()=>{save.settings.gapPreview=!save.settings.gapPreview;writeSave();});
  toggleRow('Bird Trail',save.settings.birdTrail,332,()=>{save.settings.birdTrail=!save.settings.birdTrail;writeSave();});
  toggleRow('Colorblind Mode',save.settings.colorblind,386,()=>{save.settings.colorblind=!save.settings.colorblind;writeSave();});
  toggleRow('Combo Multiplier',save.settings.comboMultOn,440,()=>{save.settings.comboMultOn=!save.settings.comboMultOn;writeSave();});
  toggleRow('Particle Effects',save.settings.particles,494,()=>{save.settings.particles=!save.settings.particles;writeSave();});
  toggleRow('Show FPS',save.settings.showFPS,548,()=>{save.settings.showFPS=!save.settings.showFPS;writeSave();});
  multiRow('Haptic Strength',602,[
    {label:'Off',   active:!save.settings.vibrate,                                    action:()=>{save.settings.vibrate=false;writeSave();}},
    {label:'Light', active:save.settings.vibrate&&save.settings.hapticStrength==='light',  action:()=>{save.settings.vibrate=true;save.settings.hapticStrength='light';writeSave();}},
    {label:'Strong',active:save.settings.vibrate&&save.settings.hapticStrength==='strong', action:()=>{save.settings.vibrate=true;save.settings.hapticStrength='strong';writeSave();}},
  ]);
  multiRow('Graphics',656,[
    {label:'Low',   active:save.settings.graphics==='low',    action:()=>{save.settings.graphics='low';writeSave();}},
    {label:'Med',   active:save.settings.graphics==='medium', action:()=>{save.settings.graphics='medium';writeSave();}},
    {label:'High',  active:save.settings.graphics==='high',   action:()=>{save.settings.graphics='high';writeSave();}},
  ]);
  const caVy=710-sc;
  if(caVy>56&&caVy<H) btn(28,caVy,344,42,'Custom Audio \u25ba','#1A5276',()=>{screen=S.AUDIO;},13);
  // volume sliders (two rows)
  function volRow(label,key,y){
    const vy=y-sc; if(vy+46<56||vy>H)return;
    roundRect(28,vy,344,46,10,'rgba(0,0,0,0.35)','#555');
    ctx.fillStyle='#fff';ctx.font='14px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,46,vy+22);
    const val=save.settings[key]??0.8;
    const tx=160,tw=160,th=8,ty=vy+19;
    roundRect(tx,ty,tw,th,4,'rgba(255,255,255,0.15)');
    ctx.fillStyle='#3498DB';roundRect(tx,ty,Math.round(tw*val),th,4,'#3498DB');
    const thumbX=tx+Math.round(tw*val)-5;
    roundRect(thumbX,ty-5,10,18,5,'#fff');
    ctx.fillStyle='#FFD700';ctx.font='bold 12px Arial';ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillText(Math.round(val*100)+'%',336,vy+22);
    pushBtn(28,vy,344,46,()=>{
      const uiS=Math.min(RW/W,RH/H),uiOX=(RW-W*uiS)/2;
      const lx=(lastTapPx-uiOX)/uiS;
      const frac=Math.max(0,Math.min(1,(lx-tx)/tw));
      save.settings[key]=Math.round(frac*10)/10;applyVolume();writeSave();
    });
  }
  volRow('Music Volume','musicVol',762);
  volRow('Sound Volume','soundVol',816);
  const expVy=870-sc; if(expVy>56&&expVy<H){
    btn(28,expVy,168,36,'\uD83D\uDCE4 Export Save','#1A4276',()=>{
      try{prompt('Copy your save data:',JSON.stringify(save));}catch(_){alert(JSON.stringify(save));}
    },12);
    btn(204,expVy,168,36,'\uD83D\uDCE5 Import Save','#274A1A',()=>{
      const d=prompt('Paste save data:');
      if(!d)return;
      try{
        const p=JSON.parse(d);
        Object.assign(save,p);writeSave();applyVolume();
        musicEnabled=save.settings.music;soundEnabled=save.settings.sound;
        showPopup('Save imported!');
      }catch(_){showPopup('Invalid save data');}
    },12);
  }

  // scroll arrows (always visible, outside scroll area)
  const maxScroll=Math.max(0,912-H);
  if(sc>0) btn(W-36,58,28,26,'\u25b2','#555',()=>{settingsScroll=Math.max(0,sc-54);},14);
  if(sc<maxScroll) btn(W-36,H-32,28,26,'\u25bc','#555',()=>{settingsScroll=Math.min(maxScroll,sc+54);},14);
}

// --- SCREEN: ACHIEVEMENTS -------------------------------------------------------
function drawAchievements(){
  drawBg('night');
  btn(6,6,70,26,'< Back','#555',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  const unlocked=ACHV.filter(a=>save.achievements[a.id]).length;
  ctx.fillText('Achievements  '+unlocked+'/'+ACHV.length,W/2,42);
  const cols=2,bw=178,bh=60,gx=8,gy=8;
  ACHV.forEach((a,i)=>{
    const col=i%cols, row=Math.floor(i/cols);
    const x=10+col*(bw+gx), y=62+row*(bh+gy);
    const done=!!save.achievements[a.id];
    roundRect(x,y,bw,bh,8,done?'rgba(0,120,60,0.45)':'rgba(0,0,0,0.45)',done?'#00CC66':'#444');
    ctx.fillStyle=done?'#FFD700':'#888';ctx.font='bold 20px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText(a.icon,x+8,y+20);
    ctx.fillStyle=done?'#fff':'#666';ctx.font='bold 11px Arial';
    ctx.fillText(a.name,x+34,y+16);
    ctx.fillStyle='#aaa';ctx.font='10px Arial';
    ctx.fillText(a.desc,x+34,y+34);
    if(done){ctx.fillStyle='#00FF88';ctx.font='bold 14px Arial';ctx.textAlign='right';ctx.fillText('✔',x+bw-6,y+20);}
  });
}

// --- SCREEN: DAILY CHALLENGE ----------------------------------------------------
function drawChallenge(){
  drawBg('sunset');
  btn(6,6,70,26,'< Back','#555',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText('Daily Challenge',W/2,44);
  ctx.fillStyle='#ddd';ctx.font='13px Arial';ctx.fillText('Resets at midnight  •  '+todayStr(),W/2,64);
  refreshDailyChallenges();
  dailyChallenges.forEach((ch,i)=>{
    const y=82+i*130;
    const done=save.challengeDone[i];
    roundRect(20,y,360,118,12,done?'rgba(0,100,50,0.6)':'rgba(30,20,0,0.65)',done?'#00CC66':'rgba(255,180,0,0.4)',2);
    ctx.fillStyle=done?'#00FF88':'#FFD700';ctx.font='bold 14px Arial';ctx.textAlign='left';ctx.textBaseline='top';
    ctx.fillText((i+1)+'.  '+ch.desc,36,y+14);
    ctx.fillStyle='#FFD700';ctx.font='bold 13px Arial';
    ctx.fillText('Reward: +'+ch.reward+' coins',36,y+36);
    if(done){
      ctx.fillStyle='#00FF88';ctx.font='bold 22px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('✔ COMPLETED',W/2,y+82);
    }else{
      ctx.fillStyle='#fff';ctx.font='13px Arial';ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('Status: in progress',36,y+58);
      roundRect(36,y+80,306,28,6,'rgba(255,255,255,0.08)','#888');
      ctx.fillStyle='rgba(255,200,0,0.5)';
      const prog=Math.min(1,(save.challengeProgress[i]||0));
      if(prog>0) ctx.fillRect(36,y+80,306*prog,28);
      ctx.fillStyle='#ccc';ctx.font='11px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(done?'Done':'Play to complete',W/2,y+94);
    }
  });
}

// --- SCREEN: PAUSED --------------------------------------------------------------
// Renders a frozen snapshot of the game world behind the pause menu overlay
function drawPaused(){
  // Game world in real coordinates
  inGameDraw=true;
  drawBg(gs.level.bg);drawPipes();drawCoins();drawPowerups();drawEnemies();drawBullets();drawBirdAt(BX,gs.birdY,gs.bird);
  if(save.settings.graphics!=='low') updateDrawParticles();
  drawHUD();
  inGameDraw=false;
  // Pause overlay in virtual 400�600 space (scaled to fill screen)
  ctx.save();ctx.scale(RW/W,RH/H);
  ctx.fillStyle='rgba(0,0,0,0.58)';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#FFD700';ctx.font='bold 46px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('PAUSED',W/2,148);
  btn(100,210,200,50,musicEnabled?'Music: ON':'Music: OFF',musicEnabled?'#27AE60':'#E74C3C',()=>{save.settings.music=!save.settings.music;musicEnabled=save.settings.music;if(!musicEnabled)stopMusic();writeSave();});
  btn(100,274,200,50,soundEnabled?'Sound: ON':'Sound: OFF',soundEnabled?'#27AE60':'#E74C3C',()=>{save.settings.sound=!save.settings.sound;soundEnabled=save.settings.sound;writeSave();});
  btn(100,338,200,50,'Resume','#3498DB',()=>{screen=S.GAME;startMusic();});
  btn(100,402,200,50,'Main Menu','#E74C3C',()=>{stopMusic();screen=S.WELCOME;});
  ctx.restore();
}

// --- OVERLAYS -----------------------------------------------------------------
function drawGameOver(){
  ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#FF3344';ctx.font='bold 50px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('GAME OVER',W/2,140);
  roundRect(55,180,290,115,12,'rgba(255,255,255,0.07)','rgba(255,255,255,0.18)');
  ctx.fillStyle='#fff';ctx.font='bold 26px Arial';ctx.fillText('Score: '+gs.score,W/2,214);
  ctx.fillStyle='#FFD700';ctx.font='18px Arial';ctx.fillText('Coins: +'+gs.sessionCoins,W/2,250);
  ctx.fillStyle='#888';ctx.font='13px Arial';ctx.fillText('Total coins: '+save.coins,W/2,278);
  btn(42,318,145,54,'Retry','#27AE60',()=>{initGameState(gs.levelId,gs.mode);screen=S.GAME;startMusic();},16);
  btn(213,318,145,54,'Menu','#E74C3C',()=>{stopMusic();screen=S.WELCOME;},16);
  btn(42,384,316,44,'View High Scores','#E67E22',()=>{screen=S.HIGH_SCORES;},13);
}

// Level won overlay
function drawLevelWon(){
  ctx.fillStyle='rgba(0,0,0,0.62)';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#FFD700';ctx.font='bold 40px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('LEVEL CLEAR!',W/2,128);
  roundRect(55,160,290,120,12,'rgba(255,255,255,0.07)','rgba(255,215,0,0.28)');
  ctx.fillStyle='#fff';ctx.font='bold 22px Arial';ctx.fillText('Score: '+gs.score+' / '+gs.level.targetScore,W/2,196);
  ctx.fillStyle='#FFD700';ctx.font='18px Arial';ctx.fillText('Coins earned: +'+gs.sessionCoins,W/2,232);
  ctx.fillStyle='#aaa';ctx.font='13px Arial';ctx.fillText('Total coins: '+save.coins,W/2,268);
  if(gs.levelId<10){
    btn(55,305,290,52,'Next Level  ('+gs.levelId+' to '+(gs.levelId+1)+')','#27AE60',()=>{initGameState(gs.levelId+1,'adventure');screen=S.GAME;startMusic();},14);
  }else{
    ctx.fillStyle='#FFD700';ctx.font='bold 20px Arial';ctx.fillText('ALL LEVELS COMPLETE!',W/2,322);
  }
  btn(55,372,290,46,'Level Select','#3498DB',()=>{screen=S.LEVEL_SELECT;},14);
  btn(55,430,290,46,'Main Menu','#E74C3C',()=>{stopMusic();screen=S.WELCOME;});
}

// --- ACTIVE GAME DRAW ----------------------------------------------------------
function drawGame(){
  inGameDraw=true;
  ctx.save();
  applyShake(); // apply canvas shake offset before drawing world
  // Mirror mode: flip canvas horizontally
  if(activeMods.has('mirror')){ ctx.translate(RW,0); ctx.scale(-1,1); }
  drawBg(gs.level.bg);
  drawWeather();
  // fog mod: dark vignette reduces visibility of upcoming pipes
  if(activeMods.has('fog')){
    const fog=ctx.createRadialGradient(RW/2,RH/2,RH*0.15,RW/2,RH/2,RH*0.72);
    fog.addColorStop(0,'transparent');fog.addColorStop(1,'rgba(0,0,0,0.75)');
    ctx.fillStyle=fog;ctx.fillRect(0,0,RW,RH);
  }
  // Owl ghost pipe preview
  if(save.selectedBird==='owl'&&save.settings.graphics!=='low'){
    ctx.globalAlpha=0.16;
    for(const p of gs.pipes){if(p.x>RW/2){const gapY2=p.topH+gs.level.gap;ctx.fillStyle='#fff';ctx.fillRect(p.x-65,0,50,p.topH);ctx.fillRect(p.x-65,gapY2,50,RH-gapY2);}}
    ctx.globalAlpha=1;
  }
  // Tiny bird mode: scale down the bird's effective visual size (collision already handled via BR)
  const tinyScale=activeMods.has('tiny')?0.55:1;
  drawPipes();drawCoins();drawPowerups();drawEnemies();drawBullets();
  if(gs.shieldTimer>0){ctx.save();ctx.strokeStyle='rgba(68,136,255,0.7)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(BX,gs.birdY,BR+10,0,Math.PI*2);ctx.stroke();ctx.restore();}
  // Owl freeze tint
  if(owlFreezeTimer>0){ ctx.fillStyle='rgba(100,200,255,0.08)';ctx.fillRect(0,0,RW,RH); }
  // Ghost replay
  if(gs.mode==='unlimited') drawGhost();
  if(gs.invincible>0&&gs.invincible%10<5) ctx.globalAlpha=0.35;
  // bird trail
  if(save.settings.birdTrail&&!gs.over){
    if(!gs.trail)gs.trail=[];
    gs.trail.push({x:BX,y:gs.birdY});
    if(gs.trail.length>10)gs.trail.shift();
    gs.trail.forEach((t,i)=>{ctx.globalAlpha=(i/gs.trail.length)*0.28;ctx.fillStyle='#FFD700';ctx.beginPath();ctx.arc(t.x,t.y,BR*0.5,0,Math.PI*2);ctx.fill();});
    ctx.globalAlpha=gs.invincible>0&&gs.invincible%10<5?0.35:1;
  }
  // Death animation: spin off-screen instead of freezing in place
  if(gs.over){
    updateDrawDeathAnim();
  }else{
    ctx.save();ctx.translate(BX,gs.birdY);ctx.scale(tinyScale,tinyScale);ctx.translate(-BX,-gs.birdY);
    drawBirdAt(BX,gs.birdY,gs.bird,gs.velocity<-2);
    ctx.restore();
  }
  ctx.globalAlpha=1;
  if(save.settings.graphics!=='low') updateDrawParticles();
  // Milestone flash: gold edge glow every 10 pipes
  if(activeMods.has('milestone')&&gs.score>0&&gs.score%10===0&&gs.frameCount%60<20){
    ctx.save();ctx.strokeStyle='rgba(255,220,0,0.7)';ctx.lineWidth=14;ctx.strokeRect(7,7,RW-14,RH-14);ctx.restore();
  }
  // Active skill HUD badges
  if(save.selectedBird==='owl'){
    roundRect(RW/2-36,RH-50,72,32,6,'rgba(0,0,0,0.55)','#88DDFF');
    ctx.fillStyle=owlFreezeLeft>0?'#88DDFF':'#555';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(owlFreezeLeft>0?'❄ Freeze':'Freeze used',RW/2,RH-34);
  }
  ctx.restore(); // pop shake/mirror transform
  // screen edge glow tied to combo streak
  if(gs.comboStreak>=5){
    const glowCol=gs.comboStreak>=10?'rgba(255,30,30,':'rgba(255,180,0,';
    const glowAlpha=Math.min(0.6,(gs.comboStreak-5)*0.04);
    ctx.save();ctx.strokeStyle=glowCol+glowAlpha+')';ctx.lineWidth=18;
    ctx.strokeRect(9,9,RW-18,RH-18);ctx.restore();
  }
  drawHUD();
  if(gs.started&&!gs.over&&!gs.won){
    btn(RW-40,RH-44,34,32,'||','#222',()=>{screen=S.PAUSED;stopMusic();},14);
  }
  // Active modifiers badge strip — wraps to two rows if many mods active
  if(gs.mode==='unlimited'&&activeMods.size>0){
    const mArr=[...activeMods];
    const shortLabel=m=>MOD_LABELS[m]||m;
    let mx=4,my=RH-26,rowH=22;
    mArr.forEach(m=>{
      const lbl=shortLabel(m);const bw=lbl.length*6.5+10;
      if(mx+bw>RW-8){mx=4;my-=rowH;}
      roundRect(mx,my,bw,18,4,'rgba(0,0,0,0.6)','#AA66FF');
      ctx.fillStyle='#CC99FF';ctx.font='bold 9px Arial';ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText(lbl.toUpperCase(),mx+5,my+9);
      mx+=bw+4;
    });
  }
  if(!gs.started){
    ctx.fillStyle='rgba(0,0,0,0.48)';ctx.fillRect(0,0,RW,RH);
    ctx.fillStyle='#FFD700';ctx.font='bold 38px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Fly Birdy',RW/2,RH/2-60);
    drawBirdAt(RW/2,RH/2,gs.bird,true);
    ctx.fillStyle='#fff';ctx.font='bold 22px Arial';ctx.fillText('Tap to Start!',RW/2,RH/2+54);
    ctx.fillStyle='#ddd';ctx.font='14px Arial';ctx.fillText('SPACE = Flap   P = Pause',RW/2,RH/2+82);
    ctx.fillStyle='#aaa';ctx.font='13px Arial';ctx.fillText(BIRDS[gs.bird].name+': '+BIRDS[gs.bird].skillDesc,RW/2,RH/2+106);
  }
  inGameDraw=false;
}

// --- INPUT -----------------------------------------------------------------------
// Swipe right (=60px horizontal, <400ms, dominant axis) on any menu screen goes back
const BACK_SCREEN = {
  [S.MODE_SELECT]:    ()=>{ screen=S.WELCOME; },
  [S.LEVEL_SELECT]:   ()=>{ screen=S.MODE_SELECT; },
  [S.BIRD_SELECT]:    ()=>{ screen=S.WELCOME; },
  [S.HIGH_SCORES]:    ()=>{ screen=S.WELCOME; },
  [S.SETTINGS]:       ()=>{ screen=S.WELCOME; },
  [S.AUDIO]:          ()=>{ screen=S.SETTINGS; },
  [S.ACHIEVEMENTS]:   ()=>{ screen=S.WELCOME; },
  [S.CHALLENGE]:      ()=>{ screen=S.WELCOME; },
  [S.UNLIMITED_OPTS]: ()=>{ screen=S.MODE_SELECT; },
  [S.PAUSED]:         ()=>{ screen=S.GAME; startMusic(); }
};

let swipeStartX=0, swipeStartY=0, swipeStartTime=0;
let lastTapPx=0, lastTapPy=0; // real canvas px of last resolved tap

canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();resumeAudio();
  swipeStartX=e.clientX; swipeStartY=e.clientY; swipeStartTime=Date.now();
  if(screen===S.AUDIO&&trimState){
    const uiS=Math.min(RW/W,RH/H),uiOX=(RW-W*uiS)/2,uiOY=(RH-H*uiS)/2;
    const lx=(e.clientX-uiOX)/uiS, ly=(e.clientY-uiOY)/uiS;
    if(trimPointerDown(lx,ly)) return;
  }
  // Flap fires immediately on pointerdown for tight game feel
  if(screen===S.GAME&&!gs.over&&!gs.won) playerFlap();
});

canvas.addEventListener('pointerup',e=>{
  if(screen===S.GAME) playerRelease();
},{ passive:true });

canvas.addEventListener('pointermove',e=>{
  if(screen===S.AUDIO&&trimState&&trimState.dragging){
    const uiS=Math.min(RW/W,RH/H),uiOX=(RW-W*uiS)/2;
    trimPointerMove((e.clientX-uiOX)/uiS);
  }
});

canvas.addEventListener('pointerup',e=>{ trimPointerUp(); },{ passive:true });

canvas.addEventListener('pointerup',e=>{
  e.preventDefault();
  const dx=e.clientX-swipeStartX, dy=e.clientY-swipeStartY;
  const dt=Date.now()-swipeStartTime;
  const absDx=Math.abs(dx), absDy=Math.abs(dy);

  // Swipe right on menu screens: go back
  if(dt<400 && absDx>60 && absDx>absDy*1.5 && dx>0 && screen!==S.GAME){
    const back=BACK_SCREEN[screen];
    if(back){ SFX.click(); back(); return; }
  }

  // Always hit-test on small taps; handles pause button during active gameplay
  if(absDx<20 && absDy<20){
    const rect=canvas.getBoundingClientRect();
    const px=(e.clientX-rect.left)*(canvas.width/rect.width),py=(e.clientY-rect.top)*(canvas.height/rect.height);
    lastTapPx=px; lastTapPy=py;
    hitBtn(px,py);
  }
});

document.addEventListener('keydown',e=>{
  if(nameEntry.active){ if(e.code==='Enter') submitPlayerName(); return; }
  if(e.code==='Space'){e.preventDefault();resumeAudio();if(screen===S.GAME&&!gs.over&&!gs.won) playerFlap();}
  if(e.code==='KeyP'){
    if(screen===S.GAME&&gs.started&&!gs.over&&!gs.won){screen=S.PAUSED;stopMusic();}
    else if(screen===S.PAUSED){screen=S.GAME;startMusic();}
  }
  if(e.code==='Escape'){
    const back=BACK_SCREEN[screen];
    if(back){ SFX.click(); back(); }
  }
});

// Android hardware back button � navigate back instead of closing the app
function handleAndroidBack(){
  const back=BACK_SCREEN[screen];
  if(back){ SFX.click(); back(); }
  // On WELCOME screen there is no back entry, so the app stays open
}
// Capacitor App plugin (most reliable in Capacitor WebView)
if(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.App){
  window.Capacitor.Plugins.App.addListener('backButton',handleAndroidBack);
}
// DOM fallback for other WebView environments
document.addEventListener('backbutton',e=>{ e.preventDefault(); handleAndroidBack(); },false);

// Auto-pause when tab/app becomes hidden
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&screen===S.GAME&&gs.started&&!gs.over&&!gs.won){screen=S.PAUSED;stopMusic();}
});

// --- MAIN LOOP ------------------------------------------------------------------
// Clears canvas, resets btns[], dispatches to current screen's draw (+ update for GAME)
function loop(){
  ctx.clearRect(0,0,RW,RH);btns=[];
  // FPS counter
  _loopFPS++;const _now=Date.now();if(_now-_lastFPSTime>=1000){fps=_loopFPS;_loopFPS=0;_lastFPSTime=_now;}
  // Uniform scale keeps 400×600 aspect ratio; centres UI in any window size
  const uiS=Math.min(RW/W,RH/H);
  const uiOX=(RW-W*uiS)/2, uiOY=(RH-H*uiS)/2;
  function uiCtx(fn){ctx.save();ctx.translate(uiOX,uiOY);ctx.scale(uiS,uiS);fn();ctx.restore();}
  // Fill letterbox area with background colour
  if(uiOX>0||uiOY>0){ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,RW,RH);}
  switch(screen){
    case S.LOADING:      uiCtx(drawLoading);break;
    case S.WELCOME:      uiCtx(drawWelcome);break;
    case S.MODE_SELECT:  uiCtx(drawModeSelect);break;
    case S.LEVEL_SELECT: uiCtx(drawLevelSelect);break;
    case S.BIRD_SELECT:  uiCtx(drawBirdSelect);break;
    case S.HIGH_SCORES:  uiCtx(drawHighScores);break;
    case S.SETTINGS:     uiCtx(drawSettings);break;
    case S.AUDIO:           uiCtx(drawAudio);break;
    case S.ACHIEVEMENTS:    uiCtx(drawAchievements);break;
    case S.CHALLENGE:       uiCtx(drawChallenge);break;
    case S.UNLIMITED_OPTS:  uiCtx(drawUnlimitedOpts);break;
    case S.PAUSED:          drawPaused();break;
    case S.GAME:
      updateGame();drawGame();
      if(gs.over){uiCtx(drawGameOver);}
      if(gs.won){uiCtx(drawLevelWon);}
      break;
  }
  uiCtx(()=>{drawPopup();drawNameEntry();drawConfetti();drawTransition();});
  requestAnimationFrame(loop);
}
loop();



