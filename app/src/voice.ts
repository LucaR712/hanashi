import * as Speech from "expo-speech";

/**
 * Speaks Hana's reply sentence by sentence as it streams in, and tells the
 * app when everything queued has finished so hands-free mode can listen again.
 */
let generation = 0;
let pending = 0;
let idleListener: (() => void) | null = null;
let voiceId: string | undefined;

export function onSpeechIdle(fn: (() => void) | null) {
  idleListener = fn;
}

export function isSpeaking() {
  return pending > 0;
}

export async function pickJapaneseVoice() {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const ja = voices.filter((v) => v.language?.toLowerCase().startsWith("ja"));
    // Prefer enhanced / higher-quality voices where the phone has them.
    ja.sort((a, b) => (b.quality === "Enhanced" ? 1 : 0) - (a.quality === "Enhanced" ? 1 : 0));
    voiceId = ja[0]?.identifier;
  } catch {
    voiceId = undefined;
  }
}

export function say(text: string, rate: number) {
  const t = text.trim();
  if (!t) return;
  const gen = generation;
  pending++;
  const done = () => {
    if (gen !== generation) return;
    pending = Math.max(0, pending - 1);
    if (pending === 0) idleListener?.();
  };
  Speech.speak(t, {
    language: "ja-JP",
    voice: voiceId,
    rate,
    onDone: done,
    onStopped: done,
    onError: done,
  });
}

/** Stops speaking without triggering the idle listener. */
export function hush() {
  generation++;
  pending = 0;
  void Speech.stop();
}

/** Splits streamed text into finished sentences; returns [ready, rest]. */
export function takeSentences(text: string): [string, string] {
  let cut = -1;
  for (let i = 0; i < text.length; i++) if ("。！？!?…\n".includes(text[i])) cut = i;
  return cut < 0 ? ["", text] : [text.slice(0, cut + 1), text.slice(cut + 1)];
}
