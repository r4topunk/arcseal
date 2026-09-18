#!/usr/bin/env bash
# Full transaction gasUsed (21k intrinsic + calldata + execution, refunds applied) of the PRD 4.5 calls, measured on a
# throwaway LOCAL anvil started with --hardfork prague, with MockUSDC standing in for Arc USDC. It also answers
# PRD 14 ("does anvil reproduce EIP-7623 calldata pricing?") by sending the same data-heavy transaction to a prague
# anvil and to a cancun anvil. Scenarios mirror test/unit/SealedDAO.gas.t.sol, so the forge "tx model" column can be
# checked against real receipts.
#
# Uses anvil's unlocked dev accounts (--unlocked/--from): no private key is read, generated or stored. It starts its
# own anvils on 127.0.0.1 and refuses anything that is not chain 31337. Never point it at a remote RPC.
#
#   bash contracts/script/gas-anvil.sh            (from the repo root; same command in fish)
#   env PORT=8561 bash contracts/script/gas-anvil.sh
#
# Output: a markdown table on stdout (progress on stderr). Takes a few minutes (about 650 sealed votes).
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8551}
PORT_CANCUN=$((PORT + 1))
RPC="http://127.0.0.1:${PORT}"
RPC_CANCUN="http://127.0.0.1:${PORT_CANCUN}"
PID=""
PID_CANCUN=""
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  [ -n "$PID_CANCUN" ] && kill "$PID_CANCUN" 2>/dev/null || true
}
trap cleanup EXIT

log() { printf '%s\n' "$*" >&2; }

start_anvil() { # port hardfork -> pid
  anvil --port "$1" --hardfork "$2" --accounts 300 --silent >/dev/null 2>&1 &
  echo $!
}

wait_local() { # rpc
  for _ in $(seq 1 300); do
    cast chain-id --rpc-url "$1" >/dev/null 2>&1 && break
    sleep 0.1
  done
  [ "$(cast chain-id --rpc-url "$1")" = "31337" ] || { log "refusing: $1 is not a local anvil"; exit 1; }
}

PID=$(start_anvil "$PORT" prague)
PID_CANCUN=$(start_anvil "$PORT_CANCUN" cancun)
wait_local "$RPC"
wait_local "$RPC_CANCUN"

# shellcheck disable=SC2207 # 300 dev accounts, no spaces
ACCTS=($(cast rpc eth_accounts --rpc-url "$RPC" | jq -r '.[]'))
DEPLOYER=${ACCTS[0]}
PAYEE=${ACCTS[257]}
NEWCOMER=${ACCTS[258]}
SINK=${ACCTS[299]}

to_dec() { printf '%d' "$1"; }

send() { # from, to, sig, args... -> "txhash gasUsed"
  local from=$1
  shift
  cast send --rpc-url "$RPC" --unlocked --from "$from" --json "$@" |
    jq -r 'if .status != "0x1" then error("transaction reverted") else "\(.transactionHash) \(.gasUsed)" end'
}

deploy() { # contract, constructor args... -> "address txhash"
  local contract=$1
  shift
  local args=()
  [ $# -gt 0 ] && args=(--constructor-args "$@")
  forge create "$contract" --rpc-url "$RPC" --unlocked --from "$DEPLOYER" --broadcast --json ${args[@]+"${args[@]}"} |
    jq -r '"\(.deployedTo) \(.transactionHash)"'
}

warp() {
  cast rpc evm_increaseTime "$1" --rpc-url "$RPC" >/dev/null
  cast rpc evm_mine --rpc-url "$RPC" >/dev/null
}

# deterministic pseudo-random bytes: hexbytes <label> <length>
hexbytes() {
  python3 -c 'import hashlib,sys
label, n = sys.argv[1].encode(), int(sys.argv[2])
out, i = b"", 0
while len(out) < n:
    out += hashlib.sha256(label + i.to_bytes(4, "big")).digest()
    i += 1
print("0x" + out[:n].hex())' "$1" "$2"
}

ROWS=""
row() { # label, txhash, note
  local input gas
  gas=$(to_dec "$(cast receipt "$2" gasUsed --rpc-url "$RPC")")
  input=$(cast tx "$2" input --rpc-url "$RPC")
  ROWS+=$(python3 -c 'import sys
label, gas, data, note = sys.argv[1], int(sys.argv[2]), bytes.fromhex(sys.argv[3][2:]), sys.argv[4]
zeros = data.count(0)
nonzero = len(data) - zeros
tokens = zeros + 4 * nonzero
floor = 21000 + 10 * tokens
standard_calldata = 4 * zeros + 16 * nonzero
binds = "yes" if gas == floor else "no"
print(f"| {label} | {gas:,} | {len(data):,} | {standard_calldata:,} | {floor:,} | {binds} | {note} |")' \
    "$1" "$gas" "$input" "$3")
  ROWS+=$'\n'
  log "  $1: $gas"
}

propose() { # dao, proposer, kind, target, amount, flag -> id (reads proposalCount after)
  send "$2" "$1" "propose(uint8,address,uint256,bool,string,string,uint32)" "$3" "$4" "$5" "$6" "proposal" \
    "ipfs://proposal" 3600 >/dev/null
  cast call "$1" "proposalCount()(uint256)" --rpc-url "$RPC"
}

salt_of() { hexbytes "salt:$1:$2:$3" 32; } # dao, id, voter

vote() { # dao, id, voter, choice, ctLength -> txhash
  local salt commitment
  salt=$(salt_of "$1" "$2" "$3")
  commitment=$(cast call "$1" "hashVote(uint256,address,uint8,bytes32)(bytes32)" "$2" "$3" "$4" "$salt" --rpc-url "$RPC")
  send "$3" "$1" "vote(uint256,bytes32,bytes)" "$2" "$commitment" "$(hexbytes "ct:$1:$2:$3" "$5")" | cut -d' ' -f1
}

reveal() { # dao, id, revealer, "voter:choice ..." -> txhash
  local dao=$1 id=$2 from=$3 voters="" choices="" salts="" item voter choice
  for item in $4; do
    voter=${item%%:*}
    choice=${item##*:}
    voters+="${voter},"
    choices+="${choice},"
    salts+="$(salt_of "$dao" "$id" "$voter"),"
  done
  send "$from" "$dao" "revealBatch(uint256,address[],uint8[],bytes32[])" "$id" "[${voters%,}]" "[${choices%,}]" \
    "[${salts%,}]" | cut -d' ' -f1
}

fund() { # dao, amount
  send "$DEPLOYER" "$USDC" "mint(address,uint256)" "$DEPLOYER" "$2" >/dev/null
  send "$DEPLOYER" "$USDC" "transfer(address,uint256)" "$1" "$2" >/dev/null
}

log "deploying MockUSDC and the 3-member demo DAO (PRD 10.2 shape: quorum 50%, bounty 0.01 USDC)"
read -r USDC USDC_TX < <(deploy test/mocks/MockUSDC.sol:MockUSDC)
M1=${ACCTS[1]}
M2=${ACCTS[2]}
M3=${ACCTS[3]}
read -r DAO DAO_TX < <(deploy src/SealedDAO.sol:SealedDAO "$USDC" "[$M1,$M2,$M3]" 5000 10000)
fund "$DAO" 100000000
row "deploy MockUSDC" "$USDC_TX" "test double"
row "deploy SealedDAO (3 members)" "$DAO_TX" "constructor emits 3 MemberSet"

log "demo DAO: three proposals voted For, For, Against"
P_TRANSFER=$(propose "$DAO" "$M1" 0 "$PAYEE" 1000000 false)
P_PENDING=$(propose "$DAO" "$M1" 0 "$PAYEE" 2000000 false)
P_ADD=$(propose "$DAO" "$M1" 1 "$NEWCOMER" 0 true)
PROPOSE_TX=$(send "$M1" "$DAO" "propose(uint8,address,uint256,bool,string,string,uint32)" 0 "$PAYEE" 1000000 false \
  "pay 1 US" "ipfs://proposal" 600 | cut -d' ' -f1)
row "propose TransferUSDC" "$PROPOSE_TX" "8-byte description, 15-byte URI"
VOTE455=$(vote "$DAO" "$P_TRANSFER" "$M1" 1 455)
VOTE423=$(vote "$DAO" "$P_TRANSFER" "$M2" 1 423)
vote "$DAO" "$P_TRANSFER" "$M3" 2 423 >/dev/null
row "vote (455-byte ciphertext)" "$VOTE455" "PRD 4.5 target size"
row "vote (423-byte ciphertext)" "$VOTE423" "what the SDK sends (64-byte plaintext)"
for p in "$P_PENDING" "$P_ADD"; do
  vote "$DAO" "$p" "$M1" 1 423 >/dev/null
  vote "$DAO" "$p" "$M2" 1 423 >/dev/null
  vote "$DAO" "$p" "$M3" 2 423 >/dev/null
done

# At least 128 of the 256 members seal (the 50% quorum): below quorum SealedDAO credits no bounty (audit F1), and the
# bounty credit is part of the worst case measured here. Only the first n sealed votes are revealed.
log "revealBatch sizes: one 256-member DAO per size, quorum met, fresh revealer, nothing reserved yet"
SIZES="1 10 50 256"
BATCH_DAOS=""
MEMBERS=$(printf '%s,' "${ACCTS[@]:1:256}")
MEMBERS="[${MEMBERS%,}]"
for n in $SIZES; do
  read -r d _ < <(deploy src/SealedDAO.sol:SealedDAO "$USDC" "$MEMBERS" 5000 10000)
  fund "$d" 100000000
  id=$(propose "$d" "$M1" 0 "$PAYEE" 1000000 false)
  items=""
  sealers=$((n > 128 ? n : 128))
  for ((i = 0; i < sealers; i++)); do
    voter=${ACCTS[$((i + 1))]}
    choice=$(((i + 1) % 3))
    vote "$d" "$id" "$voter" "$choice" 423 >/dev/null
    if ((i < n)); then items+="$voter:$choice "; fi
  done
  BATCH_DAOS+="$n:$d:$id:$items;"
  log "  sealed $sealers votes on $d, $n to reveal"
done

warp 3603
log "reveal window open"
R0=${ACCTS[259]}
REVEAL3=$(reveal "$DAO" "$P_TRANSFER" "$R0" "$M1:1 $M2:1 $M3:2")
row "revealBatch 3 items (demo)" "$REVEAL3" "first bounty in the DAO: claimable and totalClaimable 0 -> non-zero"
reveal "$DAO" "$P_PENDING" "$R0" "$M1:1 $M2:1 $M3:2" >/dev/null
reveal "$DAO" "$P_ADD" "$R0" "$M1:1 $M2:1 $M3:2" >/dev/null
k=0
IFS=';'
for entry in $BATCH_DAOS; do
  [ -z "$entry" ] && continue
  n=${entry%%:*}
  rest=${entry#*:}
  d=${rest%%:*}
  rest=${rest#*:}
  id=${rest%%:*}
  items=${rest#*:}
  IFS=' '
  tx=$(reveal "$d" "$id" "${ACCTS[$((260 + k))]}" "$items")
  IFS=';'
  gas=$(to_dec "$(cast receipt "$tx" gasUsed --rpc-url "$RPC")")
  row "revealBatch $n item(s)" "$tx" "fresh revealer; $((gas / n)) gas per item"
  k=$((k + 1))
done
IFS=$' \t\n'

warp 86403
log "reveal window closed"
FIN=$(send "$R0" "$DAO" "finalize(uint256)" "$P_TRANSFER" | cut -d' ' -f1)
row "finalize" "$FIN" "demo tally (For, For, Against)"
send "$R0" "$DAO" "finalize(uint256)" "$P_PENDING" >/dev/null
send "$R0" "$DAO" "finalize(uint256)" "$P_ADD" >/dev/null
EXEC1=$(send "$R0" "$DAO" "execute(uint256)" "$P_TRANSFER" | cut -d' ' -f1)
EXEC2=$(send "$R0" "$DAO" "execute(uint256)" "$P_PENDING" | cut -d' ' -f1)
EXEC3=$(send "$R0" "$DAO" "execute(uint256)" "$P_ADD" | cut -d' ' -f1)
row "execute TransferUSDC (fresh recipient)" "$EXEC1" "claimable[target] 0 -> non-zero"
row "execute TransferUSDC (pending claim)" "$EXEC2" "claimable[target] already non-zero"
row "execute SetMember (add)" "$EXEC3" "isMember 0 -> 1, memberCount 3 -> 4"
# on Arc the claimer pays gas in USDC, so it already holds a USDC balance
send "$DEPLOYER" "$USDC" "mint(address,uint256)" "$PAYEE" 1000000 >/dev/null
CLAIM=$(send "$PAYEE" "$DAO" "claim()" | cut -d' ' -f1)
row "claim" "$CLAIM" "3 USDC to a holder of USDC"

log "EIP-7623 probe: 1,000 non-zero calldata bytes to an EOA on prague and on cancun"
DATA=$(python3 -c 'print("0x" + "11" * 1000)')
PRAGUE_TX=$(send "$DEPLOYER" "$SINK" "$DATA" | cut -d' ' -f1)
row "EIP-7623 probe (prague)" "$PRAGUE_TX" "standard 37,000 vs floor 61,000"
CANCUN_GAS=$(cast send --rpc-url "$RPC_CANCUN" --unlocked --from "$DEPLOYER" --json "$SINK" "$DATA" | jq -r '.gasUsed')
log "  EIP-7623 probe (cancun): $(to_dec "$CANCUN_GAS")"

echo "| Call (local anvil --hardfork prague, MockUSDC) | gasUsed | calldata bytes | calldata gas (4/16) | EIP-7623 floor | floor binds | notes |"
echo "|---|---:|---:|---:|---:|---|---|"
printf '%s' "$ROWS"
echo
echo "EIP-7623 probe on cancun (same transaction): gasUsed $(to_dec "$CANCUN_GAS")"
echo "anvil: $(anvil --version | head -1)"
