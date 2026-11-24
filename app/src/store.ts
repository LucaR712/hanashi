import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import type { Check, Level, Style } from "./api";

export type Settings = {
  serverUrl: string;
  token: string;
  level: Level;
  style: Style;
  rate: number;
  showReading: boolean;
  voiceOn: boolean;
  handsFree: boolean;
};

export type Msg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  reading?: string;
  en?: string;
  explain?: string | null;
  check?: Check | null;
  streaming?: boolean;
};

export type Note = { from: string; to: string; why: string; at: number };

export const defaultSettings: Settings = {
  serverUrl: String(Constants.expoConfig?.extra?.serverUrl ?? ""),
  token: "",
  level: "intermediate",
  style: "casual",
  rate: 0.95,
  showReading: true,
  voiceOn: true,
  handsFree: true,
};

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
async function loadArray<T>(key: string): Promise<T[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save(key: string, value: unknown) {
  AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => {});
}

export const loadSettings = () => load("hanashi:settings", defaultSettings);
export const saveSettings = (s: Settings) => save("hanashi:settings", s);
export const loadChat = () => loadArray<Msg>("hanashi:chat");
export const saveChat = (m: Msg[]) => save("hanashi:chat", m.slice(-200));
export const loadNotes = () => loadArray<Note>("hanashi:notes");
export const saveNotes = (n: Note[]) => save("hanashi:notes", n.slice(0, 500));

const GREETINGS: Record<Style, { text: string; reading: string; en: string }[]> = {
  casual: [
    { text: "おー、久しぶり！最近どう？", reading: "おー、ひさしぶり！さいきんどう？", en: "Oh, long time no see! How've you been?" },
    { text: "やっほー！今日なにしてた？", reading: "やっほー！きょうなにしてた？", en: "Hey! What were you up to today?" },
    { text: "ねえねえ、週末なにか予定ある？", reading: "ねえねえ、しゅうまつなにかよていある？", en: "Hey, got any plans for the weekend?" },
  ],
  polite: [
    { text: "こんにちは！ハナです。今日はどんな一日でしたか？", reading: "こんにちは！はなです。きょうはどんないちにちでしたか？", en: "Hi! I'm Hana. How was your day today?" },
    { text: "はじめまして、ハナです。日本語はどれくらい勉強していますか？", reading: "はじめまして、はなです。にほんごはどれくらいべんきょうしていますか？", en: "Nice to meet you, I'm Hana. How long have you been studying Japanese?" },
  ],
};

export function greeting(style: Style): Msg {
  const list = GREETINGS[style];
  const g = list[Math.floor(Math.random() * list.length)];
  return { id: `g${Date.now()}`, role: "assistant", text: g.text, reading: g.reading, en: g.en };
}
