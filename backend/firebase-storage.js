const crypto = require('crypto');

function buildFirebaseDownloadUrl(bucketName, objectPath, token) {
  const bucket = String(bucketName || '').trim();
  if (!bucket || !objectPath || !token) throw new Error('Firebase Storage bucket, object path, and token are required.');
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media&token=${encodeURIComponent(token)}`;
}

function createFirebaseStorage(bucket, uuid = crypto.randomUUID) {
  if (!bucket || typeof bucket.file !== 'function') throw new Error('Firebase Cloud Storage is not configured. Set FIREBASE_STORAGE_BUCKET and service-account credentials.');
  return {
    async upload(file, folder) {
      if (!file || !Buffer.isBuffer(file.buffer) || !file.mimetype) throw new Error('A valid in-memory upload is required.');
      const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' })[file.mimetype];
      if (!ext) throw new Error('Unsupported upload type.');
      const objectPath = `${String(folder).replace(/[^a-z0-9/_-]/gi, '')}/${Date.now()}-${uuid()}${ext}`;
      const token = uuid();
      const cloudFile = bucket.file(objectPath);
      await cloudFile.save(file.buffer, {
        resumable: false,
        metadata: {
          contentType: file.mimetype,
          cacheControl: 'public, max-age=3600',
          metadata: { firebaseStorageDownloadTokens: token }
        }
      });
      return { objectPath, url: buildFirebaseDownloadUrl(bucket.name, objectPath, token) };
    },
    async removeUrl(url) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== 'firebasestorage.googleapis.com') return false;
        const marker = '/o/';
        const index = parsed.pathname.indexOf(marker);
        if (index < 0) return false;
        const urlBucket = decodeURIComponent(parsed.pathname.slice(parsed.pathname.indexOf('/b/') + 3, index));
        if (urlBucket !== bucket.name) return false;
        const objectPath = decodeURIComponent(parsed.pathname.slice(index + marker.length));
        await bucket.file(objectPath).delete({ ignoreNotFound: true });
        return true;
      } catch {
        return false;
      }
    }
  };
}

module.exports = { buildFirebaseDownloadUrl, createFirebaseStorage };
