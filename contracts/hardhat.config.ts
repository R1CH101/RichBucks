import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config();

const pk = process.env.DEPLOYER_PRIVATE_KEY
  ? [process.env.DEPLOYER_PRIVATE_KEY.startsWith("0x")
      ? process.env.DEPLOYER_PRIVATE_KEY
      : `0x${process.env.DEPLOYER_PRIVATE_KEY}`]
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
    },
  },
};

export default config;
