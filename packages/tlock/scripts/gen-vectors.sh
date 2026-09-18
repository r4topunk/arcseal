#!/bin/sh
# Regenerates the committed cross-implementation vectors in test/vectors/ (PRD 5.1, 8.2).
# Needs network (drand HTTP API, once) and Go tle v1.2.0. The tests never run this and never touch the network.
#
#   go install github.com/drand/tlock/cmd/tle@v1.2.0
#   pnpm --filter @arcseal/tlock vectors:gen
#
# Steps:
#   1. build dist/ (the lib side encrypts with the built package, like a consumer would)
#   2. fetch quicknet chain info and the beacons of the fixed rounds (api.drand.sh, then api2.drand.sh, then
#      drand.cloudflare.com), BLS-verify each beacon against the pinned key, write the plaintexts
#   3. tle -> lib: `tle -e -f -r <round>` (binary, not armored) for every (round, plaintext) pair
#   4. lib -> tle: encrypt every pair with @arcseal/tlock, then `tle -d` it (tle fetches the beacon itself)
#   5. write chain-info.json, beacons.json, tle-to-lib.json and lib-to-tle.json
set -eu

cd "$(dirname "$0")/.."
TLE="${TLE:-$(go env GOPATH)/bin/tle}"
if ! "$TLE" --help 2>&1 | head -n 1 | grep -q 'tlock v1.2.0'; then
  echo "gen-vectors: need tle v1.2.0 at $TLE (go install github.com/drand/tlock/cmd/tle@v1.2.0)" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

pnpm build >/dev/null
node scripts/gen-vectors.mjs prepare "$WORK"

while read -r name round; do
  "$TLE" -e -f -r "$round" -o "$WORK/$name.tle.age" "$WORK/$name.plain"
done < "$WORK/pairs.txt"

node scripts/gen-vectors.mjs encrypt "$WORK"

while read -r name round; do
  "$TLE" -d -o "$WORK/$name.lib.tle-decrypted" "$WORK/$name.lib.age"
done < "$WORK/pairs.txt"

node scripts/gen-vectors.mjs write "$WORK"
echo "gen-vectors: wrote test/vectors/{chain-info,beacons,tle-to-lib,lib-to-tle}.json"
