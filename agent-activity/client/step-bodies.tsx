import type { PluginTheme } from "@getpaseo/plugin";
import { StreamedText } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { ActivityStep, BodyLang } from "../shared/activity.ts";
import { type Token, type TokenKind, tokenize } from "./highlight.ts";
import { paletteFor } from "./palette.ts";

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
      wrap: { gap: 8, paddingTop: 4 },
      detailRow: { flexDirection: "row" as const, gap: 8 },
      detailLabel: { color: colors.foregroundMuted, fontSize: 11, width: 44, paddingTop: 1 },
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
      {step.command ? (
        <View style={styles.block}>
          <Code text={step.command} lang="sh" colors={colors} style={styles.mono} />
        </View>
      ) : null}
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
          ) : body.lang ? (
            <Code text={body.text} lang={body.lang} colors={colors} style={styles.mono} />
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

/** Token colors come from the host theme so they follow light and dark. */
function tokenColor(kind: TokenKind, colors: PluginTheme["colors"]): string {
  const palette = paletteFor(colors);
  switch (kind) {
    case "keyword":
      return palette.violet;
    case "command":
      return palette.blue;
    case "string":
      return colors.statusSuccess;
    case "number":
    case "flag":
    case "variable":
      return palette.amber;
    case "comment":
    case "operator":
      return colors.foregroundMuted;
    default:
      return colors.foreground;
  }
}

function Code({
  text,
  lang,
  colors,
  style,
}: {
  text: string;
  lang: BodyLang;
  colors: PluginTheme["colors"];
  style: object;
}) {
  const tokens = useMemo<Token[]>(() => tokenize(text, lang), [text, lang]);
  return (
    <Text selectable style={style}>
      {tokens.map((token, index) =>
        token.kind === "plain" ? (
          token.text
        ) : (
          <Text
            key={index}
            style={{
              color: tokenColor(token.kind, colors),
              ...(token.kind === "comment" ? { fontStyle: "italic" as const } : {}),
              ...(token.kind === "command" ? { fontWeight: "600" as const } : {}),
            }}
          >
            {token.text}
          </Text>
        ),
      )}
    </Text>
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
