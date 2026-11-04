import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { ompUsage } from "../shared/omp-usage";

const run = promisify(execFile);

type OmpLimit = {
  id: string;
  label: string;
  window?: { id: string; label: string; durationMs?: number; resetsAt?: number };
  amount?: { unit: string; used?: number };
};

// Pooled providers such as google-antigravity report one quota per model family,
// encoded as "<provider>:<family>:<account>:<window>" in the limit id.
function familyOf(model: string) {
  if (/gemini/i.test(model)) return "google";
  if (/claude/i.test(model)) return "anthropic";
  if (/gpt|codex|\bo\d/i.test(model)) return "openai";
  return null;
}

export async function readOmpUsage({ model }: RpcInput<typeof ompUsage>): Promise<RpcOutput<typeof ompUsage>> {
  const slash = model.indexOf("/");
  if (slash <= 0) return { windows: [] };
  const provider = model.slice(0, slash);
  const { stdout } = await run("omp", ["usage", "--json", "--provider", provider], { timeout: 20_000 });
  const reports: { limits?: OmpLimit[] }[] = JSON.parse(stdout).reports ?? [];
  let limits = reports
    .flatMap((report) => report.limits ?? [])
    .filter((limit) => limit.window && limit.amount?.unit === "percent" && typeof limit.amount.used === "number");
  const family = familyOf(model.slice(slash + 1));
  const familyLimits = limits.filter((limit) => limit.id.split(":")[1] === family);
  if (familyLimits.length > 0) limits = familyLimits;
  const seen = new Set<string>();
  return {
    windows: limits
      .sort((a, b) => (a.window!.durationMs ?? 0) - (b.window!.durationMs ?? 0))
      .filter((limit) => {
        // Shared quotas repeat once per family; show each label and window once.
        const key = `${limit.label}:${limit.window!.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((limit) => ({
        label: `${limit.label} ${limit.window!.label}`,
        usedPct: limit.amount!.used!,
        resetsAt: limit.window!.resetsAt ? new Date(limit.window!.resetsAt).toISOString() : null,
      })),
  };
}
