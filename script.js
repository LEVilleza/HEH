

'use strict';

/* -- Configuration ------------------------------------------- */
const CONFIG = {
  /* How many bubbles are visible on screen at once */
  VISIBLE_BUBBLE_COUNT: 8,

  /* Bubble size raange */
  BUBBLE_MIN_SIZE: 110,
  BUBBLE_MAX_SIZE: 190,

  /* Bubble drift speed range (px per frame) */
  BUBBLE_MIN_SPEED: 0.3,
  BUBBLE_MAX_SPEED: 0.75,

  /* Delay between bubble initial spawn */
  STAGGER_S: 0.5,

  /* Delay for bubble respanw */
  RESPAWN_DELAY_MS: 1000,

  /* Seconds a pop-ripple stays in DOM */
  RIPPLE_CLEANUP_MS: 700,

  /* Top margin to avoid spawning under the header (px) */
  HEADER_CLEARANCE: 130,

  /* Volume for background music (0-1) */
  MUSIC_VOLUME: 0.35,

  /* Number of ambient star particles */
  STAR_COUNT: 55,
};

/* -- State ---------------------------------------------------- */
let messages     = [];
let musicPlaying = false;
let musicStarted = false;
let rafId        = null;      // requestAnimationFrame handle

/* Each entry: { el, x, y, vx, vy, size, wobblePhase, wobbleAmp } */
const activeBubbles = [];

/* Shuffled message queue */
let messageQueue = [];

/* -- DOM Refs ------------------------------------------------- */
const scene         = document.getElementById('bubble-scene');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalCard     = document.getElementById('modal-card');
const modalClose    = document.getElementById('modal-close');
const modalFrom     = document.getElementById('modal-from');
const modalPreview  = document.getElementById('modal-preview');
const modalBody     = document.getElementById('modal-body');
const modalGemIcon  = document.querySelector('.modal-gem-icon');
const modalDivider  = document.querySelector('.modal-divider');
const bgMusic       = document.getElementById('bg-music');
const musicToggle   = document.getElementById('music-toggle');
const musicIconOn   = document.querySelector('.music-icon--on');
const musicIconOff  = document.querySelector('.music-icon--off');
const starsLayer    = document.querySelector('.stars-layer');

/* -- Utility -------------------------------------------------- */
function rand(min, max)    { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

/* -- Message Queue -------------------------------------------- */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextMessage() {
  if (messageQueue.length === 0) messageQueue = shuffle(messages);
  return messageQueue.shift();
}

/* -- Load Messages -------------------------------------------- */
async function loadMessages() {
  try {
    const res = await fetch('messages.json');
    messages  = await res.json();
  } catch (err) {
    console.warn('Could not load messages.json - using fallback.', err);
    messages = [{
      id: 1, preview: '✨ Happy Birthday!',
      from: 'With Love', message: 'Wishing you the most wonderful day.', color: '#fde6a0',
    }];
  }
  messageQueue = shuffle(messages);
  init();
}

/* -- Helpers -------------------------------------------------- */
function extractEmoji(str) {
  const match = str.match(/^\p{Emoji}/u);
  return match ? match[0] : '';
}
function stripEmoji(str) {
  return str.replace(/^\p{Emoji}\s*/u, '').trim();
}

/* -- Create bubble DOM element -------------------- */
/* Returns the element only, physics state is handled separately */
function createBubbleEl(msg) {
  const el = document.createElement('div');
  el.className = 'bubble';
  el.innerHTML = `
    <span class="bubble-icon" aria-hidden="true">${extractEmoji(msg.preview)}</span>
    <span class="bubble-preview">${stripEmoji(msg.preview)}</span>
  `;

  /* Fixed coral-rose colour, low alpha for glass effect */
  el.style.setProperty('--bubble-color', 'rgba(252, 98, 111, 0.22)');
  el.style.setProperty('--bubble-glow',  'rgba(252, 98, 111, 0.40)');

  el.dataset.msgId = msg.id;
  return el;
}

/* -- Spawn one bubble with physics state ----------------------- */
function spawnBubble(staggerIndex = 0) {
  const msg  = nextMessage();
  const size = randInt(CONFIG.BUBBLE_MIN_SIZE, CONFIG.BUBBLE_MAX_SIZE);

  /* Makes sure bubble spawns in viewport under header area */
  const maxX = window.innerWidth  - size;
  const maxY = window.innerHeight - size;
  const minY = CONFIG.HEADER_CLEARANCE;

  const x = rand(0, maxX);
  const y = rand(minY, Math.max(minY, maxY));

  /* Random floating/drifting direction, controlled speed */
  const speed = rand(CONFIG.BUBBLE_MIN_SPEED, CONFIG.BUBBLE_MAX_SPEED);
  const angle = rand(0, Math.PI * 2);
  const vx    = Math.cos(angle) * speed;
  const vy    = Math.sin(angle) * speed;

  /* Gentle sine wobble for more natural feel */
  const wobbleAmp   = rand(0.08, 0.22);  // how strong wobble
  const wobbleSpeed = rand(0.015, 0.04); // how fast wobble 

  const el = createBubbleEl(msg);

  /* Position absolutely in px - rAF loop updates left/top each frame */
  el.style.width  = `${size}px`;
  el.style.height = `${size}px`;
  el.style.left   = `${x}px`;
  el.style.top    = `${y}px`;

  scene.appendChild(el);

  /* Staggered entrance fade-in */
  const delay = staggerIndex * CONFIG.STAGGER_S * 1000;
  setTimeout(() => el.classList.add('visible'), delay + 60);

  /* Attach click handler (needs physics object, added to array first) */
  const physics = { el, x, y, vx, vy, size, wobblePhase: rand(0, Math.PI * 2), wobbleAmp, wobbleSpeed, popping: false, msg };
  el.addEventListener('click', () => onBubbleClick(physics));

  activeBubbles.push(physics);
}

/* -- Physics loop ---------------------------------------------- */
function physicsLoop() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (const b of activeBubbles) {
    if (b.popping) continue; // frozen during pop animation

    /* Advance wobble phase */
    b.wobblePhase += b.wobbleSpeed;

    /* Move with velocity + wobble */
    const perpX = -b.vy;
    const perpY =  b.vx;
    const wobble = Math.sin(b.wobblePhase) * b.wobbleAmp;

    b.x += b.vx + perpX * wobble;
    b.y += b.vy + perpY * wobble;

    /* -- Bounce off viewport edges -- */

    /* Left edge */
    if (b.x < 0) {
      b.x  = 0;
      b.vx = Math.abs(b.vx);
    }
    /* Right edge */
    if (b.x + b.size > vw) {
      b.x  = vw - b.size;
      b.vx = -Math.abs(b.vx);
    }
    /* Top edge + header*/
    if (b.y < CONFIG.HEADER_CLEARANCE) {
      b.y  = CONFIG.HEADER_CLEARANCE;
      b.vy = Math.abs(b.vy);
    }
    /* Bottom edge */
    if (b.y + b.size > vh) {
      b.y  = vh - b.size;
      b.vy = -Math.abs(b.vy);
    }

    /* Apply to DOM */
    b.el.style.left = `${b.x}px`;
    b.el.style.top  = `${b.y}px`;
  }

  rafId = requestAnimationFrame(physicsLoop);
}

/* -- Bubble click: freeze > pop > modal > respawn ------------- */
function onBubbleClick(physics) {
  if (physics.popping) return;

  /* Freeze in the physics loop */
  physics.popping = true;

  /* Snap out of CSS hover scale before popping */
  physics.el.style.transform = 'scale(1)';

  /* Small delay so the scale reset is visible before pop fires */
  setTimeout(() => {
    physics.el.classList.add('popping');
    spawnRipple(physics);

    function onPopEnd(e) {
      if (e.animationName !== 'bubblePop') return;
      physics.el.removeEventListener('animationend', onPopEnd);
      physics.el.remove();

      /* Remove from activeBubbles */
      const idx = activeBubbles.indexOf(physics);
      if (idx !== -1) activeBubbles.splice(idx, 1);

      showModal(physics.msg);

      /* Spawn replacement while modal is open */
      setTimeout(() => spawnBubble(0), CONFIG.RESPAWN_DELAY_MS);
    }

    physics.el.addEventListener('animationend', onPopEnd);
  }, 40);

  if (!musicStarted) attemptAutoplay();
}

/* -- Ripple ---------------------------------------------------- */
function spawnRipple(physics) {
  const ripple = document.createElement('div');
  ripple.className = 'bubble-ripple';
  Object.assign(ripple.style, {
    width:       `${physics.size}px`,
    height:      `${physics.size}px`,
    left:        `${physics.x}px`,
    top:         `${physics.y}px`,
    position:    'fixed',
    zIndex:      '4',
    borderColor: 'rgba(252, 98, 111, 0.6)',
  });
  document.body.appendChild(ripple);
  setTimeout(() => ripple.remove(), CONFIG.RIPPLE_CLEANUP_MS);
}

/* -- Modal ----------------------------------------------------- */
function showModal(msg) {
  modalFrom.textContent    = `- ${msg.from} -`;
  modalPreview.textContent = msg.preview;
  modalBody.textContent    = msg.message;

  const accent = msg.color || 'rgba(255,220,180,0.8)';
  modalCard.style.setProperty('--modal-accent', accent);
  modalGemIcon.style.color           = accent;
  modalDivider.style.backgroundImage = `linear-gradient(90deg, transparent, ${accent}, transparent)`;

  modalBackdrop.hidden = false;
  modalBackdrop.offsetHeight; // force reflow so transition fires
  modalClose.focus();
  modalCard.scrollTop = 0;
}

function hideModal() {
  modalBackdrop.hidden = true;
}

modalClose.addEventListener('click', hideModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) hideModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modalBackdrop.hidden) hideModal();
});

/* -- Audio ----------------------------------------------------- */
function attemptAutoplay() {
  musicStarted   = true;
  bgMusic.volume = CONFIG.MUSIC_VOLUME;
  bgMusic.play()
    .then(() => { musicPlaying = true;  updateMusicUI(); })
    .catch(() => { musicPlaying = false; updateMusicUI(); });
}

musicToggle.addEventListener('click', () => {
  if (!musicStarted) { attemptAutoplay(); return; }
  if (musicPlaying) { bgMusic.pause(); musicPlaying = false; }
  else { bgMusic.play().then(() => { musicPlaying = true; updateMusicUI(); }); }
  updateMusicUI();
});

function updateMusicUI() {
  musicToggle.classList.toggle('playing', musicPlaying);
  musicIconOn.hidden  = !musicPlaying;
  musicIconOff.hidden =  musicPlaying;
  musicToggle.setAttribute('aria-label', musicPlaying ? 'Pause music' : 'Play music');
}

/* -- Ambient Stars --------------------------------------------- */
function createStars() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    const size = rand(1, 3).toFixed(1);
    Object.assign(star.style, {
      width: `${size}px`, height: `${size}px`,
      left: `${rand(0, 100)}vw`, top: `${rand(0, 100)}vh`,
      '--dur':        `${rand(2, 5).toFixed(1)}s`,
      '--delay':      `${rand(0, 6).toFixed(1)}s`,
      '--brightness': `${rand(0.3, 0.9).toFixed(2)}`,
    });
    frag.appendChild(star);
  }
  starsLayer.appendChild(frag);
}

/* -- Handle window resize -------------------------------------- */
/* Clamp all bubbles back into bounds if the window shrinks */
window.addEventListener('resize', () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const b of activeBubbles) {
    b.x = Math.min(b.x, vw - b.size);
    b.y = Math.min(b.y, vh - b.size);
    b.x = Math.max(b.x, 0);
    b.y = Math.max(b.y, CONFIG.HEADER_CLEARANCE);
  }
});

/* -- Van Button ------------------------------------------------ */
const vanBtn = document.getElementById('van-btn');
vanBtn.addEventListener('click', () => {
  console.log('Van button clicked - hook up drive.html here.');
});

/* -- Init ------------------------------------------------------ */
function init() {
  createStars();

  /* Spawn all initial bubbles with stagger */
  for (let i = 0; i < CONFIG.VISIBLE_BUBBLE_COUNT; i++) {
    spawnBubble(i);
  }

  /* Start the physics loop */
  rafId = requestAnimationFrame(physicsLoop);

  /* Attempt music autoplay */
  bgMusic.volume = CONFIG.MUSIC_VOLUME;
  bgMusic.play()
    .then(() => { musicPlaying = true; musicStarted = true; updateMusicUI(); })
    .catch(() => {});
}

loadMessages();