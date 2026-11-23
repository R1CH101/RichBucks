import { Contract, JsonRpcProvider, Wallet } from "ethers";

const ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function giveDailyTip(address recipient, string reason)",
  "function mintWelcome(address to)",
  "function lastGiftedDay(address) view returns (uint256)",
  "function currentDay() view returns (uint256)",
  "function welcomeClaimed(address) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "event DailyTipSent(address indexed from, address indexed to, uint256 amount, address indexed proposer, uint256 verifierAmount, string reason)",
] as const;

export class ChainClient {
  readonly provider: JsonRpcProvider;
  readonly token: Contract;
  /** Welcome-minter only — must NOT be the contract owner/upgrade key in production. */
  private minter: Wallet;

  constructor(
    rpcUrl: string,
    contractAddress: string,
    welcomeMinterPrivateKey: string
  ) {
    this.provider = new JsonRpcProvider(rpcUrl);
    const key = welcomeMinterPrivateKey.startsWith("0x")
      ? welcomeMinterPrivateKey
      : `0x${welcomeMinterPrivateKey}`;
    this.minter = new Wallet(key, this.provider);
    this.token = new Contract(contractAddress, ABI, this.minter);
  }

  walletFromKey(privateKey: string): Wallet {
    const key = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
    return new Wallet(key, this.provider);
  }

  async balance(address: string): Promise<bigint> {
    return this.token.balanceOf(address);
  }

  async canTipToday(address: string): Promise<boolean> {
    const last = await this.token.lastGiftedDay(address);
    const today = await this.token.currentDay();
    return last < today;
  }

  async giveDailyTip(fromKey: string, recipient: string, reason: string) {
    const signer = this.walletFromKey(fromKey);
    const token = this.token.connect(signer) as Contract;
    const tx = await token.giveDailyTip(recipient, reason, {
      gasPrice: 0n,
      gasLimit: 300000n,
    });
    return tx.wait();
  }

  async send(fromKey: string, to: string, amount: bigint) {
    if (amount <= 0n || amount !== BigInt(amount)) {
      throw new Error("amount must be a positive whole number");
    }
    const signer = this.walletFromKey(fromKey);
    const token = this.token.connect(signer) as Contract;
    const tx = await token.transfer(to, amount, { gasPrice: 0n, gasLimit: 100000n });
    return tx.wait();
  }

  async mintWelcome(to: string) {
    const claimed = await this.token.welcomeClaimed(to);
    if (claimed) return null;
    const tx = await this.token.mintWelcome(to, { gasPrice: 0n, gasLimit: 200000n });
    return tx.wait();
  }

  async leaderboard(fromBlock = 0): Promise<{
    topEarners: { address: string; amount: bigint }[];
    topGivers: { address: string; amount: bigint }[];
    topProposers: { address: string; amount: bigint }[];
  }> {
    const filter = this.token.filters.DailyTipSent();
    const events = await this.token.queryFilter(filter, fromBlock, "latest");
    const earn = new Map<string, bigint>();
    const give = new Map<string, bigint>();
    const prop = new Map<string, bigint>();

    for (const ev of events) {
      const { from, to, amount, proposer, verifierAmount } = (ev as any).args;
      earn.set(to, (earn.get(to) || 0n) + amount);
      give.set(from, (give.get(from) || 0n) + amount);
      if (proposer && verifierAmount > 0n) {
        prop.set(proposer, (prop.get(proposer) || 0n) + verifierAmount);
      }
    }

    const sortMap = (m: Map<string, bigint>) =>
      [...m.entries()]
        .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
        .slice(0, 10)
        .map(([address, amount]) => ({ address, amount }));

    return {
      topEarners: sortMap(earn),
      topGivers: sortMap(give),
      topProposers: sortMap(prop),
    };
  }
}

/** Parse integer-only RB amounts. */
export function parseWholeRb(input: string): bigint {
  if (!/^\d+$/.test(input.trim())) {
    throw new Error("Amount must be a whole number (no decimals)");
  }
  return BigInt(input.trim());
}
