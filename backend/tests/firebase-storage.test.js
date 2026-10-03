const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFirebaseDownloadUrl, createFirebaseStorage } = require('../firebase-storage');

test('Firebase download URL encodes bucket, path, and token', () => {
  assert.equal(
    buildFirebaseDownloadUrl('home-tech.firebasestorage.app', 'gallery/item one.jpg', 'token+123'),
    'https://firebasestorage.googleapis.com/v0/b/home-tech.firebasestorage.app/o/gallery%2Fitem%20one.jpg?alt=media&token=token%2B123'
  );
});

test('Firebase uploader stores bytes and sets a download token', async () => {
  let saved;
  const bucket = { name: 'home-tech.firebasestorage.app', file: path => ({
    save: async (buffer, options) => { saved = { path, buffer, options }; }
  }) };
  let id = 0;
  const storage = createFirebaseStorage(bucket, () => `uuid-${++id}`);
  const file = { buffer: Buffer.from('image-bytes'), mimetype: 'image/png' };
  const result = await storage.upload(file, 'service-images');
  assert.equal(saved.buffer.toString(), 'image-bytes');
  assert.match(saved.path, /^service-images\/\d+-uuid-1\.png$/);
  assert.equal(saved.options.metadata.metadata.firebaseStorageDownloadTokens, 'uuid-2');
  assert.match(result.url, /token=uuid-2$/);
});

test('Firebase uploader rejects unsupported media and missing bucket', async () => {
  const storage = createFirebaseStorage({ name: 'bucket', file: () => ({ save: async () => {} }) });
  await assert.rejects(storage.upload({ buffer: Buffer.from('x'), mimetype: 'application/pdf' }, 'docs'), /Unsupported upload type/);
  assert.throws(() => createFirebaseStorage(null), /not configured/);
});

test('Firebase object deletion validates bucket and decodes object path', async () => {
  let deleted;
  const bucket = { name: 'home-tech.firebasestorage.app', file: path => ({ delete: async () => { deleted = path; } }) };
  const storage = createFirebaseStorage(bucket);
  assert.equal(await storage.removeUrl('https://firebasestorage.googleapis.com/v0/b/home-tech.firebasestorage.app/o/gallery%2Fclip.mp4?alt=media&token=t'), true);
  assert.equal(deleted, 'gallery/clip.mp4');
  assert.equal(await storage.removeUrl('https://example.com/file'), false);
});
