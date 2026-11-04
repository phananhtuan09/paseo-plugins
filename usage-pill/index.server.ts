import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readOmpUsage } from "./server/omp-usage";
import { ompUsage } from "./shared/omp-usage";

export default function contribute(server: PluginServerContext) {
  server.handle(ompUsage, readOmpUsage);
  return () => {};
}
