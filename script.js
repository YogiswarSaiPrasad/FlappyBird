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
const S = { LOADING:'loading', WELCOME:'welcome', MODE_SELECT:'mode_select', LEVEL_SELECT:'level_select', BIRD_SELECT:'bird_select', SETTINGS:'settings', HIGH_SCORES:'highscores', GAME:'game', PAUSED:'paused' };
let screen = S.LOADING;

// --- AUDIO -------------------------------------------------------------------
// All sound generated via Web Audio API oscillators � no audio files needed.
// resumeAudio() must be called from a user-gesture handler (autoplay policy).
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let musicPlaying=false, bgNodes=[], musicEnabled=true, soundEnabled=true;
function resumeAudio(){ if(audioCtx.state==='suspended') audioCtx.resume(); }
// Plays a single short oscillator tone (fire-and-forget)
function playTone(freq,type='square',dur=0.1,vol=0.3){
  if(!soundEnabled)return; resumeAudio();
  const o=audioCtx.createOscillator(),g=audioCtx.createGain();
  o.connect(g);g.connect(audioCtx.destination);
  o.type=type;o.frequency.value=freq;
  g.gain.setValueAtTime(vol,audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);
  o.start();o.stop(audioCtx.currentTime+dur);
}
const SFX={
  flap:()=>playTone(520,'square',0.08,0.25),
  // satisfying two-note ding when passing a pillar
  score:()=>{playTone(660,'sine',0.07,0.22);setTimeout(()=>playTone(990,'sine',0.12,0.28),75);},
  die:()=>playTone(200,'sawtooth',0.5,0.4),
  coin:()=>playTone(1200,'sine',0.1,0.2),
  shoot:()=>playTone(900,'square',0.04,0.15),
  hit:()=>playTone(300,'sawtooth',0.2,0.3),
  click:()=>{playTone(440,'sine',0.05,0.15);playTone(110,'sine',0.1,0.2);}, // click + bass thud
  levelup:()=>{[523,659,784,1046].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.2,0.3),i*120));},
  // nature-specific powerup sounds
  heart:()=>{[523,659,784].forEach((f,i)=>setTimeout(()=>playTone(f,'sine',0.12,0.3),i*90));},
  shield:()=>{playTone(180,'square',0.06,0.25);setTimeout(()=>playTone(360,'square',0.12,0.3),60);},
  magnet:()=>{[0,1,2,3,4].forEach(i=>setTimeout(()=>playTone(280+i*60,'square',0.04,0.18),i*35));}
};
// Background music loops MELODY endlessly by scheduling each note individually
// so stopMusic() can cancel pending nodes at any time without clicks or pops
const MELODY=[523,659,784,659,523,392,440,523];
function startMusic(){ if(musicPlaying||!musicEnabled)return; musicPlaying=true; resumeAudio(); scheduleLoop(audioCtx.currentTime); }
function scheduleLoop(t){
  if(!musicPlaying)return;
  MELODY.forEach((f,i)=>{
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g);g.connect(audioCtx.destination);
    o.type='triangle';o.frequency.value=f;
    g.gain.setValueAtTime(0.14,t+i*0.22);
    g.gain.exponentialRampToValueAtTime(0.001,t+i*0.22+0.2);
    o.start(t+i*0.22);o.stop(t+i*0.22+0.22);
    bgNodes.push(o);
    if(i===MELODY.length-1) o.onended=()=>{bgNodes=[];scheduleLoop(audioCtx.currentTime);};
  });
}
function stopMusic(){ musicPlaying=false; bgNodes.forEach(n=>{try{n.stop();}catch(_){}}); bgNodes=[]; }

// --- SAVE / LOAD -------------------------------------------------------------
// Fields merged individually so new fields always fall back to defaults in `save`.
const SAVE_KEY='flybirdy_v1';
let save={
  unlockedLevels:1,coins:0,
  highScores:[{name:'SWIFT',score:500},{name:'BLAZE',score:400},{name:'NOVA',score:300},{name:'REX',score:200},{name:'ACE',score:100}],
  settings:{music:true,sound:true,graphics:'high'},
  unlockedBirds:['sparrow'],selectedBird:'sparrow',
  purchasedSkins:['sparrow_default'],
  selectedSkins:{sparrow:'sparrow_default',eagle:'eagle_default',owl:'owl_default',parrot:'parrot_default',flamingo:'flamingo_default'}
};
function loadSave(){
  try{
    const d=JSON.parse(localStorage.getItem(SAVE_KEY));
    if(d){
      if(d.unlockedLevels) save.unlockedLevels=d.unlockedLevels;
      if(typeof d.coins==='number') save.coins=d.coins;
      if(d.highScores&&d.highScores.length){save.highScores=d.highScores.slice(0,5);}
      if(d.settings) save.settings={...save.settings,...d.settings};
      if(d.unlockedBirds) save.unlockedBirds=d.unlockedBirds;
      if(d.selectedBird) save.selectedBird=d.selectedBird;
      if(d.purchasedSkins) save.purchasedSkins=d.purchasedSkins;
      if(d.selectedSkins) save.selectedSkins={...save.selectedSkins,...d.selectedSkins};
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

// Initialises all mutable game state for a fresh run
function initGameState(levelId,mode){
  const lvl=(mode==='unlimited')?{...LEVELS[0],bg:'day'}:{...LEVELS[levelId-1]};
  if(mode==='adventure') lvl.gap+=40; // adventure is more forgiving
  const startHp=save.selectedBird==='parrot'?2:1;
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
    bgClouds:Array.from({length:6},()=>({x:Math.random()*RW,y:40+Math.random()*(RH*0.35),w:60+Math.random()*80,h:25+Math.random()*20,speed:0.3+Math.random()*0.4}))
  };
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
  roundRect(x,y,w,h,8,disabled?'#555':color,disabled?'#666':'#fff');
  ctx.fillStyle=disabled?'#888':'#fff';
  ctx.font=`bold ${fontSize}px Arial`;
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(label,x+w/2,y+h/2);
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
  const col=bg==='space'?'#4B4BA0':bg==='night'?'#1A6A1A':'#2DA02D';
  const dark=bg==='space'?'#353580':bg==='night'?'#0E500E':'#1A7A1A';
  for(const p of gs.pipes){
    const gapY=p.topH+gs.level.gap;
    ctx.fillStyle=col;ctx.fillRect(p.x,0,50,p.topH);ctx.fillRect(p.x,gapY,50,RH-gapY);
    ctx.fillStyle=dark;ctx.fillRect(p.x-4,p.topH-14,58,14);ctx.fillRect(p.x-4,gapY,58,14);
    ctx.fillStyle='rgba(255,255,255,0.12)';ctx.fillRect(p.x+6,0,8,p.topH-14);ctx.fillRect(p.x+6,gapY+14,8,RH-gapY-14);
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
  if(save.settings.graphics==='low')return;
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
  }else{
    roundRect(RW/2-44,5,88,24,5,'rgba(80,0,120,0.6)');
    ctx.fillStyle='#DA70D6';ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('UNLIMITED',RW/2,17);
  }
  let effY=80;
  if(gs.shieldTimer>0){ctx.fillStyle='rgba(68,136,255,0.8)';ctx.font='12px Arial';ctx.textAlign='left';ctx.fillText('Shield '+Math.ceil(gs.shieldTimer/60)+'s',8,effY);effY+=18;}
  if(gs.magnetTimer>0){ctx.fillStyle='rgba(187,68,255,0.8)';ctx.font='12px Arial';ctx.textAlign='left';ctx.fillText('Magnet '+Math.ceil(gs.magnetTimer/60)+'s',8,effY);}
  if(gs.canShoot){ctx.fillStyle='rgba(255,60,60,0.9)';ctx.font='bold 13px Arial';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('TAP = FLAP + SHOOT',RW/2,RH-30);}
}

// --- GAME LOGIC --------------------------------------------------------------
// Spawns a pipe pair at a random gap position, plus coins and optionally a power-up
function spawnPipe(){
  const margin=60;
  const topH=margin+Math.random()*(RH-gs.level.gap-margin*2);
  const p={x:RW,topH,scored:false};
  gs.pipes.push(p);
  const gapMid=topH+gs.level.gap/2;
  const n=save.selectedBird==='sparrow'?6:3; // sparrow skill: exactly 2� coins
  for(let i=0;i<n;i++){gs.coinItems.push({x:RW+12+i*16,y:gapMid+(Math.random()-0.5)*(gs.level.gap*0.5),collected:false});}
  gs.puCountdown--;
  if(gs.puCountdown<=0){
    if(gs.puQueue.length===0) gs.puQueue=makePuQueue(gs.lastPuType);
    const puType=gs.puQueue.shift(); gs.lastPuType=puType;
    const puY=gapMid+(Math.random()-0.5)*gs.level.gap*0.4;
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
  if(gs.shieldTimer>0){gs.shieldTimer=0;gs.invincible=60;SFX.hit();spawnParticles(BX,gs.birdY,'#3388FF',10);return;}
  gs.hp--;gs.invincible=100;SFX.die();spawnParticles(BX,gs.birdY,'#FF2244',8);
  if(gs.hp<=0){
    gs.over=true;stopMusic();save.coins+=gs.sessionCoins;writeSave();
    if(!gs.nameEntered){
      gs.nameEntered=true;
      if(isTopScore(gs.score)){
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
  if(!gs.started){gs.started=true;startMusic();}
  const impulse=(save.selectedBird==='eagle'&&gs.velocity>3)?-5.2:-4.3;
  gs.velocity=impulse;SFX.flap();
  if(gs.canShoot&&gs.shootCooldown<=0){gs.bullets.push({x:BX+22,y:gs.birdY});gs.shootCooldown=18;SFX.shoot();}
}

// --- UPDATE LOOP --------------------------------------------------------------
// Order: timers ? spawning ? physics ? coins ? power-ups ? enemies ? bullets ? collision
function updateGame(){
  if(!gs.started||gs.over||gs.won)return;
  gs.frameCount++;
  // tick all per-frame countdown timers
  if(gs.invincible>0)gs.invincible--;if(gs.shieldTimer>0)gs.shieldTimer--;if(gs.magnetTimer>0)gs.magnetTimer--;if(gs.shootCooldown>0)gs.shootCooldown--;
  if(gs.mode==='unlimited') gs.speedMult=1+gs.frameCount/3600; // speed ramps gradually
  gs.pipeSpeed=gs.level.pipeSpeed*gs.speedMult;
  // spawn when last pipe has scrolled exactly spawnDist pixels � guarantees equal visual spacing
  const spawnDist=gs.level.interval*gs.level.pipeSpeed;
  const lastPipe=gs.pipes.length>0?gs.pipes[gs.pipes.length-1]:null;
  if(!lastPipe||lastPipe.x<=RW-spawnDist) spawnPipe();
  if(gs.level.hasEnemies&&!gs.boss&&gs.frameCount%220===0) spawnEnemy(); // ~3.5 s intervals
  if(gs.level.hasBoss&&!gs.bossSpawned&&gs.score>=20){gs.bossSpawned=true;spawnBoss();}
  if(gs.level.bg==='day'||gs.level.bg==='sunset') moveClouds();
  const grav=(save.selectedBird==='flamingo')?0.22:0.35; // flamingo skill: reduced gravity
  gs.velocity+=grav;gs.birdY+=gs.velocity;
  for(const p of gs.pipes){
    p.x-=gs.pipeSpeed;
    if(!p.scored&&p.x+50<BX){
      p.scored=true;gs.score++;SFX.score();
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
  // pipe AABB collision (top or bottom pillar)
  for(const p of gs.pipes){const bL=BX-BR,bR2=BX+BR,bT=gs.birdY-BR,bBot=gs.birdY+BR,gapY=p.topH+gs.level.gap;if(bR2>p.x&&bL<p.x+50&&(bT<p.topH||bBot>gapY)){takeDamage();break;}}
  for(const e of gs.enemies){if(!e.dead&&Math.sqrt((BX-e.x)**2+(gs.birdY-e.y)**2)<BR+16) takeDamage();}
  if(gs.boss&&!gs.boss.dead&&Math.sqrt((BX-gs.boss.x)**2+(gs.birdY-gs.boss.y)**2)<BR+42) takeDamage();
  // floor: takeDamage so shield is consumed on landing; ceiling: hard stop
  if(gs.birdY+BR>RH){gs.birdY=RH-BR;gs.velocity=0;takeDamage();}
  if(gs.birdY-BR<0){gs.birdY=BR;gs.velocity=0;}
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
  }
  ctx.globalAlpha=1;
  if(loadTimer>=dur){loadTimer=0;loadPhase++;if(loadPhase>=2){loadSave();screen=S.WELCOME;}}
}

// --- SCREEN: WELCOME ------------------------------------------------------------
function drawWelcome(){
  drawBg('day');
  roundRect(30,85,340,135,18,'rgba(0,20,60,0.78)','rgba(255,215,0,0.45)');
  ctx.fillStyle='rgba(255,215,0,0.75)';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Welcome to',W/2,122);
  ctx.fillStyle='#FFD700';ctx.font="bold 48px Arial";ctx.fillText("'Fly Birdy'",W/2,174);
  drawBirdAt(W/2,278,save.selectedBird,true);
  btn(60,328,280,54,'PLAY','#2ECC71',()=>{screen=S.MODE_SELECT;},20);
  btn(50,400,135,46,'Scores','#E67E22',()=>{screen=S.HIGH_SCORES;},13);
  btn(215,400,135,46,'Settings','#3498DB',()=>{screen=S.SETTINGS;},13);
  btn(50,460,135,46,'Birds','#9B59B6',()=>{screen=S.BIRD_SELECT;},13);
  roundRect(215,460,135,46,8,'#B06000','#F39C12');
  ctx.fillStyle='#FFD700';ctx.font='bold 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Coins: '+save.coins,215+135/2,460+23);
}

// --- SCREEN: MODE SELECT -------------------------------------------------------
function drawModeSelect(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 32px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Select Mode',W/2,70);
  roundRect(22,105,356,180,18,'rgba(0,60,20,0.85)','rgba(50,200,100,0.4)');
  ctx.fillStyle='#7CFC00';ctx.font='bold 26px Arial';ctx.fillText('Adventure',W/2,148);
  ctx.fillStyle='#c8ffc8';ctx.font='14px Arial';ctx.fillText('10 levels  \u2022  enemies  \u2022  boss fights',W/2,178);ctx.fillText('unlock levels  \u2022  earn coins',W/2,198);
  btn(110,218,180,46,'PLAY ADVENTURE','#27AE60',()=>{screen=S.LEVEL_SELECT;},14);
  roundRect(22,308,356,178,18,'rgba(60,0,90,0.85)','rgba(180,80,255,0.35)');
  ctx.fillStyle='#DA70D6';ctx.font='bold 26px Arial';ctx.fillText('Unlimited',W/2,350);
  ctx.fillStyle='#e8c0ff';ctx.font='14px Arial';ctx.fillText('Endless  \u2022  speed ramps forever',W/2,380);ctx.fillText('coins  \u2022  powerups  \u2022  high score',W/2,400);
  btn(110,420,180,46,'PLAY UNLIMITED','#8E44AD',()=>{initGameState(1,'unlimited');screen=S.GAME;startMusic();},14);
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

// --- SCREEN: HIGH SCORES -------------------------------------------------------
function drawHighScores(){
  drawBg('night');
  btn(6,6,70,26,'< Back','#555',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 30px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('High Scores',W/2,48);
  roundRect(26,72,348,260,14,'rgba(0,0,0,0.65)','rgba(255,215,0,0.28)');
  save.highScores.slice(0,5).forEach((hs,i)=>{
    const y=130+i*42;
    ctx.fillStyle=i<3?['#FFD700','#C8C8C8','#CD7F32'][i]:'#ccc';
    ctx.font=`bold ${i<3?17:15}px Arial`;ctx.textAlign='left';ctx.textBaseline='middle';
    ctx.fillText((i<3?['1st','2nd','3rd'][i]:(i+1)+'.')+' '+(hs.name||'BIRD'),50,y);
    ctx.textAlign='right';ctx.fillText(hs.score,354,y);
    if(i<save.highScores.length-1){ctx.strokeStyle='rgba(255,255,255,0.08)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(40,y+16);ctx.lineTo(360,y+16);ctx.stroke();}
  });
}

// --- SCREEN: SETTINGS ------------------------------------------------------------
function drawSettings(){
  drawBg('day');
  btn(6,6,70,26,'< Back','#444',()=>{screen=S.WELCOME;},12);
  ctx.fillStyle='#FFD700';ctx.font='bold 30px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Settings',W/2,50);
  function toggleRow(label,val,y,action){
    roundRect(28,y,344,52,10,'rgba(0,0,0,0.35)','#555');
    ctx.fillStyle='#fff';ctx.font='17px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,50,y+25);
    btn(238,y+8,112,36,val?'ON':'OFF',val?'#27AE60':'#E74C3C',action,14);
  }
  toggleRow('Music',save.settings.music,100,()=>{save.settings.music=!save.settings.music;musicEnabled=save.settings.music;if(!musicEnabled)stopMusic();writeSave();});
  toggleRow('Sound',save.settings.sound,165,()=>{save.settings.sound=!save.settings.sound;soundEnabled=save.settings.sound;writeSave();});
  roundRect(28,230,344,50,10,'rgba(0,0,0,0.35)','#555');
  ctx.fillStyle='#fff';ctx.font='17px Arial';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText('Graphics',50,255);
  ['low','medium','high'].forEach((g,i)=>{btn(208+i*57,236,54,38,g[0].toUpperCase()+g.slice(1),save.settings.graphics===g?'#3498DB':'#555',()=>{save.settings.graphics=g;writeSave();},11);});
  btn(28,308,344,46,'Reset All Progress (DANGER)','#C0392B',()=>{if(confirm('Reset ALL progress?')){localStorage.removeItem(SAVE_KEY);location.reload();}},13);
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
  drawBg(gs.level.bg);
  if(save.selectedBird==='owl'&&save.settings.graphics!=='low'){
    ctx.globalAlpha=0.16;
    for(const p of gs.pipes){if(p.x>RW/2){const gapY2=p.topH+gs.level.gap;ctx.fillStyle='#fff';ctx.fillRect(p.x-65,0,50,p.topH);ctx.fillRect(p.x-65,gapY2,50,RH-gapY2);}}
    ctx.globalAlpha=1;
  }
  drawPipes();drawCoins();drawPowerups();drawEnemies();drawBullets();
  if(gs.shieldTimer>0){ctx.save();ctx.strokeStyle='rgba(68,136,255,0.7)';ctx.lineWidth=5;ctx.beginPath();ctx.arc(BX,gs.birdY,BR+10,0,Math.PI*2);ctx.stroke();ctx.restore();}
  if(gs.invincible>0&&gs.invincible%10<5) ctx.globalAlpha=0.35;
  drawBirdAt(BX,gs.birdY,gs.bird,gs.velocity<-2);
  ctx.globalAlpha=1;
  if(save.settings.graphics!=='low') updateDrawParticles();
  drawHUD();
  if(gs.started&&!gs.over&&!gs.won){
    btn(RW-40,RH-44,34,32,'||','#222',()=>{screen=S.PAUSED;stopMusic();},14);
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
  [S.MODE_SELECT]:  ()=>{ screen=S.WELCOME; },
  [S.LEVEL_SELECT]: ()=>{ screen=S.MODE_SELECT; },
  [S.BIRD_SELECT]:  ()=>{ screen=S.WELCOME; },
  [S.HIGH_SCORES]:  ()=>{ screen=S.WELCOME; },
  [S.SETTINGS]:     ()=>{ screen=S.WELCOME; },
  [S.PAUSED]:       ()=>{ screen=S.GAME; startMusic(); }
};

let swipeStartX=0, swipeStartY=0, swipeStartTime=0;

canvas.addEventListener('pointerdown',e=>{
  e.preventDefault();resumeAudio();
  swipeStartX=e.clientX; swipeStartY=e.clientY; swipeStartTime=Date.now();
  // Flap fires immediately on pointerdown for tight game feel
  if(screen===S.GAME&&!gs.over&&!gs.won) playerFlap();
});

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

// --- MAIN LOOP ------------------------------------------------------------------
// Clears canvas, resets btns[], dispatches to current screen's draw (+ update for GAME)
function loop(){
  ctx.clearRect(0,0,RW,RH);btns=[];
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
    case S.PAUSED:       drawPaused();break;
    case S.GAME:
      updateGame();drawGame();
      if(gs.over){uiCtx(drawGameOver);}
      if(gs.won){uiCtx(drawLevelWon);}
      break;
  }
  uiCtx(()=>{drawPopup();drawNameEntry();});
  requestAnimationFrame(loop);
}
loop();



