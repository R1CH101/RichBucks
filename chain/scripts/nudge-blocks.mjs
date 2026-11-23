#!/usr/bin/env node
/**
 * Send 2 tiny self-transfers at gasPrice 0 to force QBFT blocks (validator vote finalization).
 */
import { ethers } from "ethers";

const rpcList = (process.argv[2] || "http://127.0.0.1:8545").split(/\s+/).filter(Boolean);
const key = process.argv[3] || process.env.DEPLOYER_PRIVATE_KEY;
if (!key) {
  console.error("DEPLOYER_PRIVATE_KEY required");
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(rpcList[0]);
const wallet = new ethers.Wallet(key.startsWith("0x") ? key : `0x${key}`, provider);

for (let i = 0; i < 2; i++) {
  const tx = await wallet.sendTransaction({
    to: wallet.address,
    value: 0n,
    gasLimit: 21000n,
    gasPrice: 0n,
  });
  console.log(`nudge ${i + 1}: ${tx.hash}`);
  await tx.wait();
}
