import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasury);

  const RichBucks = await ethers.getContractFactory("RichBucks");
  const proxy = await upgrades.deployProxy(RichBucks, [deployer.address, treasury], {
    kind: "uups",
    initializer: "initialize",
  });
  await proxy.waitForDeployment();

  const address = await proxy.getAddress();
  console.log("RichBucks proxy:", address);
  console.log("totalSupply:", (await proxy.totalSupply()).toString());
  console.log("maxSupply:", (await proxy.maxSupply()).toString());
  console.log("decimals:", (await proxy.decimals()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
