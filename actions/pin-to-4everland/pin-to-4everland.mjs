import { appendFileSync } from 'fs';

const ACCESS_TOKEN = process.env.FOUR_EVERLAND_ACCESS_TOKEN;
const PIN_NAME = process.env.PIN_NAME ?? 'unnamed-pin';
const CID = process.env.CID;

if (!ACCESS_TOKEN) {
  console.error('::error::FOUR_EVERLAND_ACCESS_TOKEN is not set.');
  process.exit(1);
}

if (!CID) {
  console.error('::error::CID is not set.');
  process.exit(1);
}

const endpointBase = 'https://api.4everland.dev';
const url = `${endpointBase}/pins`;

const body = {
  cid: CID,
  name: PIN_NAME,
};

const res = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  const text = await res.text().catch(() => '');
  console.error(`::error::4everland pin failed (${res.status}): ${text}`);
  process.exit(1);
}

console.log(`Pinned CID on 4everland: ${CID}`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `cid=${CID}\n`);
}

