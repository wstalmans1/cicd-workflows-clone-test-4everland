import { readFileSync, readdirSync, statSync, appendFileSync } from 'fs';
import { resolve, relative } from 'path';

const PINATA_JWT = process.env.PINATA_JWT;
const PIN_NAME   = process.env.PIN_NAME ?? 'unnamed-pin';
const DIST_DIR   = resolve(process.cwd(), 'dist');

if (!PINATA_JWT) {
  console.error('::error::PINATA_JWT is not set.');
  process.exit(1);
}

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

const files = collectFiles(DIST_DIR);
const form  = new FormData();

for (const filePath of files) {
  const rel  = relative(DIST_DIR, filePath);
  const blob = new Blob([readFileSync(filePath)]);
  form.append('file', blob, `dist/${rel}`);
}

form.append('pinataMetadata', JSON.stringify({ name: PIN_NAME }));
form.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));

const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
  method:  'POST',
  headers: { Authorization: `Bearer ${PINATA_JWT}` },
  body:    form,
});

if (!res.ok) {
  console.error(`::error::Pinata ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const { IpfsHash } = await res.json();
console.log(`CID: ${IpfsHash}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `cid=${IpfsHash}\n`);
}