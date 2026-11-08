// Spike probe (not committed): records raw timeline refetches and live events for one agent.
// usage: probe.mjs <agentId> <outfile> <seconds> [refetchMs]
import fs from "node:fs";
const D = "/Applications/Paseo.app/Contents/Resources/app.asar/node_modules/@getpaseo/cli/dist/";
const { connectToDaemon } = await import(D + "utils/client.js");
const [agentId, out, secs, ms = "500"] = process.argv.slice(2);
const client = await connectToDaemon({ target: { kind: "instance", home: "/tmp/paseo-e2e-home" } });
const w = (o) => fs.appendFileSync(out, JSON.stringify({ t: Date.now(), ...o }) + "\n");
const unsub = client.subscribeAgentTimeline(agentId, (message) => w({ kind: "live", message }));
let last = "";
const tick = async () => {
  try {
    const r = await client.fetchAgentTimeline(agentId, { direction: "tail", limit: 200 });
    const s = JSON.stringify(r.entries);
    if (s !== last) { last = s; w({ kind: "refetch", entries: r.entries }); }
  } catch (e) { w({ kind: "error", error: String(e) }); }
};
const iv = setInterval(tick, Number(ms));
await tick();
setTimeout(async () => { clearInterval(iv); unsub?.(); await client.close().catch(() => {}); w({ kind: "end" }); process.exit(0); }, Number(secs) * 1000);
