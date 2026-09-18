// End-to-end check of the static app against a throwaway local anvil, in headless Chromium (Phase 3 gate: click
// through the static export). Local chain only: an injected EIP-1193 provider forwards to anvil's unlocked dev
// accounts, so no key is ever handled. Offline: drand round 32,000,000 is served from the committed beacon.
//
// Flow: create a proposal from the form, three sealed votes (one with localStorage blocked, which must force the
// receipt download), "Reveal only mine" from the uploaded receipt, "Reveal votes" (decrypt in the browser, one
// revealBatch), finalize, execute, claim, fund, the non-member notice and the PT-BR toggle. Fails on any console error.
//
// Needs anvil (Foundry), contracts/out (pnpm contracts:build) and Chromium (pnpm exec playwright install chromium).
// It rebuilds apps/web/out for the local chain: run `pnpm --filter @arcseal/web build` afterwards for a normal export.
//   pnpm --filter @arcseal/web e2e:anvil
//   env SHOTS_DIR=/tmp/arcseal-shots pnpm --filter @arcseal/web e2e:anvil
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { serveStatic } from './static-server.mjs';

const WEB = fileURLToPath(new URL('..', import.meta.url));
const REPO = path.resolve(WEB, '../..');
const GENESIS = 1_692_803_367;
const roundTime = (r) => GENESIS + (r - 1) * 3;
// A round whose beacon is committed in packages/tlock/test/vectors/beacons.json, so the reveal needs no network.
const CLOSE_ROUND = 32_000_000;
const PROPOSE_AT = roundTime(CLOSE_ROUND) - 600;
const REVEAL_END = roundTime(CLOSE_ROUND + 28_800);
const SHOTS = process.env.SHOTS_DIR;

const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const port = await freePort();
const RPC = `http://127.0.0.1:${port}`;
// cancun + prune-history: the contracts need only cancun opcodes, and anvil then keeps no state cache on disk.
const anvil = spawn(
  'anvil',
  [
    '--port',
    String(port),
    '--silent',
    '--timestamp',
    String(PROPOSE_AT - 3_600),
    '--hardfork',
    'cancun',
    '--prune-history',
  ],
  { stdio: 'ignore' },
);
anvil.on('error', (e) => {
  console.error(`cannot start anvil (is Foundry installed?): ${e.message}`);
  process.exit(1);
});
process.on('exit', () => anvil.kill('SIGTERM'));

async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
for (let i = 0; ; i++) {
  try {
    await rpc('eth_chainId');
    break;
  } catch (e) {
    if (i > 150) throw e;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// ---------------------------------------------------------------------------------------------- deploy
const chain = {
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain, transport: http(RPC) });
const [A0, A1, A2, A3] = await rpc('eth_accounts');
const wallet = (account) => createWalletClient({ account, chain, transport: http(RPC) });
const artifact = (file, name) =>
  JSON.parse(readFileSync(path.join(REPO, 'contracts/out', file, `${name}.json`), 'utf8'));
const mockUsdc = artifact('MockUSDC.sol', 'MockUSDC');
const sealedDao = artifact('SealedDAO.sol', 'SealedDAO');
const mined = async (hash) => pub.waitForTransactionReceipt({ hash });
const usdcAbi = parseAbi([
  'function mint(address,uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

const USDC = (
  await mined(await wallet(A0).deployContract({ abi: mockUsdc.abi, bytecode: mockUsdc.bytecode.object }))
).contractAddress;
const daoReceipt = await mined(
  await wallet(A0).deployContract({
    abi: sealedDao.abi,
    bytecode: sealedDao.bytecode.object,
    args: [USDC, [A0, A1, A2], 5_000, 10_000n],
  }),
);
const DAO = daoReceipt.contractAddress;
for (const [to, amount] of [
  [DAO, 2_000_000n],
  [A0, 5_000_000n],
]) {
  await mined(
    await wallet(A0).writeContract({ address: USDC, abi: usdcAbi, functionName: 'mint', args: [to, amount] }),
  );
}
log('deployed MockUSDC', USDC, 'and SealedDAO', DAO, 'at block', daoReceipt.blockNumber.toString());

// ---------------------------------------------------------------------------------------------- build and serve
log('building the static export for chain 31337');
const build = spawnSync('pnpm', ['build'], {
  cwd: WEB,
  encoding: 'utf8',
  env: {
    ...process.env,
    NEXT_PUBLIC_CHAIN_ID: '31337',
    NEXT_PUBLIC_RPC_URL: RPC,
    NEXT_PUBLIC_DAO_ADDRESS: DAO,
    NEXT_PUBLIC_DAO_DEPLOY_BLOCK: daoReceipt.blockNumber.toString(),
    NEXT_PUBLIC_BASE_PATH: '',
  },
});
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}
const { server, url: SITE } = await serveStatic(path.join(WEB, 'out'));

// ---------------------------------------------------------------------------------------------- browser
const beacons = JSON.parse(readFileSync(path.join(REPO, 'packages/tlock/test/vectors/beacons.json'), 'utf8'));
const beacon = beacons.beacons.find((b) => b.round === CLOSE_ROUND);
const browser = await chromium.launch();
const consoleErrors = [];
const tmp = mkdtempSync(path.join(os.tmpdir(), 'arcseal-e2e-'));
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** A browser context whose injected wallet is `account` (null: no wallet). `blockStorage` makes localStorage throw. */
async function openAs(account, { blockStorage = false } = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.route(
    (u) => u.pathname.endsWith(`/public/${CLOSE_ROUND}`),
    (route) =>
      route.fulfill({
        json: { round: beacon.round, randomness: beacon.randomness, signature: beacon.signature },
      }),
  );
  await context.addInitScript(
    ({ account, rpcUrl, blockStorage }) => {
      if (blockStorage) {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('blocked', 'SecurityError');
          },
        });
      }
      if (!account) return;
      let id = 0;
      const call = async (method, params) => {
        const res = await fetch(rpcUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params ?? [] }),
        });
        const body = await res.json();
        if (body.error) throw Object.assign(new Error(body.error.message), body.error);
        return body.result;
      };
      window.ethereum = {
        request: async ({ method, params }) => {
          switch (method) {
            case 'eth_requestAccounts':
            case 'eth_accounts':
              return [account];
            case 'eth_chainId':
              return '0x7a69';
            case 'wallet_switchEthereumChain':
            case 'wallet_addEthereumChain':
              return null;
            case 'wallet_requestPermissions':
            case 'wallet_getPermissions':
              return [{ parentCapability: 'eth_accounts' }];
            case 'eth_sendTransaction':
              return call(method, [{ ...params[0], from: account }]);
            default:
              return call(method, params);
          }
        },
        on() {},
        removeListener() {},
      };
    },
    { account, rpcUrl: RPC, blockStorage },
  );
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${page.url()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${page.url()}: ${e.message}`));
  return page;
}

const see = (page, text, timeout = 20_000) =>
  page.getByText(text, { exact: false }).first().waitFor({ timeout });
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};
async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet' }).first().click();
  await page
    .getByText(/^0x[0-9a-fA-F]{4}…/)
    .first()
    .waitFor();
}
async function setChainTime(t) {
  await rpc('evm_setNextBlockTimestamp', [t]);
  await rpc('evm_mine');
}
async function step(name, fn) {
  await fn();
  log('ok:', name);
}

try {
  const anon = await openAs(null);
  await step('read-only list without a wallet', async () => {
    await anon.goto(`${SITE}/app/proposals/`);
    await see(anon, 'No proposals yet');
  });

  const m0 = await openAs(A0);
  await step('member creates a proposal from the form', async () => {
    await m0.goto(`${SITE}/app/new/`);
    await connect(m0);
    await m0.getByLabel('Recipient address').fill(A3);
    await m0.getByLabel('Amount (USDC)').fill('1');
    await m0.getByLabel('Description').fill('Pay 1 USDC to wallet C');
    await m0.getByLabel('10 minutes').check();
    await see(m0, 'est. network fee');
    await shot(m0, 'new-proposal');
    await rpc('evm_setNextBlockTimestamp', [PROPOSE_AT]);
    await m0.getByRole('button', { name: 'Create proposal' }).click();
    await see(m0, 'Proposal #1 created.');
  });

  await step('member 0 seals For; the receipt lands in localStorage', async () => {
    await m0.goto(`${SITE}/app/proposal/?id=1`);
    await see(m0, 'Secret only while voting');
    await see(m0, 'drand round 32,000,000');
    // Countdowns follow the chain clock (anvil runs in the past), so voting still reads as open.
    await m0.getByText('Voting closes', { exact: true }).first().waitFor();
    await m0.getByLabel('For', { exact: true }).check();
    await shot(m0, 'vote');
    await m0.getByRole('button', { name: 'Seal vote' }).click();
    await see(m0, 'Vote sealed. Keep your receipt.');
    const keys = await m0.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('arcseal:receipt:')),
    );
    if (keys.length !== 1) throw new Error(`expected one stored receipt, found ${keys.length}`);
  });

  const m1 = await openAs(A1);
  await step('member 1 seals For', async () => {
    await m1.goto(`${SITE}/app/proposal/?id=1`);
    await connect(m1);
    await m1.getByLabel('For', { exact: true }).check();
    await m1.getByRole('button', { name: 'Seal vote' }).click();
    await see(m1, 'Vote sealed. Keep your receipt.');
  });

  const m2 = await openAs(A2, { blockStorage: true });
  const receiptFile = path.join(tmp, 'receipt.json');
  await step('member 2 seals Against with storage blocked: the receipt download is forced', async () => {
    await m2.goto(`${SITE}/app/proposal/?id=1`);
    await connect(m2);
    await m2.getByLabel('Against', { exact: true }).check();
    const download = m2.waitForEvent('download');
    await m2.getByRole('button', { name: 'Seal vote' }).click();
    await (await download).saveAs(receiptFile);
    await see(m2, 'This browser blocked local storage');
    const r = JSON.parse(readFileSync(receiptFile, 'utf8'));
    if (r.choice !== 'against' || r.proposalId !== '1') throw new Error('unexpected forced receipt');
  });

  await step('no running tally while voting', async () => {
    await m1.reload();
    await see(m1, 'There is no running tally');
    await see(m1, 'This wallet already sealed a vote');
    await anon.goto(`${SITE}/app/proposals/`);
    await see(anon, 'Pay 1 USDC to wallet C');
    await shot(anon, 'list');
  });

  await setChainTime(roundTime(CLOSE_ROUND) + 1);
  await step('member 2 reveals only its own vote from the uploaded receipt (no drand)', async () => {
    await m2.reload();
    await see(m2, 'Reveal only mine');
    await connect(m2); // storage is blocked, so the connection is not remembered across reloads
    await m2.getByLabel('Or upload a receipt file (JSON)').setInputFiles(receiptFile);
    await m2.getByRole('button', { name: 'Reveal this vote' }).click();
    await see(m2, 'All reveals submitted.');
  });

  await step('member 1 decrypts every vote in the browser and sends one revealBatch', async () => {
    await m1.reload();
    await m1.getByRole('button', { name: 'Reveal votes' }).click();
    await see(m1, 'Decrypted: For');
    await see(m1, 'Already revealed');
    await see(m1, 'All reveals submitted.');
    await shot(m1, 'revealed');
    await m1.reload();
    await see(m1, '3 of 3 sealed votes revealed');
  });

  await setChainTime(REVEAL_END + 1);
  await step('finalize and execute', async () => {
    await m1.reload();
    await m1.getByRole('button', { name: 'Finalize' }).click();
    await see(m1, 'Passed. Executing credits 1.000000 USDC');
    await m1.getByRole('button', { name: 'Execute' }).click();
    await see(m1, 'Executed: 1.000000 USDC was credited');
    await see(m1, 'Reveal payment credited');
    await shot(m1, 'executed');
  });

  const m3 = await openAs(A3);
  await step('the payee claims 1 USDC', async () => {
    await m3.goto(`${SITE}/app/treasury/`);
    await connect(m3);
    await m3.getByRole('button', { name: 'Claim' }).click();
    await see(m3, 'Nothing to claim for this wallet.');
    const balance = await pub.readContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [A3],
    });
    if (balance !== 1_000_000n) throw new Error(`payee balance is ${balance}, expected 1000000`);
  });

  await step('member 0 funds the treasury with a plain USDC transfer', async () => {
    await m0.goto(`${SITE}/app/treasury/`);
    await m0.getByLabel('Amount (USDC)').fill('0.5');
    await m0.getByRole('button', { name: 'Send USDC to the treasury' }).click();
    await see(m0, 'confirmed');
    await shot(m0, 'treasury');
  });

  await step('a non-member sees why it cannot propose, in both languages', async () => {
    await m3.goto(`${SITE}/app/new/`);
    await see(m3, 'Only members can create proposals');
    await m3.getByRole('button', { name: 'PT-BR' }).click();
    await see(m3, 'Só membros podem criar propostas');
    await m3.goto(`${SITE}/docs/faq/`);
    await see(m3, 'Perguntas frequentes');
  });

  if (consoleErrors.length > 0) throw new Error(`${consoleErrors.length} console error(s)`);
  log('PASS: every step, zero console errors');
} catch (e) {
  console.error('[e2e] FAIL:', e.message);
  for (const c of consoleErrors) console.error('  console:', c);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
  anvil.kill('SIGTERM');
  rmSync(tmp, { recursive: true, force: true });
}
