import { ethers, upgrades } from "hardhat";

async function main() {
  const proxyAddress = process.env.CONTRACT_ADDRESS;
  if (!proxyAddress) throw new Error("CONTRACT_ADDRESS required");

  const implName = process.env.UPGRADE_IMPL || "RichBucks";
  const Factory = await ethers.getContractFactory(implName);
  const upgraded = await upgrades.upgradeProxy(proxyAddress, Factory);
  await upgraded.waitForDeployment();
  console.log("Upgraded proxy", proxyAddress, "to", implName);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
