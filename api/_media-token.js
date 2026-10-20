import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Creates a public media handle without putting the Drive file id in the
 * browser response. The matching Cloudflare Worker decrypts this value with
 * the same MEDIA_TOKEN_SECRET binding.
 */
export function createMediaToken(payload) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const body = Buffer.from(JSON.stringify({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
  }), 'utf8');
  const encrypted = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, iv, tag, encrypted]
    .map(value => value.toString('base64url'))
    .join('.');
}

/**
 * Stable, opaque identity used only for client-side polling/deduplication.
 * The media URL itself remains an encrypted capability token; this value is
 * a one-way HMAC and never reveals the provider file id.
 */
export function createStableMediaId({ fileId, kind }) {
  return `m1_${createHmac('sha256', getKey())
    .update(`${kind}:${fileId}`, 'utf8')
    .digest('base64url')}`;
}

function getKey() {
  const secret = process.env.MEDIA_TOKEN_SECRET;
  if (!secret) throw new Error('Missing MEDIA_TOKEN_SECRET');

  if (/^[0-9a-f]{64}$/i.test(secret)) {
    return Buffer.from(secret, 'hex');
  }

  return createHash('sha256').update(secret, 'utf8').digest();
}
