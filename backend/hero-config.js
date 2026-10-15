/* Home-page hero picture settings (managed from the admin panel).
   Everything is whitelisted so the stored JSON can only ever hold known values. */
const HERO_FRAMES = ['spatial', 'liquid', 'glass', 'clay', 'neumorphic', 'skeuomorphic', 'brutalist', 'maximal', 'minimal'];
const HERO_OPTIONS = {
  shape: ['tall', 'square', 'wide'],
  fit: ['cover', 'contain'],
  position: ['center', 'top', 'bottom', 'left', 'right'],
  overlay: ['none', 'soft', 'strong'],
  link: ['none', 'services', 'partner', 'contact']
};
const DEFAULT_HERO_CONFIG = {
  enabled: false, imageUrl: '', frame: 'spatial', shape: 'tall', fit: 'cover', position: 'center',
  overlay: 'soft', title: '', subtitle: '', badge: '', link: 'none', buttonText: '',
  showChips: true, tilt: true
};

const SAFE_IMAGE_URL = /^(https:\/\/(res\.cloudinary\.com|firebasestorage\.googleapis\.com)\/[^\s"'<>]+|\/uploads\/[A-Za-z0-9._/-]+)$/;

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function pick(value, list, fallback) { return list.includes(value) ? value : fallback; }
function flag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 'on';
}
function parseStored(raw) {
  if (!raw) return { ...DEFAULT_HERO_CONFIG };
  try { return sanitizeHeroConfig(typeof raw === 'string' ? JSON.parse(raw) : raw, DEFAULT_HERO_CONFIG); }
  catch { return { ...DEFAULT_HERO_CONFIG }; }
}

/* body = new values (from the admin form), current = what is stored now.
   A field missing from body keeps its current value. */
function sanitizeHeroConfig(body, current) {
  const src = body && typeof body === 'object' ? body : {};
  const cur = { ...DEFAULT_HERO_CONFIG, ...(current || {}) };
  const has = (key) => Object.prototype.hasOwnProperty.call(src, key);
  const text = (key, max) => (has(key) ? cleanText(src[key], max) : cleanText(cur[key], max));
  const choice = (key, list) => pick(has(key) ? src[key] : cur[key], list, DEFAULT_HERO_CONFIG[key]);
  const imageUrl = has('imageUrl') && SAFE_IMAGE_URL.test(String(src.imageUrl)) ? String(src.imageUrl) : (has('imageUrl') && !src.imageUrl ? '' : (SAFE_IMAGE_URL.test(cur.imageUrl) ? cur.imageUrl : ''));
  return {
    enabled: flag(src.enabled, cur.enabled),
    imageUrl,
    frame: pick(has('frame') ? src.frame : cur.frame, HERO_FRAMES, DEFAULT_HERO_CONFIG.frame),
    shape: choice('shape', HERO_OPTIONS.shape),
    fit: choice('fit', HERO_OPTIONS.fit),
    position: choice('position', HERO_OPTIONS.position),
    overlay: choice('overlay', HERO_OPTIONS.overlay),
    title: text('title', 60),
    subtitle: text('subtitle', 120),
    badge: text('badge', 24),
    link: choice('link', HERO_OPTIONS.link),
    buttonText: text('buttonText', 24),
    showChips: flag(src.showChips, cur.showChips),
    tilt: flag(src.tilt, cur.tilt)
  };
}

module.exports = { HERO_FRAMES, HERO_OPTIONS, DEFAULT_HERO_CONFIG, SAFE_IMAGE_URL, sanitizeHeroConfig, parseStored };
