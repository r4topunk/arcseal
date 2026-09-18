#!/usr/bin/env node
// FFI helper for the Foundry test in contracts/test/ffi (PRD 8.1): prints hashVote(...) computed by the BUILT SDK,
// so SealedDAO.hashVote is compared with the exact code the app ships.
//
//   node packages/sdk/scripts/ffi-hash-vote.mjs <proposalId> <voter> <choice 0|1|2> <salt>
//   0x<64 hex digits>       (stdout, nothing else, no newline: vm.ffi decodes it as 32 bytes)
//
// proposalId: uint256 in decimal (or 0x hex). voter: 0x address. choice: 0 abstain, 1 for, 2 against.
// salt: 0x + 64 hex digits. Errors go to stderr with exit code 1 and an empty stdout.
// Needs dist/: run `pnpm --filter @arcseal/sdk build` first (the root `pnpm test` does).

const USAGE = 'usage: ffi-hash-vote.mjs <proposalId> <voter> <choice 0|1|2> <salt>';

function fail(message) {
  process.stderr.write(`ffi-hash-vote: ${message}\n`);
  // exitCode instead of process.exit(): stdio pipes are asynchronous on macOS and exit() can cut the output.
  process.exitCode = 1;
}

async function main(args) {
  if (args.length !== 4) return fail(USAGE);
  const [proposalId, voter, choice, salt] = args;
  if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(proposalId)) {
    return fail(`proposalId must be a decimal or 0x-hex integer, got ${proposalId}`);
  }
  if (!/^[0-2]$/.test(choice)) {
    return fail(`choice must be 0 (abstain), 1 (for) or 2 (against), got ${choice}`);
  }

  let sdk;
  try {
    sdk = await import('../dist/index.js');
  } catch (error) {
    return fail(`cannot load the built SDK (${error.message}); run \`pnpm --filter @arcseal/sdk build\``);
  }
  try {
    const commitment = sdk.hashVote({
      proposalId: BigInt(proposalId),
      voter,
      choice: sdk.choiceFromIndex(Number(choice)),
      salt,
    });
    process.stdout.write(commitment);
  } catch (error) {
    fail(error.message);
  }
}

await main(process.argv.slice(2));
