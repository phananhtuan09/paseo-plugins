export interface PermissionRequestShape {
  id: string;
  metadata?: { toolUseId?: unknown };
}
export interface PermissionEvent {
  type: string;
  request?: PermissionRequestShape;
  requestId?: string;
  resolution?: { behavior?: string };
}
export interface AgentSnapshot {
  status?: string;
  pendingPermissions?: PermissionRequestShape[];
}

/** What the store knows about permission requests and the agent; none of it is in the timeline entries. */
export class PermissionTracker {
  /** Permission request id to the tool call it asks about. */
  private readonly requests = new Map<string, string>();
  waiting = new Set<string>();
  readonly approvedAt = new Map<string, number>();
  agentClosed = false;

  onEvent(event: PermissionEvent, nowMs: number): void {
    if (event.type === "permission_requested") {
      const toolUseId = event.request?.metadata?.toolUseId;
      if (event.request && typeof toolUseId === "string") {
        this.requests.set(event.request.id, toolUseId);
        this.waiting.add(toolUseId);
      }
    } else if (event.requestId) {
      const toolUseId = this.requests.get(event.requestId);
      if (toolUseId) {
        this.requests.delete(event.requestId);
        this.waiting.delete(toolUseId);
        if (event.resolution?.behavior === "allow") this.approvedAt.set(toolUseId, nowMs);
      }
    }
  }

  /** A refetch is the truth about unanswered permission requests and whether the agent is still there. */
  readAgent(agent: AgentSnapshot | undefined): void {
    if (!agent) return;
    this.agentClosed = agent.status === "closed";
    if (!Array.isArray(agent.pendingPermissions)) return;
    this.requests.clear();
    this.waiting = new Set();
    for (const request of agent.pendingPermissions) {
      const toolUseId = request?.metadata?.toolUseId;
      if (typeof toolUseId !== "string") continue;
      this.requests.set(request.id, toolUseId);
      this.waiting.add(toolUseId);
    }
  }

  /** An approval time only matters while its step runs, so it goes once the timeline shows the step finished. */
  prune(finished: ReadonlySet<string>): void {
    for (const id of this.approvedAt.keys()) if (finished.has(id)) this.approvedAt.delete(id);
  }
}
