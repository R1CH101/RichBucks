import net from "net";
import type { Request } from "express";

/** Parse ADMIN_ALLOWED_IPS: comma-separated IPv4/IPv6 or IPv4 CIDR (e.g. 203.0.113.10,10.0.0.0/8). */
export function parseAllowlist(raw: string | undefined): string[] {
  return (raw || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Strip IPv4-mapped IPv6 (:ffff:x.x.x.x) for matching. */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return "";
  const trimmed = ip.trim().toLowerCase();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  return trimmed;
}

/**
 * Client IP for allowlisting.
 * When ADMIN_TRUST_CLOUDFLARE=true, prefer CF-Connecting-IP (set/overwritten by Cloudflare).
 * Do not enable TRUST unless traffic actually terminates at Cloudflare — otherwise clients can spoof it.
 */
export function clientIp(req: Request): string {
  if (process.env.ADMIN_TRUST_CLOUDFLARE === "true") {
    const cf = (req.header("cf-connecting-ip") || "").trim();
    if (cf) return normalizeIp(cf);
  }
  return normalizeIp(req.ip || "");
}

function ipToInt(ip: string): number | null {
  if (!net.isIPv4(ip)) return null;
  const parts = ip.split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function cidrContains(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  if (!base || bitsStr === undefined) return false;
  const bits = Number(bitsStr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const ipN = ipToInt(ip);
  const baseN = ipToInt(base);
  if (ipN === null || baseN === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ipN & mask) === (baseN & mask);
}

export function ipAllowed(ipRaw: string | undefined, allowlist: string[]): boolean {
  if (!allowlist.length) return false;
  const ip = normalizeIp(ipRaw);
  if (!ip) return false;

  for (const entry of allowlist) {
    const rule = entry.toLowerCase();
    if (rule.includes("/")) {
      if (cidrContains(ip, rule)) return true;
      continue;
    }
    if (normalizeIp(rule) === ip) return true;
  }
  return false;
}

/** Local healthchecks / docker internal probes. */
export function isLoopback(ip: string | undefined): boolean {
  const n = normalizeIp(ip);
  return n === "127.0.0.1" || n === "::1" || n === "localhost";
}
