const crypto = require('crypto');

function getCloudinaryConfig(environment = process.env) {
  const cloudName = String(environment.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(environment.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(environment.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

function signParameters(parameters, apiSecret) {
  const canonical = Object.keys(parameters).sort().map((key) => `${key}=${parameters[key]}`).join('&');
  return crypto.createHash('sha1').update(canonical + apiSecret).digest('hex');
}

function getPublicIdFromUrl(url, cloudName) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.hostname !== 'res.cloudinary.com') return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments[0] !== cloudName) return null;
  const uploadIndex = segments.indexOf('upload');
  if (uploadIndex < 2 || !['image', 'video'].includes(segments[uploadIndex - 1])) return null;
  let assetSegments = segments.slice(uploadIndex + 1);
  const versionIndex = assetSegments.findIndex((part) => /^v\d+$/.test(part));
  if (versionIndex >= 0) assetSegments = assetSegments.slice(versionIndex + 1);
  if (!assetSegments.length) return null;
  const last = assetSegments.length - 1;
  assetSegments[last] = assetSegments[last].replace(/\.[^.]+$/, '');
  const publicId = assetSegments.join('/');
  return publicId || null;
}

function createCloudinaryStorage(config) {
  if (!config || !config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.');
  }
  return {
    async upload(file, folder) {
      if (!file || !Buffer.isBuffer(file.buffer) || !file.mimetype) throw new Error('A valid in-memory upload is required.');
      const isVideo = file.mimetype === 'video/mp4' || file.mimetype === 'video/webm';
      const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
      if (!isImage && !isVideo) throw new Error('Unsupported upload type.');

      const resourceType = isVideo ? 'video' : 'image';
      const timestamp = Math.floor(Date.now() / 1000);
      const uploadFolder = String(folder || 'hometech').replace(/[^a-z0-9/_-]/gi, '');
      const form = new FormData();
      form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname || 'upload');
      form.append('api_key', config.apiKey);
      form.append('timestamp', String(timestamp));
      form.append('folder', uploadFolder);
      form.append('signature', signParameters({ folder: uploadFolder, timestamp }, config.apiSecret));

      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/upload`, {
        method: 'POST',
        body: form
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.secure_url || !result.public_id) {
        throw new Error(result.error?.message || `Cloudinary upload failed (HTTP ${response.status}).`);
      }
      return { objectPath: result.public_id, url: result.secure_url };
    },
    async removeUrl(url) {
      const publicId = getPublicIdFromUrl(url, config.cloudName);
      if (!publicId) return false;
      const resourceType = new URL(url).pathname.split('/').filter(Boolean)[1];
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signParameters({ public_id: publicId, timestamp }, config.apiSecret);
      const form = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), api_key: config.apiKey, signature });
      const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/destroy`, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      return response.ok && ['ok', 'not found'].includes(String(result.result || '').toLowerCase());
    }
  };
}

module.exports = { getCloudinaryConfig, signParameters, getPublicIdFromUrl, createCloudinaryStorage };
