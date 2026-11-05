import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ActivityStep, StepStatus } from "../shared/activity.ts";
import { ACTIVITY_META, activityLabel } from "./activity-meta.ts";
import { useDetailLevel } from "./detail-level.ts";
import { StepBodies } from "./step-bodies.tsx";

type Props = PluginTimelineItemProps<ActivityStep>;

const STATUS_ICON: Record<StepStatus, string> = {
  running: "Loader",
  done: "Check",
  failed: "X",
  canceled: "Ban",
};

// Paseo adds 16px under every plugin item itself, so a step never adds its own bottom margin.
export function StepView({ item, theme, layout, timestamp }: Props) {
  const step = item.data;
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
      body: { paddingLeft: layout.compact ? 8 : 12, paddingBottom: 4 },
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
          <Icon name={meta.icon} size={14} color={failed ? colors.statusDanger : colors.foregroundMuted} />
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

  return (
    <View>
      {header}
      {bodyOpen && hasBody ? (
        <View style={styles.body}>
          <StepBodies step={step} theme={theme} />
        </View>
      ) : null}
    </View>
  );
}

function useElapsed(running: boolean, timestamp: Date): string | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  if (!running) return undefined;
  const seconds = Math.max(0, Math.floor((now - timestamp.getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
