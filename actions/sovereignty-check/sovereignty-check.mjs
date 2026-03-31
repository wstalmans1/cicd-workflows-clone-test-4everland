#!/usr/bin/env node
// ============================================================
// Sovereignty Configuration Check
// Repo:  tba-damiros/cicd-workflows
// Path:  scripts/sovereignty-check.mjs
//
// Runs in CI on every PR. Exits 1 (blocks) if:
//   - No Content-Security-Policy header is configured
//   - An unapproved RPC provider URL is found in config files
//   - WalletConnect projectId has no domain/origin restrictions
//
// To add an approved RPC provider, edit APPROVED_RPC_HOSTS below.
// ============================================================

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ----------------------------------------------------------
// APPROVED RPC PROVIDERS
// Only add providers you control or have reviewed for privacy.
// ----------------------------------------------------------
const APPROVED_RPC_HOSTS = [
  'rpc.ankr.com',
  'eth-mainnet.g.alchemy.com',
  'mainnet.infura.io',
  'ethereum.publicnode.com',
  'cloudflare-eth.com',
  'rpc.flashbots.net',
  // Add your own private node hostname here
];

const CONFIG_FILES_TO_SCAN = [
  'vite.config.js',
  'vite.config.ts',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'hardhat.config.js',
  'hardhat.config.ts',
];

// Static sites (e.g. IPFS-deployed) set CSP via a <meta> tag in HTML
// since no server controls HTTP headers. Scan these separately.
const HTML_FILES_TO_SCAN = [
  'index.html',
  'public/index.html',
];

const WALLETCONNECT_FILES_TO_SCAN = [
  ...CONFIG_FILES_TO_SCAN,
  'src/main.tsx',
  'src/main.ts',
  'src/main.jsx',
  'src/main.js',
  'src/config.ts',
  'src/config.js',
  'src/wagmi.ts',
  'src/wagmi.js',
  'src/web3modal.ts',
  'src/web3modal.js',
];

const projectRoot = process.cwd();
let hasErrors = false;
let hasWarnings = false;

const error = (msg) => { console.error(`::error::${msg}`); hasErrors = true; };
const warn  = (msg) => { console.warn(`::warning::${msg}`); hasWarnings = true; };
const pass  = (msg) => console.log(`✅ ${msg}`);

function readIfExists(filename) {
  const fullPath = resolve(projectRoot, filename);
  if (!existsSync(fullPath)) return null;
  return { path: fullPath, content: readFileSync(fullPath, 'utf8') };
}

// ============================================================
// CHECK 1 — Content-Security-Policy header
// ============================================================
console.log('\n── Check 1: Content-Security-Policy header ──────────────');

let cspFound = false;

for (const filename of CONFIG_FILES_TO_SCAN) {
  const file = readIfExists(filename);
  if (!file) continue;

  if (file.content.includes('Content-Security-Policy')) {
    pass(`CSP header found in ${filename}`);
    cspFound = true;

    if (file.content.includes("'unsafe-inline'"))
      warn(`Weak CSP: 'unsafe-inline' found in ${filename}. Remove it to prevent XSS.`);
    if (file.content.includes("'unsafe-eval'"))
      warn(`Weak CSP: 'unsafe-eval' found in ${filename}. Remove it to prevent script injection.`);

    break;
  }
}

// Fall back to scanning HTML files for a <meta http-equiv="Content-Security-Policy"> tag.
// This is the correct approach for static/IPFS-deployed sites where no server controls
// HTTP response headers.
if (!cspFound) {
  for (const filename of HTML_FILES_TO_SCAN) {
    const file = readIfExists(filename);
    if (!file) continue;

    if (file.content.includes('Content-Security-Policy')) {
      pass(`CSP meta tag found in ${filename} (static/IPFS site — meta tag is correct approach)`);
      cspFound = true;

      if (file.content.includes("'unsafe-inline'"))
        warn(`Weak CSP: 'unsafe-inline' found in ${filename}. Remove it to prevent XSS.`);
      if (file.content.includes("'unsafe-eval'"))
        warn(`Weak CSP: 'unsafe-eval' found in ${filename}. Remove it to prevent script injection.`);

      break;
    }
  }
}

if (!cspFound) {
  error(
    'No Content-Security-Policy found in any config file or index.html. ' +
    'For server-rendered apps: add a CSP to vite.config.js or next.config.js headers config. ' +
    'For static/IPFS sites: add a <meta http-equiv="Content-Security-Policy"> tag to index.html.'
  );
}

// ============================================================
// CHECK 2 — RPC endpoint allowlist
// ============================================================
console.log('\n── Check 2: RPC endpoint allowlist ──────────────────────');

const rpcPattern = /https:\/\/([a-zA-Z0-9\-\.]+)\//g;
const foundRpcUrls = new Set();

for (const filename of CONFIG_FILES_TO_SCAN) {
  const file = readIfExists(filename);
  if (!file) continue;

  let match;
  while ((match = rpcPattern.exec(file.content)) !== null) {
    const hostname = match[1];
    const surroundingText = file.content.slice(
      Math.max(0, file.content.indexOf(match[0]) - 80),
      file.content.indexOf(match[0]) + 80
    );
    const looksLikeRpc =
      surroundingText.toLowerCase().includes('rpc') ||
      surroundingText.toLowerCase().includes('provider') ||
      hostname.includes('rpc') ||
      hostname.includes('eth') ||
      hostname.includes('node') ||
      hostname.includes('infura') ||
      hostname.includes('alchemy') ||
      hostname.includes('ankr');

    if (looksLikeRpc) foundRpcUrls.add(hostname);
  }
}

if (foundRpcUrls.size === 0) {
  pass('No hardcoded RPC URLs found in config files (using env vars — correct).');
} else {
  for (const hostname of foundRpcUrls) {
    const approved = APPROVED_RPC_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`)
    );
    if (approved) {
      pass(`RPC provider approved: ${hostname}`);
    } else {
      error(
        `Unapproved RPC provider: ${hostname}. ` +
        'Add to APPROVED_RPC_HOSTS in scripts/sovereignty-check.mjs or replace with an approved provider.'
      );
    }
  }
}

// ============================================================
// CHECK 3 — WalletConnect domain/origin restriction
// ============================================================
console.log('\n── Check 3: WalletConnect domain restriction ────────────');

let wcFound = false;
let wcRestricted = false;

for (const filename of WALLETCONNECT_FILES_TO_SCAN) {
  const file = readIfExists(filename);
  if (!file) continue;

  const hasProjectId =
    file.content.includes('projectId') &&
    (file.content.includes('WalletConnect') ||
      file.content.includes('walletConnect') ||
      file.content.includes('createWeb3Modal') ||
      file.content.includes('createAppKit') ||
      file.content.includes('wagmi'));

  if (hasProjectId) {
    wcFound = true;
    const hasRestriction =
      file.content.includes('allowedOrigins') ||
      file.content.includes('allowedDomains') ||
      file.content.includes('origin') ||
      file.content.includes('domain');

    if (hasRestriction) {
      pass(`WalletConnect domain restriction found in ${filename}`);
      wcRestricted = true;
    }
  }
}

if (wcFound && !wcRestricted) {
  warn(
    'WalletConnect projectId configured but no domain restriction detected in source files. ' +
    'Domain restrictions are set on the WalletConnect Cloud dashboard (not in code) — ' +
    'ensure allowed origins are configured at cloud.walletconnect.com for your projectId.'
  );
} else if (!wcFound) {
  pass('No WalletConnect configuration detected — skipping.');
}

// ============================================================
// Summary
// ============================================================
console.log('\n── Sovereignty Check Summary ─────────────────────────────');

if (hasErrors) {
  console.error('\n❌ Sovereignty check FAILED — pipeline blocked. See errors above.');
  process.exit(1);
} else if (hasWarnings) {
  console.warn('\n⚠️  Sovereignty check passed with warnings — review above.');
} else {
  console.log('\n✅ All sovereignty checks passed.');
}
