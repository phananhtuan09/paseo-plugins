import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// OMP models are "<omp provider>/<model>", e.g. "google-antigravity/gemini-3.8-flash".
export const ompUsage = defineRpc({
  name: "omp.usage",
  input: z.object({ model: z.string() }),
  output: z.object({
    windows: z.array(
      z.object({ label: z.string(), usedPct: z.number(), resetsAt: z.string().nullable() }),
    ),
  }),
});
