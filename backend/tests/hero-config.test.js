const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_HERO_CONFIG, sanitizeHeroConfig, parseStored } = require('../hero-config');

test('defaults are off so the existing hero artwork stays until the admin enables a picture', () => {
  assert.equal(DEFAULT_HERO_CONFIG.enabled, false);
  assert.equal(parseStored(null).enabled, false);
  assert.equal(parseStored('not json').imageUrl, '');
});

test('valid admin form values are accepted', () => {
  const out = sanitizeHeroConfig({
    enabled: 'true', imageUrl: 'https://res.cloudinary.com/demo/image/upload/v1/site/hero.jpg', frame: 'clay',
    shape: 'square', fit: 'contain', position: 'top', overlay: 'strong', title: 'Summer AC offer',
    subtitle: 'Gas refill + service', badge: 'NEW', link: 'services', buttonText: 'Book now', showChips: 'false', tilt: '0'
  }, DEFAULT_HERO_CONFIG);
  assert.equal(out.enabled, true);
  assert.equal(out.frame, 'clay');
  assert.equal(out.shape, 'square');
  assert.equal(out.link, 'services');
  assert.equal(out.showChips, false);
  assert.equal(out.tilt, false);
  assert.equal(out.title, 'Summer AC offer');
});

test('unknown frames, links and options fall back to safe defaults', () => {
  const out = sanitizeHeroConfig({ frame: '<script>', link: 'javascript:alert(1)', shape: 'huge', fit: 'x', overlay: 'y', position: 'z' }, DEFAULT_HERO_CONFIG);
  assert.equal(out.frame, 'spatial');
  assert.equal(out.link, 'none');
  assert.equal(out.shape, 'tall');
  assert.equal(out.fit, 'cover');
  assert.equal(out.overlay, 'soft');
  assert.equal(out.position, 'center');
});

test('image URLs must come from Cloudinary, Firebase Storage or /uploads', () => {
  assert.equal(sanitizeHeroConfig({ imageUrl: 'https://evil.example/x.jpg' }, DEFAULT_HERO_CONFIG).imageUrl, '');
  assert.equal(sanitizeHeroConfig({ imageUrl: 'javascript:alert(1)' }, DEFAULT_HERO_CONFIG).imageUrl, '');
  assert.equal(sanitizeHeroConfig({ imageUrl: '/uploads/abc-1.png' }, DEFAULT_HERO_CONFIG).imageUrl, '/uploads/abc-1.png');
});

test('missing fields keep the stored value and an empty imageUrl removes the picture', () => {
  const stored = sanitizeHeroConfig({ enabled: true, imageUrl: '/uploads/a.jpg', frame: 'glass', title: 'Hello' }, DEFAULT_HERO_CONFIG);
  const kept = sanitizeHeroConfig({ subtitle: 'Sub' }, stored);
  assert.equal(kept.imageUrl, '/uploads/a.jpg');
  assert.equal(kept.frame, 'glass');
  assert.equal(kept.title, 'Hello');
  assert.equal(kept.subtitle, 'Sub');
  assert.equal(sanitizeHeroConfig({ imageUrl: '' }, stored).imageUrl, '');
});

test('text is trimmed, stripped of control characters and length limited', () => {
  const out = sanitizeHeroConfig({ title: '  a\u0000b\n' + 'x'.repeat(200) }, DEFAULT_HERO_CONFIG);
  assert.ok(out.title.length <= 60);
  assert.ok(!/[\u0000-\u001f]/.test(out.title));
});
