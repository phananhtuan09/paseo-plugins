import type { PluginTheme } from "@getpaseo/plugin";
import { StreamedText } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { ActivityStep } from "../shared/activity.ts";

const MONO = { fontFamily: "monospace", lineHeight: 17 } as const;

export function StepBodies({
  step,
  theme,
}: {
  step: ActivityStep;
  theme: PluginTheme;
}) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      wrap: { gap: 8, paddingTop: 8 },
      detailRow: { flexDirection: "row" as const, gap: 8 },
      detailLabel: { color: colors.foregroundMuted, fontSize: 12, width: 40 },
      detailValue: { color: colors.foreground, flex: 1, ...MONO, fontSize: 12 },
      block: {
        backgroundColor: colors.surface1,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 8,
      },
      mono: { color: colors.foreground, ...MONO, fontSize: 12 },
      more: { color: colors.foregroundMuted, fontSize: 12, paddingTop: 4 },
      error: { color: colors.statusDanger, ...MONO, fontSize: 12 },
      stream: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
    }),
    [colors],
  );
  const { body } = step;
  return (
    <View style={styles.wrap}>
      {step.details?.map((detail) => (
        <View key={detail.label} style={styles.detailRow}>
          <Text style={styles.detailLabel}>{detail.label}</Text>
          <Text selectable style={styles.detailValue}>
            {detail.value}
          </Text>
        </View>
      ))}
      {body ? (
        <View style={styles.block}>
          {body.kind === "stream" ? (
            <StreamedText
              text={body.text}
              phase={step.status === "running" ? "streaming" : "complete"}
              style={styles.stream}
            />
          ) : body.kind === "diff" ? (
            <DiffLines text={body.text} colors={colors} />
          ) : (
            <Text selectable style={styles.mono}>
              {body.text}
            </Text>
          )}
          {body.hiddenLines ? <Text style={styles.more}>… {body.hiddenLines} more lines</Text> : null}
        </View>
      ) : null}
      {step.errorText ? (
        <View style={[styles.block, { borderColor: colors.statusDanger }]}>
          <Text selectable style={styles.error}>
            {step.errorText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DiffLines({ text, colors }: { text: string; colors: PluginTheme["colors"] }) {
  return (
    <View>
      {text.split("\n").map((line, index) => (
        <Text
          key={index}
          selectable
          style={{
            ...MONO,
            fontSize: 12,
            color: line.startsWith("+")
              ? colors.statusSuccess
              : line.startsWith("-")
                ? colors.statusDanger
                : colors.foreground,
          }}
        >
          {line}
        </Text>
      ))}
    </View>
  );
}
