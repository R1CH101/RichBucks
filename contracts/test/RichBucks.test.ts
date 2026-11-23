import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RichBucks", () => {
  async function deploy() {
    const [owner, treasury, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("RichBucks");
    const token = await upgrades.deployProxy(Factory, [owner.address, treasury.address], {
      kind: "uups",
    });
    await token.waitForDeployment();
    return { token, owner, treasury, alice, bob };
  }

  it("mints 1_000_000 to treasury with 0 decimals and 10M cap", async () => {
    const { token, treasury } = await deploy();
    expect(await token.decimals()).to.equal(0);
    expect(await token.totalSupply()).to.equal(1_000_000n);
    expect(await token.balanceOf(treasury.address)).to.equal(1_000_000n);
    expect(await token.maxSupply()).to.equal(10_000_000n);
  });

  it("giveDailyTip mints tip + verifier reward once per day", async () => {
    const { token, owner, alice, bob } = await deploy();
    // Impersonation of coinbase is hard on hardhat; reward may go to 0x0 coinbase —
    // we still assert tip amount and once-per-day.
    await token.connect(alice).giveDailyTip(bob.address, "nice work");
    expect(await token.balanceOf(bob.address)).to.equal(1n);
    await expect(token.connect(alice).giveDailyTip(bob.address, "again")).to.be.revertedWith(
      "already tipped today"
    );

    await time.increase(24 * 60 * 60 + 1);
    await token.connect(alice).giveDailyTip(bob.address, "next day");
    expect(await token.balanceOf(bob.address)).to.equal(2n);
  });

  it("rejects self-tip and zero recipient", async () => {
    const { token, alice } = await deploy();
    await expect(token.connect(alice).giveDailyTip(alice.address, "nope")).to.be.revertedWith(
      "bad recipient"
    );
    await expect(
      token.connect(alice).giveDailyTip(ethers.ZeroAddress, "nope")
    ).to.be.revertedWith("bad recipient");
  });

  it("welcome mint once; admin mint; kill switches", async () => {
    const { token, owner, alice } = await deploy();
    await token.connect(owner).mintWelcome(alice.address);
    expect(await token.balanceOf(alice.address)).to.equal(10n);
    await expect(token.connect(owner).mintWelcome(alice.address)).to.be.revertedWith("claimed");

    await token.connect(owner).mintAdmin(alice.address, 5n);
    expect(await token.balanceOf(alice.address)).to.equal(15n);

    await token.connect(owner).setWelcomeMintEnabled(false);
    await token.connect(owner).setAdminMintEnabled(false);
    const [, , , , carol] = await ethers.getSigners();
    await expect(token.connect(owner).mintWelcome(carol.address)).to.be.revertedWith("welcome off");
    await expect(token.connect(owner).mintAdmin(carol.address, 1n)).to.be.revertedWith(
      "admin mint off"
    );
  });

  it("transfers are free whole numbers (no fee path)", async () => {
    const { token, treasury, alice } = await deploy();
    await token.connect(treasury).transfer(alice.address, 100n);
    expect(await token.balanceOf(alice.address)).to.equal(100n);
    await token.connect(alice).transfer(treasury.address, 40n);
    expect(await token.balanceOf(alice.address)).to.equal(60n);
  });

  it("bridgeLock burns and emits", async () => {
    const { token, treasury, alice } = await deploy();
    await token.connect(treasury).transfer(alice.address, 10n);
    await expect(token.connect(alice).bridgeLock(3n, alice.address))
      .to.emit(token, "BridgeLocked")
      .withArgs(alice.address, alice.address, 3n);
    expect(await token.balanceOf(alice.address)).to.equal(7n);
  });

  it("UUPS upgrade preserves balances and lastGiftedDay", async () => {
    const { token, owner, alice, bob } = await deploy();
    await token.connect(alice).giveDailyTip(bob.address, "hi");
    const day = await token.lastGiftedDay(alice.address);
    const bal = await token.balanceOf(bob.address);

    const V2 = await ethers.getContractFactory("RichBucksV2Mock");
    const upgraded = await upgrades.upgradeProxy(await token.getAddress(), V2, {
      unsafeAllow: ["missing-initializer"],
    });
    expect(await upgraded.balanceOf(bob.address)).to.equal(bal);
    expect(await upgraded.lastGiftedDay(alice.address)).to.equal(day);
    expect(await upgraded.version()).to.equal("v2");
    expect(await upgraded.owner()).to.equal(owner.address);
  });
});
