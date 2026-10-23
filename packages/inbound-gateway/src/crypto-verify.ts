import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates Meta (WhatsApp / Instagram) X-Hub-Signature-256 header.
 * Enforces constant-time comparison to prevent timing attacks.
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    return false;
  }

  const signatureHex = signatureHeader.slice(prefix.length).trim();
  if (signatureHex.length !== 64) {
    return false;
  }

  try {
    const hmac = createHmac('sha256', appSecret);
    hmac.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody);
    const expectedHex = hmac.digest('hex');

    const signatureBuf = Buffer.from(signatureHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    if (signatureBuf.length !== expectedBuf.length) {
      return false;
    }

    return timingSafeEqual(signatureBuf, expectedBuf);
  } catch {
    return false;
  }
}

/**
 * Validates Bearer authorization token using constant-time comparison.
 */
export function verifyBearerToken(
  authHeader: string | undefined | null,
  expectedToken: string,
): boolean {
  if (!authHeader || !expectedToken) {
    return false;
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return false;
  }

  const token = parts[1];
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expectedToken);

  if (tokenBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(tokenBuf, expectedBuf);
}
