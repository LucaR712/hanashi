import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import type { Colors } from "./theme";
import type { Msg } from "./store";

export function Bubble({
  msg,
  c,
  showReading,
  onPlay,
}: {
  msg: Msg;
  c: Colors;
  showReading: boolean;
  onPlay: (text: string) => void;
}) {
  const [showEn, setShowEn] = useState(false);
  const mine = msg.role === "user";
  return (
    <View style={[s.msg, mine ? s.mine : s.theirs]}>
      <View
        style={[
          s.bubble,
          mine
            ? { backgroundColor: c.me, borderTopRightRadius: 4 }
            : { backgroundColor: c.surface, borderColor: c.line, borderWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 4 },
        ]}
      >
        <Text style={[s.jp, { color: mine ? c.meInk : c.ink }]} selectable>
          {msg.text || (msg.streaming ? "…" : "")}
        </Text>
      </View>

      {!mine && showReading && !!msg.reading && (
        <Text style={[s.small, { color: c.muted }]} selectable>
          {msg.reading}
        </Text>
      )}
      {!mine && showEn && !!msg.en && (
        <Text style={[s.small, s.italic, { color: c.muted }]} selectable>
          {msg.en}
        </Text>
      )}
      {!mine && !!msg.explain && (
        <View style={[s.card, { backgroundColor: c.aiSoft }]}>
          <Text style={[s.label, { color: c.ai }]}>EXPLANATION</Text>
          <Text style={[s.body, { color: c.ink }]} selectable>
            {msg.explain}
          </Text>
        </View>
      )}
      {!mine && !msg.streaming && !!msg.text && (
        <View style={s.tools}>
          <Chip c={c} label="Play again" onPress={() => onPlay(msg.text)} />
          {!!msg.en && <Chip c={c} label={showEn ? "Hide English" : "English"} onPress={() => setShowEn((v) => !v)} />}
        </View>
      )}

      {mine && msg.check && <CheckCard c={c} check={msg.check} original={msg.text} onPlay={onPlay} />}
    </View>
  );
}

function CheckCard({
  c,
  check,
  original,
  onPlay,
}: {
  c: Colors;
  check: NonNullable<Msg["check"]>;
  original: string;
  onPlay: (t: string) => void;
}) {
  if (check.ok) {
    const alt = check.natural && check.natural !== original ? check.natural : null;
    return (
      <View style={[s.card, { backgroundColor: c.okSoft, alignSelf: "flex-end" }]}>
        <Text style={[s.body, { color: c.ok, fontWeight: "600" }]}>Sounds natural</Text>
        {alt && (
          <Text style={[s.small, { color: c.muted, paddingHorizontal: 0 }]} selectable>
            A local might also say: {alt}
          </Text>
        )}
      </View>
    );
  }
  const fixed = check.corrected || check.natural || "";
  return (
    <View style={[s.card, { backgroundColor: c.fixSoft, borderColor: c.fix, borderWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[s.label, { color: c.fix }]}>BETTER</Text>
      <Text style={[s.fixText, { color: c.ink }]} selectable>
        {fixed}
      </Text>
      {!!check.natural && check.natural !== check.corrected && (
        <Text style={[s.body, { color: c.muted }]} selectable>
          More natural: {check.natural}
        </Text>
      )}
      {(check.notes ?? []).slice(0, 3).map((n, i) => (
        <Text key={i} style={[s.body, { color: c.ink }]}>
          • {n}
        </Text>
      ))}
      {!!fixed && (
        <View style={[s.tools, { paddingHorizontal: 0, marginTop: 4 }]}>
          <Chip c={c} label="Hear it" onPress={() => onPlay(fixed)} />
        </View>
      )}
    </View>
  );
}

export function Chip({ c, label, onPress, active }: { c: Colors; label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        s.chip,
        { borderColor: active ? c.ai : c.line, backgroundColor: active ? c.aiSoft : "transparent", opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={{ color: active ? c.ai : c.muted, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string | number>({
  c,
  value,
  options,
  onChange,
}: {
  c: Colors;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={[s.seg, { borderColor: c.line, backgroundColor: c.bg }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            style={[s.segItem, on && { backgroundColor: c.surface, borderColor: c.ai, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={{ color: on ? c.ai : c.muted, fontWeight: on ? "700" : "400", fontSize: 14, textAlign: "center" }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ToggleRow({
  c,
  label,
  hint,
  value,
  onChange,
}: {
  c: Colors;
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.ink, fontSize: 16 }}>{label}</Text>
        {hint && <Text style={{ color: c.muted, fontSize: 13 }}>{hint}</Text>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.ai }} />
    </View>
  );
}

const s = StyleSheet.create({
  msg: { maxWidth: "88%", gap: 6, marginBottom: 14 },
  mine: { alignSelf: "flex-end", alignItems: "flex-end" },
  theirs: { alignSelf: "flex-start" },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  jp: { fontSize: 19, lineHeight: 30 },
  small: { fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  italic: { fontStyle: "italic" },
  body: { fontSize: 14, lineHeight: 21 },
  fixText: { fontSize: 17, lineHeight: 26 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  card: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, gap: 3, maxWidth: "100%" },
  tools: { flexDirection: "row", gap: 8, paddingHorizontal: 2, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  seg: { flexDirection: "row", borderWidth: 1, borderRadius: 10, padding: 3, gap: 3 },
  segItem: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8, borderWidth: 1, borderColor: "transparent" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
});
