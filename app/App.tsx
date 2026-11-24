import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";

import { checkServer, getSuggestions, streamChat, type Turn } from "./src/api";
import {
  defaultSettings,
  greeting,
  loadChat,
  loadNotes,
  loadSettings,
  saveChat,
  saveNotes,
  saveSettings,
  type Msg,
  type Note,
  type Settings,
} from "./src/store";
import { useColors, type Colors } from "./src/theme";
import { Bubble, Chip, Segmented, ToggleRow } from "./src/ui";
import { hush, isSpeaking, onSpeechIdle, pickJapaneseVoice, say, takeSentences } from "./src/voice";

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const uid = () => Math.random().toString(36).slice(2);

function Main() {
  const c = useColors();
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [sugs, setSugs] = useState<{ jp: string; en: string }[]>([]);
  const [sugBusy, setSugBusy] = useState(false);
  const [sheet, setSheet] = useState<"settings" | "notes" | null>(null);

  const msgsRef = useRef<Msg[]>([]);
  const settingsRef = useRef(settings);
  const heard = useRef("");
  const sendOnEnd = useRef(true);
  const autoListen = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  msgsRef.current = msgs;
  settingsRef.current = settings;

  // ---------- load & persist
  useEffect(() => {
    (async () => {
      const [s, chat, n] = await Promise.all([loadSettings(), loadChat(), loadNotes()]);
      setSettings(s);
      setMsgs(chat.length ? chat.map((m) => ({ ...m, streaming: false })) : [greeting(s.style)]);
      setNotes(n);
      setReady(true);
      if (!s.serverUrl) setSheet("settings");
      void pickJapaneseVoice();
    })();
  }, []);
  useEffect(() => { if (ready) saveSettings(settings); }, [settings, ready]);
  useEffect(() => { if (ready && !busy) saveChat(msgs); }, [msgs, ready, busy]);
  useEffect(() => { if (ready) saveNotes(notes); }, [notes, ready]);

  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
  const patchMsg = (id: string, patch: Partial<Msg>) =>
    setMsgs((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  // ---------- listening
  const startListening = useCallback(async () => {
    abortRef.current?.abort();
    hush();
    autoListen.current = false;
    setStatus("");
    setSugs([]);
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      setStatus("Hanashi needs the microphone and speech recognition. Allow them in your phone's Settings, or type instead.");
      return;
    }
    heard.current = "";
    setDraft("");
    sendOnEnd.current = true;
    ExpoSpeechRecognitionModule.start({
      lang: "ja-JP",
      interimResults: true,
      continuous: false,
      addsPunctuation: true,
      iosCategory: { category: "playAndRecord", categoryOptions: ["defaultToSpeaker", "allowBluetooth"], mode: "default" },
    });
  }, []);

  const stopListening = (send: boolean) => {
    sendOnEnd.current = send;
    ExpoSpeechRecognitionModule.stop();
  };

  useSpeechRecognitionEvent("start", () => setListening(true));
  useSpeechRecognitionEvent("result", (e) => {
    heard.current = e.results[0]?.transcript ?? heard.current;
    setDraft(heard.current);
  });
  useSpeechRecognitionEvent("error", (e) => {
    sendOnEnd.current = false;
    if (e.error === "no-speech" || e.error === "speech-timeout") setStatus("I didn't catch that. Tap the mic and try again.");
    else if (e.error !== "aborted") setStatus(`The microphone stopped (${e.message || e.error}).`);
  });
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    const text = heard.current.trim();
    heard.current = "";
    if (sendOnEnd.current && text) void send(text);
  });

  // When Hana finishes speaking in hands-free mode, listen again.
  const startRef = useRef(startListening);
  startRef.current = startListening;
  useEffect(() => {
    onSpeechIdle(() => {
      if (autoListen.current) {
        autoListen.current = false;
        void startRef.current();
      }
    });
    return () => onSpeechIdle(null);
  }, []);

  // ---------- talking to Hana
  const history = (list: Msg[]): Turn[] =>
    list.filter((m) => m.text.trim() && !m.streaming).map((m) => ({ role: m.role, content: m.text }));

  async function send(raw: string) {
    const text = raw.trim();
    const s = settingsRef.current;
    if (!text) return;
    if (!s.serverUrl) {
      setSheet("settings");
      setStatus("Add your server address in Settings first.");
      return;
    }
    abortRef.current?.abort();
    hush();
    setDraft("");
    setSugs([]);
    setStatus("");

    const me: Msg = { id: uid(), role: "user", text };
    const her: Msg = { id: uid(), role: "assistant", text: "", streaming: true };
    const turns = [...history(msgsRef.current), { role: "user" as const, content: text }];
    setMsgs((list) => [...list, me, her]);
    setBusy(true);

    const ctl = new AbortController();
    abortRef.current = ctl;
    let reply = "";
    let toSpeak = "";
    try {
      const meta = await streamChat(
        s,
        { messages: turns, level: s.level, style: s.style },
        (delta) => {
          reply += delta;
          patchMsg(her.id, { text: reply.trimStart() });
          if (s.voiceOn) {
            const [ready, rest] = takeSentences(toSpeak + delta);
            if (ready) say(ready, s.rate);
            toSpeak = rest;
          }
        },
        ctl.signal,
      );
      if (s.voiceOn && toSpeak.trim()) say(toSpeak, s.rate);
      patchMsg(her.id, {
        text: meta.reply || reply.trim(),
        reading: meta.reading,
        en: meta.en,
        explain: meta.explain,
        streaming: false,
      });
      if (meta.check) {
        patchMsg(me.id, { check: meta.check });
        const to = meta.check.corrected || meta.check.natural;
        if (!meta.check.ok && to) {
          setNotes((n) => [{ from: text, to, why: (meta.check?.notes ?? []).join(" "), at: Date.now() }, ...n]);
        }
      }
      if (s.handsFree) {
        if (s.voiceOn && isSpeaking()) autoListen.current = true;
        else void startRef.current();
      }
    } catch (e) {
      if (ctl.signal.aborted) {
        patchMsg(her.id, { streaming: false });
        if (!reply.trim()) setMsgs((list) => list.filter((m) => m.id !== her.id));
      } else {
        setMsgs((list) => list.filter((m) => m.id !== her.id));
        setStatus(e instanceof Error ? e.message : "Something went wrong. Try again.");
      }
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setBusy(false);
    }
  }

  const onMic = () => {
    if (listening) stopListening(true);
    else void startListening();
  };

  const play = (text: string) => {
    autoListen.current = false;
    hush();
    say(text, settings.rate);
  };

  const helpMe = async () => {
    if (sugBusy) return;
    setSugBusy(true);
    try {
      const list = await getSuggestions(settings, {
        messages: history(msgs),
        level: settings.level,
        style: settings.style,
      });
      setSugs(list);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't get suggestions.");
    } finally {
      setSugBusy(false);
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    hush();
    if (listening) stopListening(false);
    const g = greeting(settings.style);
    setMsgs([g]);
    setSugs([]);
    setStatus("");
    setSheet(null);
    if (settings.voiceOn) setTimeout(() => say(g.text, settings.rate), 300);
  };

  if (!ready) {
    return (
      <View style={[st.fill, st.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator color={c.ai} />
      </View>
    );
  }

  const live = listening ? "Listening… tap the mic when you're done" : busy ? "Hana is replying…" : "";

  return (
    <SafeAreaView style={[st.fill, { backgroundColor: c.bg }]} edges={["top", "left", "right"]}>
      <StatusBar style="auto" />
      {/* Header */}
      <View style={[st.header, { borderBottomColor: c.line }]}>
        <View style={[st.avatar, { backgroundColor: c.aiSoft }]}>
          <Text style={{ color: c.ai, fontSize: 20, fontWeight: "700" }}>ハ</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.ink, fontSize: 17, fontWeight: "700" }}>Hana</Text>
          <Text style={{ color: c.muted, fontSize: 12 }} numberOfLines={1}>
            {live || "Your friend in Tokyo · 吉祥寺"}
          </Text>
        </View>
        <Chip c={c} label={notes.length ? `Notes ${notes.length}` : "Notes"} onPress={() => setSheet("notes")} />
        <Chip c={c} label="Settings" onPress={() => setSheet("settings")} />
      </View>

      <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={(m) => m.id}
          contentContainerStyle={st.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <Bubble msg={item} c={c} showReading={settings.showReading} onPlay={play} />}
          keyboardShouldPersistTaps="handled"
        />

        {/* Composer */}
        <SafeAreaView edges={["bottom"]} style={[st.composer, { backgroundColor: c.surface, borderTopColor: c.line }]}>
          {!!status && <Text style={[st.status, { color: c.rec }]}>{status}</Text>}
          {sugs.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {sugs.map((sg, i) => (
                <Pressable key={i} onPress={() => { setDraft(sg.jp); setSugs([]); }} style={[st.sug, { borderColor: c.ai }]}>
                  <Text style={{ color: c.ai, fontSize: 15 }}>{sg.jp}</Text>
                  <Text style={{ color: c.muted, fontSize: 11 }}>{sg.en}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <View style={st.row}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              editable={!listening}
              placeholder="話してみて… or type here"
              placeholderTextColor={c.muted}
              multiline
              style={[st.input, { color: c.ink, backgroundColor: c.bg, borderColor: listening ? c.rec : c.line }]}
            />
            <Pressable
              onPress={() => void send(draft)}
              disabled={busy || listening || !draft.trim()}
              style={({ pressed }) => [st.send, { borderColor: c.ai, opacity: busy || listening || !draft.trim() ? 0.4 : pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: c.ai, fontWeight: "700" }}>Send</Text>
            </Pressable>
          </View>
          <View style={st.controls}>
            <View style={st.side}>
              <Chip c={c} label={settings.handsFree ? "Hands-free on" : "Hands-free off"} active={settings.handsFree}
                onPress={() => update({ handsFree: !settings.handsFree })} />
            </View>
            <MicButton c={c} listening={listening} onPress={onMic} />
            <View style={[st.side, { alignItems: "flex-end" }]}>
              <Chip c={c} label={sugBusy ? "Thinking…" : "Help me reply"} onPress={helpMe} />
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <SettingsSheet
        c={c}
        visible={sheet === "settings"}
        settings={settings}
        update={update}
        onClose={() => setSheet(null)}
        onNewChat={newChat}
      />
      <NotesSheet
        c={c}
        visible={sheet === "notes"}
        notes={notes}
        onClear={() => setNotes([])}
        onClose={() => setSheet(null)}
        onPlay={play}
      />
    </SafeAreaView>
  );
}

function MicButton({ c, listening, onPress }: { c: Colors; listening: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={listening ? "Stop and send" : "Talk to Hana"}
      style={({ pressed }) => [st.mic, { backgroundColor: listening ? c.rec : c.ai, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
    >
      {listening ? (
        <View style={[st.stopIcon, { backgroundColor: c.surface }]} />
      ) : (
        <View style={st.micIcon}>
          <View style={[st.micHead, { borderColor: c.surface }]} />
          <View style={[st.micStem, { backgroundColor: c.surface }]} />
        </View>
      )}
    </Pressable>
  );
}

function SettingsSheet({
  c,
  visible,
  settings,
  update,
  onClose,
  onNewChat,
}: {
  c: Colors;
  visible: boolean;
  settings: Settings;
  update: (p: Partial<Settings>) => void;
  onClose: () => void;
  onNewChat: () => void;
}) {
  const [test, setTest] = useState("");
  const runTest = async () => {
    setTest("Checking…");
    try {
      await checkServer(settings);
      setTest("Connected. Hana is ready.");
    } catch {
      setTest("Couldn't reach the server. Check the address and that the server is running.");
    }
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[st.fill, { backgroundColor: c.surface }]} edges={["top", "bottom", "left", "right"]}>
        <View style={[st.sheetHead, { borderBottomColor: c.line }]}>
          <Text style={[st.sheetTitle, { color: c.ink }]}>Settings</Text>
          <Chip c={c} label="Done" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={st.sheetBody} keyboardShouldPersistTaps="handled">
          <Section c={c} title="Server">
            <Text style={[st.hint, { color: c.muted }]}>The address of your Hanashi server, for example https://hanashi.example.com</Text>
            <TextInput
              value={settings.serverUrl}
              onChangeText={(v) => update({ serverUrl: v })}
              placeholder="https://…"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[st.field, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
            />
            <TextInput
              value={settings.token}
              onChangeText={(v) => update({ token: v })}
              placeholder="App token (HANASHI_APP_TOKEN)"
              placeholderTextColor={c.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={[st.field, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Chip c={c} label="Test connection" onPress={runTest} />
              <Text style={{ color: c.muted, fontSize: 13, flex: 1 }}>{test}</Text>
            </View>
          </Section>

          <Section c={c} title="Your level">
            <Segmented c={c} value={settings.level} onChange={(level) => update({ level })}
              options={[{ value: "beginner", label: "N5–N4" }, { value: "intermediate", label: "N3" }, { value: "advanced", label: "N2–N1" }]} />
          </Section>
          <Section c={c} title="How Hana talks">
            <Segmented c={c} value={settings.style} onChange={(style) => update({ style })}
              options={[{ value: "casual", label: "Casual タメ口" }, { value: "polite", label: "Polite です・ます" }]} />
          </Section>
          <Section c={c} title="Speaking speed">
            <Segmented c={c} value={settings.rate} onChange={(rate) => update({ rate })}
              options={[{ value: 0.8, label: "Slow" }, { value: 0.95, label: "Relaxed" }, { value: 1.05, label: "Natural" }]} />
          </Section>
          <Section c={c} title="Conversation">
            <ToggleRow c={c} label="Hands-free" hint="Hana listens again as soon as she finishes talking." value={settings.handsFree} onChange={(handsFree) => update({ handsFree })} />
            <ToggleRow c={c} label="Read replies aloud" value={settings.voiceOn} onChange={(voiceOn) => { update({ voiceOn }); if (!voiceOn) hush(); }} />
            <ToggleRow c={c} label="Show hiragana readings" value={settings.showReading} onChange={(showReading) => update({ showReading })} />
          </Section>
          <Pressable onPress={onNewChat} style={[st.wide, { borderColor: c.ai }]}>
            <Text style={{ color: c.ai, fontWeight: "700", fontSize: 16 }}>Start a new conversation</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function NotesSheet({
  c,
  visible,
  notes,
  onClear,
  onClose,
  onPlay,
}: {
  c: Colors;
  visible: boolean;
  notes: Note[];
  onClear: () => void;
  onClose: () => void;
  onPlay: (t: string) => void;
}) {
  const confirmClear = () =>
    Alert.alert("Clear all notes?", "This removes every saved correction.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: onClear },
    ]);
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[st.fill, { backgroundColor: c.surface }]} edges={["top", "bottom", "left", "right"]}>
        <View style={[st.sheetHead, { borderBottomColor: c.line }]}>
          <Text style={[st.sheetTitle, { color: c.ink }]}>Notes</Text>
          {notes.length > 0 && <Chip c={c} label="Clear" onPress={confirmClear} />}
          <Chip c={c} label="Done" onPress={onClose} />
        </View>
        <FlatList
          data={notes}
          keyExtractor={(n) => String(n.at) + n.from}
          contentContainerStyle={st.sheetBody}
          ListEmptyComponent={
            <Text style={{ color: c.muted, fontSize: 15, lineHeight: 22 }}>
              When Hana spots a mistake, the better way to say it is saved here so you can review it later.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => onPlay(item.to)} style={[st.note, { borderColor: c.line }]}>
              <Text style={{ color: c.muted, textDecorationLine: "line-through", fontSize: 14 }}>{item.from}</Text>
              <Text style={{ color: c.ink, fontSize: 17, lineHeight: 26 }}>{item.to}</Text>
              {!!item.why && <Text style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>{item.why}</Text>}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

function Section({ c, title, children }: { c: Colors; title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.muted, fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>{title.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  list: { padding: 16, paddingBottom: 8 },
  composer: { paddingHorizontal: 16, paddingTop: 10, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
  status: { fontSize: 13 },
  sug: { borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 260 },
  row: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 17 },
  send: { height: 44, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  controls: { flexDirection: "row", alignItems: "center", paddingBottom: 8 },
  side: { flex: 1 },
  mic: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", elevation: 3, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  micIcon: { alignItems: "center" },
  micHead: { width: 16, height: 26, borderRadius: 8, borderWidth: 3 },
  micStem: { width: 3, height: 7, marginTop: 2, borderRadius: 2 },
  stopIcon: { width: 22, height: 22, borderRadius: 4 },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetTitle: { flex: 1, fontSize: 20, fontWeight: "700" },
  sheetBody: { padding: 16, gap: 22 },
  hint: { fontSize: 13, lineHeight: 19 },
  field: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  wide: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  note: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4, marginBottom: 10 },
});
