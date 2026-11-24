import { ethers, upgrades } from "hardhat";
import fs from "fs";
import path from "path";

function networkDir(): string {
  return process.env.NETWORK_DIR || "/network";
}

function contractAddressPath(): string {
  return path.join(networkDir(), "contract.address");
}

function writeAddress(address: string): void {
  const dir = networkDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(contractAddressPath(), `${address}\n`, "utf8");
  console.log("Wrote", contractAddressPath(), "→", address);
}

function welcomeMinterAddress(): string | undefined {
  const fromEnv = (process.env.WELCOME_MINTER_ADDRESS || "").trim();
  if (fromEnv) return fromEnv;
  const pk = (process.env.WELCOME_MINTER_PRIVATE_KEY || "").trim();
  if (!pk) return undefined;
  const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
  return new ethers.Wallet(normalized).address;
}

async function ensureWelcomeMinter(proxy: { welcomeMinter: () => Promise<string>; setWelcomeMinter: (a: string) => Promise<{ wait: () => Promise<unknown> }> }) {
  const minter = welcomeMinterAddress();
  if (!minter) {
    console.log("WELCOME_MINTER_* unset — skip setWelcomeMinter (owner remains minter until rotated).");
    return;
  }
  const current = await proxy.welcomeMinter();
  if (current.toLowerCase() === minter.toLowerCase()) {
    console.log("welcomeMinter already", minter);
    return;
  }
  const tx = await proxy.setWelcomeMinter(minter);
  await tx.wait();
  console.log("setWelcomeMinter →", minter);
}

async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    throw new Error(
      "No deployer signer — set DEPLOYER_PRIVATE_KEY in Coolify for contract-deploy."
    );
  }
  const [deployer] = signers;
  const treasury = (process.env.TREASURY_ADDRESS || "").trim() || deployer.address;
  const addrFile = contractAddressPath();

  console.log("Deployer:", deployer.address);
  console.log("Treasury:", treasury);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance (wei):", bal.toString());
  if (bal === 0n) {
    console.warn(
      "Deployer balance is 0. If deploy fails, set DEPLOYER_ADDRESS to this address before first chain-init (or wipe chain-network and redeploy)."
    );
  }

  if (fs.existsSync(addrFile)) {
    const existing = fs.readFileSync(addrFile, "utf8").trim();
    if (existing) {
      const code = await ethers.provider.getCode(existing);
      if (code && code !== "0x") {
        console.log("Contract already deployed at", existing, "— skipping deploy.");
        const proxy = await ethers.getContractAt("RichBucks", existing);
        await ensureWelcomeMinter(proxy);
        return;
      }
      console.log("Stale address in", addrFile, "(no code) — redeploying.");
    }
  }

  const RichBucks = await ethers.getContractFactory("RichBucks");
  const proxy = await upgrades.deployProxy(RichBucks, [deployer.address, treasury], {
    kind: "uups",
    initializer: "initialize",
  });
  await proxy.waitForDeployment();

  const address = await proxy.getAddress();
  writeAddress(address);
  console.log("RichBucks proxy:", address);
  console.log("totalSupply:", (await proxy.totalSupply()).toString());
  console.log("maxSupply:", (await proxy.maxSupply()).toString());
  console.log("decimals:", (await proxy.decimals()).toString());

  await ensureWelcomeMinter(proxy);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
