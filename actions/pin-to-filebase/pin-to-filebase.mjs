import { appendFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import crypto from 'crypto';

const ACCESS_KEY = process.env.FILEBASE_ACCESS_KEY;
const SECRET_KEY = process.env.FILEBASE_SECRET_KEY;
const BUCKET = process.env.FILEBASE_BUCKET;
const REGION = process.env.FILEBASE_REGION || 'us-east-1';
const PIN_NAME = process.env.PIN_NAME ?? 'unnamed-pin';

if (!ACCESS_KEY || !SECRET_KEY || !BUCKET) {
  console.error('::error::FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY, and FILEBASE_BUCKET must be set.');
  process.exit(1);
}

const DIST_DIR = resolve(process.cwd(), 'dist');

function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    statSync(full).isDirectory()
      ? results.push(...collectFiles(full))
      : results.push(full);
  }
  return results;
}

function hashSHA256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function hmacSHA256(key, payload, encoding = 'hex') {
  return crypto.createHmac('sha256', key).update(payload).digest(encoding);
}

const endpoint = 'https://s3.filebase.com';
const service = 's3';

function buildSignedRequest(keyPath, bodyBuffer) {
  const method = 'PUT';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') + 'Z';
  const dateStamp = amzDate.substring(0, 8);

  const host = 's3.filebase.com';
  const canonicalUri = `/${BUCKET}/${keyPath}`;
  const canonicalQuerystring = '';

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${hashSHA256(bodyBuffer)}\n` +
    `x-amz-date:${amzDate}\n`;

  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const payloadHash = hashSHA256(bodyBuffer);
  const canonicalRequest =
    `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const algorithm = 'AWS4-HMAC-SHA256';
  const credentialScope = `${dateStamp}/${REGION}/${service}/aws4_request`;
  const stringToSign =
    `${algorithm}\n${amzDate}\n${credentialScope}\n${hashSHA256(canonicalRequest)}`;

  const kDate = hmacSHA256('AWS4' + SECRET_KEY, dateStamp, undefined);
  const kRegion = hmacSHA256(kDate, REGION, undefined);
  const kService = hmacSHA256(kRegion, service, undefined);
  const kSigning = hmacSHA256(kService, 'aws4_request', undefined);

  const signature = hmacSHA256(kSigning, stringToSign);

  const authorizationHeader =
    `${algorithm} Credential=${ACCESS_KEY}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${endpoint}${canonicalUri}`;

  const headers = {
    'Host': host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    'Content-Length': String(bodyBuffer.length),
    'Authorization': authorizationHeader,
  };

  return { url, headers, method };
}

// For simplicity, upload an index.html bundle as the primary object.
// A more advanced version could sync the full dist/ tree.
const indexPath = resolve(DIST_DIR, 'index.html');
let body;
try {
  body = readFileSync(indexPath);
} catch {
  console.error('::error::Could not read dist/index.html for Filebase upload.');
  process.exit(1);
}

const objectKey = `${PIN_NAME.replace(/\s+/g, '-').toLowerCase()}/index.html`;

const { url, headers, method } = buildSignedRequest(objectKey, body);

const res = await fetch(url, {
  method,
  headers,
  body,
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`::error::Filebase S3 upload failed (${res.status}): ${text}`);
  process.exit(1);
}

const cid = res.headers.get('x-amz-meta-cid');

if (!cid) {
  console.error('::warning::Filebase upload succeeded but no x-amz-meta-cid header was returned.');
} else {
  console.log(`Filebase S3 upload CID: ${cid}`);
}

if (process.env.GITHUB_OUTPUT && cid) {
  appendFileSync(process.env.GITHUB_OUTPUT, `cid=${cid}\n`);
}

