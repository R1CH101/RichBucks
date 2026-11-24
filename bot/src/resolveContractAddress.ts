import fs from "fs";

/** Env wins; else /network/contract.address written by contract-deploy. */
export function resolveContractAddress(): string {
  const fromEnv = (process.env.CONTRACT_ADDRESS || "").trim();
  if (fromEnv.length >= 42) return fromEnv;

  const candidates = [
    process.env.CONTRACT_ADDRESS_FILE,
    "/network/contract.address",
    "./network/contract.address",
  ].filter((p): p is string => Boolean(p && p.trim()));

  for (const p of candidates) {
    try {
      const v = fs.readFileSync(p, "utf8").trim();
      if (v.length >= 42) {
        process.env.CONTRACT_ADDRESS = v;
        return v;
      }
    } catch {
      /* missing file */
    }
  }
  return fromEnv;
}
