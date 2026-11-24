import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config();

const rawPk = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
const pk = rawPk
  ? [rawPk.startsWith("0x") ? rawPk : `0x${rawPk}`]
  : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    richbucks: {
      url: process.env.RPC_URL || "http://127.0.0.1:8545",
      chainId: Number(process.env.CHAIN_ID || 88420),
      accounts: pk,
      // Private Besu chain uses zeroBaseFee — force 0 so unfunded edge cases
      // and non-zero eth_gasPrice guesses don't brick deploy.
      gasPrice: 0,
      gas: 12_000_000,
    },
  },
};

export default config;
