#!/usr/bin/env bash
# Propose a coworker node address as validator on all company nodes, then nudge with 2 txs.
set -euo pipefail

ADDRESS="${1:-}"
RPC_URLS="${RPC_URLS:-http://127.0.0.1:8545 http://127.0.0.1:8546 http://127.0.0.1:8547 http://127.0.0.1:8548}"
DEPLOYER_KEY="${DEPLOYER_PRIVATE_KEY:-}"

if [[ -z "$ADDRESS" ]]; then
  echo "Usage: $0 0xValidatorAddress" >&2
  exit 1
fi

vote_payload=$(cat <<EOF
{"jsonrpc":"2.0","method":"qbft_proposeValidatorVote","params":["$ADDRESS", true],"id":1}
EOF
)

for rpc in $RPC_URLS; do
  echo "Voting via $rpc ..."
  curl -s -X POST -H "Content-Type: application/json" --data "$vote_payload" "$rpc" || true
  echo
done

# Two dummy zero-gas txs so votes land without waiting for emptyblockperiod
if [[ -n "$DEPLOYER_KEY" ]]; then
  echo "Sending 2 zero-gas nudge transactions..."
  node "$(dirname "$0")/nudge-blocks.mjs" "$RPC_URLS" "$DEPLOYER_KEY"
else
  echo "Set DEPLOYER_PRIVATE_KEY to auto-send nudge txs, or send any 2 txs manually."
fi

echo "Done. Confirm with qbft_getValidatorsByBlockNumber."
