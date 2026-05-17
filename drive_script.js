'use strict';

const FOLDER_ID     = '1tDgNpXKpka81W3c-JnVaczAYnwSPZhLq';
const GOOGLE_API_KEY = 'AIzaSyAm23GfwJPsQ8Xlm3Zmp0hn8K1lI6tS6m0';

const CONFIG = {
  /* Bubbles visible at once - randomised between these two values on load */
  BUBBLE_COUNT_MIN: 10,
  BUBBLE_COUNT_MAX: 15,

  BUBBLE_MIN_SIZE: 120,
  BUBBLE_MAX_SIZE: 200,

  BUBBLE_MIN_SPEED: 0.3,
  BUBBLE_MAX_SPEED: 0.75,

  STAGGER_S: 0.4,
  RESPAWN_DELAY_MS: 1000,
  RIPPLE_CLEANUP_MS: 700,

  HEADER_CLEARANCE: 130,

  MUSIC_VOLUME: 0.35,
  STAR_COUNT: 55,

  /* Drive API: fetch up to 500 images per folder */
  API_PAGE_SIZE: 1000,

  /* URL builders */
  THUMB: id => `https://lh3.googleusercontent.com/d/${id}=s280`,
  FULL:  id => `https://lh3.googleusercontent.com/d/${id}`,
};

/* == State ==================================================== */
let allPhotos        = [];   // full list fetched from Drive
let photoQueue       = [];   // shuffled cycle queue
let visibleCount     = 10;   // set randomly at init
let musicPlaying     = false;
let musicStarted     = false;
let rafId            = null;
const activeBubbles  = [];

/* == DOM ====================================================== */
const scene        = document.getElementById('bubble-scene');
const modalBackdrop = document.getElementById('modal-backdrop');
const modalCard    = document.getElementById('modal-card');
const modalClose   = document.getElementById('modal-close');
const modalPhoto   = document.getElementById('modal-photo');
const modalCaption = document.getElementById('modal-caption');
const modalShimmer = document.getElementById('modal-shimmer');
const bgMusic      = document.getElementById('bg-music');
const musicToggle  = document.getElementById('music-toggle');
const musicIconOn  = document.querySelector('.music-icon--on');
const musicIconOff = document.querySelector('.music-icon--off');
const starsLayer   = document.querySelector('.stars-layer');
const backBtn      = document.getElementById('back-btn');

/* == Utility ================================================== */
function rand(min, max)    { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextPhoto() {
  if (photoQueue.length === 0) photoQueue = shuffle(allPhotos);
  return photoQueue.shift();
}

/* == Fetch all images from the Drive folder =================== */
async function fetchFolderPhotos() {
  /* Show a subtle loading state on the header hint */
  const hint = document.querySelector('.site-hint');
  if (hint) hint.textContent = 'loading photos…';

  /* list files in folder filtered to images only. */
  const baseUrl   = 'https://www.googleapis.com/drive/v3/files';
  const query     = encodeURIComponent(`'${FOLDER_ID}' in parents and mimeType contains 'image/' and trashed = false`);
  const fields    = encodeURIComponent('nextPageToken, files(id, name, description)');
  const pageSize  = CONFIG.API_PAGE_SIZE;

  let photos    = [];
  let pageToken = '';

  try {
    do {
      const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const url = `${baseUrl}?q=${query}&fields=${fields}&pageSize=${pageSize}&key=${GOOGLE_API_KEY}${tokenParam}`;

      const res  = await fetch(url);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      photos     = photos.concat(data.files || []);
      pageToken  = data.nextPageToken || '';

    } while (pageToken);

    if (photos.length === 0) throw new Error('No images found in this folder.');

    allPhotos  = photos;
    photoQueue = shuffle(allPhotos);

    if (hint) hint.textContent = 'pop a bubble to see the photo';
    init();

  } catch (err) {
    console.error('Drive API error:', err.message);

    if (hint) hint.textContent = '⚠ Could not load photos - check console';

    /* Show a single placeholder bubble so the page isn't blank */
    allPhotos  = [{ id: '__placeholder__', name: 'Setup required', description: '' }];
    photoQueue = [...allPhotos];
    init();
  }
}

/* == Create bubble element ==================================== */
function createBubbleEl(photo) {
  const el = document.createElement('div');
  el.className     = 'bubble bubble--image';
  el.dataset.id    = photo.id;

  if (photo.id !== '__placeholder__') {
    const img     = document.createElement('img');
    img.className = 'bubble-thumb';
    img.src       = CONFIG.THUMB(photo.id);
    img.alt       = photo.name || '';
    img.draggable = false;
    img.onerror   = () => { img.style.display = 'none'; };
    el.appendChild(img);
  } else {
    el.innerHTML = `<span class="bubble-icon" aria-hidden="true">🫧</span>`;
  }

  el.style.setProperty('--bubble-color', 'rgba(252, 98, 111, 0.15)');
  el.style.setProperty('--bubble-glow',  'rgba(252, 98, 111, 0.40)');
  return el;
}

/* == Spawn one bubble ========================================= */
function spawnBubble(staggerIndex = 0) {
  const photo = nextPhoto();
  const size  = randInt(CONFIG.BUBBLE_MIN_SIZE, CONFIG.BUBBLE_MAX_SIZE);

  const maxX = window.innerWidth  - size;
  const maxY = window.innerHeight - size;
  const minY = CONFIG.HEADER_CLEARANCE;

  const x     = rand(0, maxX);
  const y     = rand(minY, Math.max(minY, maxY));
  const speed = rand(CONFIG.BUBBLE_MIN_SPEED, CONFIG.BUBBLE_MAX_SPEED);
  const angle = rand(0, Math.PI * 2);

  const el = createBubbleEl(photo);
  el.style.cssText += `width:${size}px;height:${size}px;left:${x}px;top:${y}px;`;
  scene.appendChild(el);

  setTimeout(() => el.classList.add('visible'), staggerIndex * CONFIG.STAGGER_S * 1000 + 60);

  const physics = {
    el, x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    wobblePhase: rand(0, Math.PI * 2),
    wobbleAmp:   rand(0.08, 0.22),
    wobbleSpeed: rand(0.015, 0.04),
    popping: false,
    photo,
  };

  el.addEventListener('click', () => onBubbleClick(physics));
  activeBubbles.push(physics);
}

/* == Physics loop ============================================= */
function physicsLoop() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  for (const b of activeBubbles) {
    if (b.popping) continue;

    b.wobblePhase += b.wobbleSpeed;
    const perpX  = -b.vy;
    const perpY  =  b.vx;
    const wobble = Math.sin(b.wobblePhase) * b.wobbleAmp;

    b.x += b.vx + perpX * wobble;
    b.y += b.vy + perpY * wobble;

    if (b.x < 0)                       { b.x = 0;           b.vx =  Math.abs(b.vx); }
    if (b.x + b.size > vw)             { b.x = vw - b.size; b.vx = -Math.abs(b.vx); }
    if (b.y < CONFIG.HEADER_CLEARANCE) { b.y = CONFIG.HEADER_CLEARANCE; b.vy = Math.abs(b.vy); }
    if (b.y + b.size > vh)             { b.y = vh - b.size; b.vy = -Math.abs(b.vy); }

    b.el.style.left = `${b.x}px`;
    b.el.style.top  = `${b.y}px`;
  }

  rafId = requestAnimationFrame(physicsLoop);
}

/* == Click: pop → modal → respawn ============================ */
function onBubbleClick(physics) {
  if (physics.popping) return;
  physics.popping            = true;
  physics.el.style.transform = 'scale(1)';

  setTimeout(() => {
    physics.el.classList.add('popping');
    spawnRipple(physics);

    function onPopEnd(e) {
      if (e.animationName !== 'bubblePop') return;
      physics.el.removeEventListener('animationend', onPopEnd);
      physics.el.remove();
      const idx = activeBubbles.indexOf(physics);
      if (idx !== -1) activeBubbles.splice(idx, 1);
      showModal(physics.photo);
      setTimeout(() => spawnBubble(0), CONFIG.RESPAWN_DELAY_MS);
    }

    physics.el.addEventListener('animationend', onPopEnd);
  }, 40);

  if (!musicStarted) attemptAutoplay();
}

/* == Ripple =================================================== */
function spawnRipple(physics) {
  const r = document.createElement('div');
  r.className = 'bubble-ripple';
  Object.assign(r.style, {
    width: `${physics.size}px`, height: `${physics.size}px`,
    left: `${physics.x}px`, top: `${physics.y}px`,
    position: 'fixed', zIndex: '4',
    borderColor: 'rgba(252, 98, 111, 0.6)',
  });
  document.body.appendChild(r);
  setTimeout(() => r.remove(), CONFIG.RIPPLE_CLEANUP_MS);
}

/* == Modal ==================================================== */
function showModal(photo) {
  modalShimmer.style.display = 'block';
  modalPhoto.style.opacity   = '0';
  modalCaption.textContent   = photo.description || photo.name || '';
  modalPhoto.alt             = photo.name || '';

  modalBackdrop.hidden = false;
  modalBackdrop.offsetHeight;
  modalClose.focus();

  if (photo.id !== '__placeholder__') {
    modalPhoto.src     = CONFIG.FULL(photo.id);
    modalPhoto.onload  = () => { modalShimmer.style.display = 'none'; modalPhoto.style.opacity = '1'; };
    modalPhoto.onerror = () => { modalPhoto.src = CONFIG.THUMB(photo.id); modalShimmer.style.display = 'none'; modalPhoto.style.opacity = '1'; };
  } else {
    modalShimmer.style.display = 'none';
    modalPhoto.src             = '';
    modalPhoto.style.opacity   = '1';
  }
}

function hideModal() {
  modalBackdrop.hidden = true;
  setTimeout(() => { modalPhoto.src = ''; }, 400);
}

modalClose.addEventListener('click', hideModal);
modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) hideModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modalBackdrop.hidden) hideModal(); });

/* == Back button ============================================== */
backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });

/* == Audio ==================================================== */
function attemptAutoplay() {
  musicStarted = true;
  bgMusic.volume = CONFIG.MUSIC_VOLUME;
  bgMusic.play().then(() => { musicPlaying = true; updateMusicUI(); }).catch(() => { musicPlaying = false; updateMusicUI(); });
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

/* == Stars ==================================================== */
function createStars() {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < CONFIG.STAR_COUNT; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const sz = rand(1, 3).toFixed(1);
    Object.assign(s.style, {
      width: `${sz}px`, height: `${sz}px`,
      left: `${rand(0, 100)}vw`, top: `${rand(0, 100)}vh`,
      '--dur': `${rand(2, 5).toFixed(1)}s`,
      '--delay': `${rand(0, 6).toFixed(1)}s`,
      '--brightness': `${rand(0.3, 0.9).toFixed(2)}`,
    });
    frag.appendChild(s);
  }
  starsLayer.appendChild(frag);
}

/* == Resize clamping ========================================== */
window.addEventListener('resize', () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  for (const b of activeBubbles) {
    b.x = Math.max(0, Math.min(b.x, vw - b.size));
    b.y = Math.max(CONFIG.HEADER_CLEARANCE, Math.min(b.y, vh - b.size));
  }
});

/* == Init ===================================================== */
function init() {
  /* Pick a random bubble count between min and max for this session */
  visibleCount = randInt(CONFIG.BUBBLE_COUNT_MIN, CONFIG.BUBBLE_COUNT_MAX);

  createStars();

  for (let i = 0; i < visibleCount; i++) spawnBubble(i);

  rafId = requestAnimationFrame(physicsLoop);

  bgMusic.volume = CONFIG.MUSIC_VOLUME;
  bgMusic.play().then(() => { musicPlaying = true; musicStarted = true; updateMusicUI(); }).catch(() => {});
}

fetchFolderPhotos();