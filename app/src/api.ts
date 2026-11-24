import { fetch } from "expo/fetch";

export type Level = "beginner" | "intermediate" | "advanced";
export type Style = "casual" | "polite";
export type Turn = { role: "user" | "assistant"; content: string };

export type Check = {
  ok: boolean;
  corrected?: string | null;
  natural?: string | null;
  notes?: string[];
};

export type Meta = {
  reply: string;
  reading?: string;
  en?: string;
  explain?: string | null;
  check?: Check | null;
};

type Conn = { serverUrl: string; token: string };

const base = (url: string) => url.trim().replace(/\/+$/, "");
const headers = (token: string) => ({
  "Content-Type": "application/json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** Streams one reply from Hana. Resolves with the final reply and notes. */
export async function streamChat(
  conn: Conn,
  body: { messages: Turn[]; level: Level; style: Style },
  onDelta: (text: string) => void,
  signal: AbortSignal,
): Promise<Meta> {
  const res = await fetch(`${base(conn.serverUrl)}/chat`, {
    method: "POST",
    headers: { ...headers(conn.token), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (res.status === 401) throw new Error("The app token doesn't match the server's. Check it in Settings.");
  if (!res.ok || !res.body) throw new Error(`The server answered with an error (${res.status}).`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let meta: Meta | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === "text") onDelta(ev.delta);
      else if (ev.type === "meta") meta = ev as Meta;
      else if (ev.type === "error") throw new Error(ev.message);
    }
  }
  if (!meta) throw new Error("The reply was cut off. Try again.");
  return meta;
}

export async function getSuggestions(
  conn: Conn,
  body: { messages: Turn[]; level: Level; style: Style },
): Promise<{ jp: string; en: string }[]> {
  const res = await fetch(`${base(conn.serverUrl)}/suggest`, {
    method: "POST",
    headers: headers(conn.token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Couldn't get suggestions. Try again.");
  return (await res.json()) as { jp: string; en: string }[];
}

export async function checkServer(conn: Conn): Promise<string> {
  const res = await fetch(`${base(conn.serverUrl)}/health`);
  if (!res.ok) throw new Error(`Server answered ${res.status}.`);
  const j = (await res.json()) as { model?: string };
  return j.model ?? "ok";
}
