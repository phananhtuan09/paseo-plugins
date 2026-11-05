import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ActivityStep, StepStatus } from "../shared/activity.ts";
import { ACTIVITY_META, activityLabel, type Phase } from "./activity-meta.ts";
import { stepKey, useTimelineRow } from "./agent-timeline.ts";
import { useDetailLevel } from "./detail-level.ts";
import { StepBodies } from "./step-bodies.tsx";
import { formatDuration } from "./format.ts";
import { paletteFor } from "./palette.ts";
import type { SegmentInfo } from "./segments.ts";

type Props = PluginTimelineItemProps<ActivityStep>;

const STATUS_ICON: Record<StepStatus, string> = {
  running: "Loader",
  done: "Check",
  failed: "X",
  canceled: "Ban",
};

// Paseo adds 16px under every plugin item itself, so a step never adds its own bottom margin.
/** Steps and Full tint only the icon and the phase label; text stays neutral and failures stay red. */
function phaseColor(phase: Phase, colors: Props["theme"]["colors"]): string {
  const palette = paletteFor(colors);
  return phase === "Explore" ? palette.blue : phase === "Change" ? palette.amber : palette.violet;
}

export function StepView({ item, theme, layout, timestamp, agentId }: Props) {
  const { row, info } = useTimelineRow(agentId, stepKey(item.data, timestamp));
  const step = row?.step ?? item.data;
  const level = useDetailLevel();
  const [manual, setManual] = useState<boolean | null>(null);
  // Changing the level drops every per-step tap so the whole timeline shows one level.
  useEffect(() => setManual(null), [level]);
  const bodyOpen = manual ?? level === "full";
  const elapsed = useElapsed(step.status === "running", timestamp);

  const { colors } = theme;
  const meta = ACTIVITY_META[step.activity];
  const label = activityLabel(step.activity, step.status);
  const failed = step.status === "failed";
  const running = step.status === "running";
  const canceled = step.status === "canceled";
  const hasBody = Boolean(step.details || step.body || step.errorText);
  const proseTarget = step.activity === "think" || step.activity === "delegate" || step.activity === "plan";

  const styles = useMemo(
    () => ({
      target: {
        color: colors.foregroundMuted,
        fontSize: 13,
        flexShrink: 1,
        fontFamily: proseTarget ? undefined : "monospace",
        textDecorationLine: canceled ? ("line-through" as const) : ("none" as const),
      },
      label: { color: failed ? colors.statusDanger : colors.foreground, fontSize: 13, fontWeight: "500" as const },
      meta: { color: failed ? colors.statusDanger : colors.foregroundMuted, fontSize: 12 },
      chip: {
        alignSelf: "flex-start" as const,
        maxWidth: "100%" as const,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 4,
        paddingHorizontal: 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: failed ? colors.statusDanger : running ? colors.accent : colors.border,
        backgroundColor: running ? colors.surface1 : "transparent",
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 8,
        backgroundColor: running ? colors.surface1 : "transparent",
      },
      labelCol: { width: layout.compact ? 84 : 104, flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      grow: { flex: 1, flexDirection: "row" as const, gap: 8, alignItems: "center" as const, minWidth: 0 },
      // A guide line under the icon ties the detail to its step and sets it apart from the next step.
      body: {
        marginLeft: 15,
        marginTop: 4,
        marginBottom: 10,
        paddingLeft: layout.compact ? 10 : 14,
        borderLeftWidth: 2,
        borderLeftColor: colors.border,
      },
    }),
    [colors, layout.compact, failed, running, canceled, proseTarget],
  );

  const metaText = [step.meta, running && elapsed ? elapsed : undefined].filter(Boolean).join(" · ");
  const statusColor = failed ? colors.statusDanger : colors.statusSuccess;
  const status = running ? (
    <ActivityIndicator size="small" color={colors.accent} />
  ) : (
    <Icon name={STATUS_ICON[step.status]} size={14} color={statusColor} />
  );
  const accessibilityLabel = `${label} ${step.target}, ${step.status === "done" ? "done" : step.status}, ${
    bodyOpen ? "expanded" : "collapsed"
  }`;
  const toggle = hasBody ? () => setManual(!bodyOpen) : undefined;

  const header =
    level === "brief" ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: bodyOpen }}
        disabled={!toggle}
        onPress={toggle}
        style={styles.chip}
      >
        <Icon name={meta.icon} size={14} color={failed ? colors.statusDanger : colors.foregroundMuted} />
        <Text style={styles.label}>{label}</Text>
        <Text numberOfLines={1} style={styles.target}>
          {step.target}
        </Text>
        {metaText ? <Text style={styles.meta}>{metaText}</Text> : null}
        {status}
      </Pressable>
    ) : (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: bodyOpen }}
        disabled={!toggle}
        onPress={toggle}
        style={styles.row}
      >
        <View style={styles.labelCol}>
          <Icon name={meta.icon} size={14} color={failed ? colors.statusDanger : phaseColor(meta.phase, colors)} />
          <Text style={styles.label}>{label}</Text>
        </View>
        <View style={styles.grow}>
          <Text numberOfLines={1} style={styles.target}>
            {step.target}
          </Text>
          {metaText ? <Text style={styles.meta}>{metaText}</Text> : null}
        </View>
        {status}
      </Pressable>
    );

  // Multiple source records can represent one Codex call after an interrupted turn.
  if (row && row.time !== timestamp.getTime()) return null;
  return (
    <View>
      {info && level !== "brief" ? <Headers info={info} theme={theme} /> : null}
      {header}
      {bodyOpen && hasBody ? (
        <View style={styles.body}>
          <StepBodies step={step} theme={theme} />
        </View>
      ) : null}
    </View>
  );
}

function Headers({ info, theme }: { info: SegmentInfo; theme: Props["theme"] }) {
  const { colors } = theme;
  const now = useNow(Boolean(info.run?.running));
  return (
    <View>
      {info.run ? (
        <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontWeight: "600", paddingHorizontal: 8, paddingBottom: 10 }}>
          {[
            `${info.run.steps} step${info.run.steps === 1 ? "" : "s"}`,
            formatDuration((info.run.running ? now : info.run.endMs) - info.run.startMs),
            info.run.failed > 0 ? `${info.run.failed} failed` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      {info.phase ? (
        <Text
          style={{
            color: info.phase.failed
              ? colors.statusDanger
              : info.phase.running
                ? colors.foreground
                : phaseColor(info.phase.phase, colors),
            fontSize: 11,
            fontWeight: "700",
            letterSpacing: 0.6,
            paddingHorizontal: 8,
            paddingBottom: 6,
            paddingTop: info.run ? 0 : 14,
          }}
        >
          {info.phase.phase.toUpperCase()}
        </Text>
      ) : null}
    </View>
  );
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function useElapsed(running: boolean, timestamp: Date): string | undefined {
  const now = useNow(running);
  return running ? formatDuration(now - timestamp.getTime()) : undefined;
}
