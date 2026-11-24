"""Hanashi conversation server.

Holds the Claude API key so it never ships inside the phone app, and streams
Hana's replies back as Server-Sent Events:

    data: {"type": "text", "delta": "..."}     Hana's spoken reply, as it is written
    data: {"type": "meta", ...}                reading, translation, correction
    data: {"type": "done"}
    data: {"type": "error", "message": "..."}

Run locally:  uvicorn hanashi_server:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import AsyncIterator, Literal

import anthropic
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

load_dotenv()

MODEL = os.environ.get("HANASHI_MODEL", "claude-opus-5-5")
# Conversation needs speed more than deep reasoning, so default to low effort.
EFFORT = os.environ.get("HANASHI_EFFORT", "low")
APP_TOKEN = os.environ.get("HANASHI_APP_TOKEN", "")
MAX_TURNS = 40  # older turns are dropped to keep requests small and fast
DELIM = "###"

client = anthropic.AsyncAnthropic()
app = FastAPI(title="Hanashi")


# ---------------------------------------------------------------- prompt

LEVELS = {
    "beginner": "Beginner (around JLPT N5–N4). Use short, simple sentences, basic vocabulary and common kanji. Speak slowly and clearly.",
    "intermediate": "Intermediate (around JLPT N3). Use everyday natural Japanese with common kanji and some casual expressions.",
    "advanced": "Advanced (around JLPT N2–N1). Talk exactly as you would with a Japanese friend: idioms, slang and nuance are welcome.",
}
STYLES = {
    "casual": "Casual plain form (タメ口), the way close friends talk.",
    "polite": "Friendly polite form (です／ます), the way you talk to someone you've just met.",
}

PERSONA = """You are ハナ (Hana), a 26-year-old Japanese woman who lives in Kichijōji, Tokyo, and works at a small design studio. You love ramen, cafés, live music, onsen trips and walking around old neighbourhoods. You are chatting with a friend who is learning Japanese and wants natural, free-flowing conversation, exactly like talking to a local friend.

How you talk:
- Like a real friend, not a teacher. React naturally (えー！, いいね, そうなんだ, マジで？), share your own opinions and little stories from your life, and ask follow-up questions out of real curiosity.
- Any topic is fine: daily life, food, travel, work, culture, slang, news, feelings. When your friend asks about Japan or how Japanese people really say or do something, answer like a knowledgeable local. If you are not sure, say so.
- Keep each reply short and spoken: 1–3 sentences, the length of a turn in a real conversation. No lists, no markdown, no romaji, no English in the spoken reply.
- Never correct mistakes inside your spoken reply. Corrections go in the notes below; your reply just carries on the conversation.
- Their lines come from phone speech recognition, so missing punctuation, odd spacing or the wrong kanji for a word that sounds the same are transcription noise, not mistakes. Never comment on them.
- If they switch to English or ask what something means, how to say something, or about grammar, answer briefly in simple Japanese in the reply, and put a clear English explanation in "explain".

Your friend's level: {level}
Speak in: {style}

Every response has exactly this shape:
1. Your spoken reply in Japanese.
2. A line containing only ###
3. One JSON object and nothing after it:
{{"reading": "your reply written entirely in hiragana and katakana",
  "en": "natural English translation of your reply",
  "explain": "English explanation if they asked a language question, otherwise null",
  "check": {{"ok": true or false,
            "corrected": "their last line with real mistakes fixed, or null if ok",
            "natural": "how a native speaker would most naturally say it, or null if theirs was already natural",
            "notes": ["one short English explanation per fix, at most 3"]}}}}

Judge only their latest line, and only real mistakes: particles, conjugation, word choice, word order, politeness mismatches, unnatural phrasing. If the line is correct, set ok to true and corrected to null; give "natural" only when a native would clearly say it differently. If their line was in English, set ok to true, corrected to null and put the natural Japanese for it in "natural"."""


def system_prompt(level: str, style: str) -> str:
    return PERSONA.format(level=LEVELS[level], style=STYLES[style])


# ---------------------------------------------------------------- request model


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[Turn] = Field(min_length=1, max_length=400)
    level: Literal["beginner", "intermediate", "advanced"] = "intermediate"
    style: Literal["casual", "polite"] = "casual"


def check_token(authorization: str = Header(default="")) -> None:
    if APP_TOKEN and authorization != f"Bearer {APP_TOKEN}":
        raise HTTPException(status_code=401, detail="Wrong or missing app token.")


def build_messages(turns: list[Turn]) -> list[dict]:
    """Trim history, start on a user turn, and merge same-role neighbours."""
    turns = turns[-MAX_TURNS:]
    out: list[dict] = []
    if turns[0].role == "assistant":
        out.append({"role": "user", "content": "（会話スタート）"})
    for t in turns:
        if out and out[-1]["role"] == t.role:
            out[-1]["content"] += "\n" + t.content
        else:
            out.append({"role": t.role, "content": t.content})
    if out[-1]["role"] != "user":
        raise HTTPException(status_code=400, detail="The last message must be the learner's.")
    return out


# ---------------------------------------------------------------- streaming


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def parse_meta(tail: str) -> dict | None:
    start, end = tail.find("{"), tail.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        meta = json.loads(tail[start : end + 1])
    except json.JSONDecodeError:
        return None
    return meta if isinstance(meta, dict) else None


class ReplySplitter:
    """Passes through the spoken part of the reply and holds back everything
    after the ### delimiter (plus any trailing '#' that may be its start)."""

    def __init__(self) -> None:
        self.full = ""
        self.sent = 0
        self.closed = False

    def feed(self, delta: str) -> str:
        self.full += delta
        if self.closed:
            return ""
        cut = self.full.find(DELIM)
        if cut >= 0:
            self.closed = True
            limit = cut
        else:
            limit = len(self.full.rstrip("#"))
        out = self.full[self.sent : limit]
        self.sent = max(self.sent, limit)
        return out

    def flush(self) -> str:
        """At the end of the stream, release anything still held back."""
        cut = self.full.find(DELIM)
        limit = cut if cut >= 0 else len(self.full)
        out = self.full[self.sent : limit] if limit > self.sent else ""
        self.sent = max(self.sent, limit)
        return out

    def result(self) -> tuple[str, dict | None]:
        cut = self.full.find(DELIM)
        spoken = (self.full if cut < 0 else self.full[:cut]).strip()
        meta = parse_meta(self.full[cut + len(DELIM) :]) if cut >= 0 else None
        return spoken, meta


async def reply_stream(req: ChatRequest) -> AsyncIterator[str]:
    splitter = ReplySplitter()
    try:
        async with client.beta.messages.stream(
            model=MODEL,
            max_tokens=4000,
            system=system_prompt(req.level, req.style),
            messages=build_messages(req.messages),
            output_config={"effort": EFFORT},
            cache_control={"type": "ephemeral"},
            # If a safety classifier declines, the API retries on a suitable model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        ) as stream:
            async for text in stream.text_stream:
                piece = splitter.feed(text)
                if piece:
                    yield sse({"type": "text", "delta": piece})
            final = await stream.get_final_message()

        if final.stop_reason == "refusal":
            yield sse({"type": "error", "message": "Hana couldn't answer that. Try saying it another way."})
            return
        rest = splitter.flush()
        spoken, meta = splitter.result()
        if rest.strip():
            yield sse({"type": "text", "delta": rest})
        yield sse({"type": "meta", "reply": spoken, **(meta or {})})
        yield sse({"type": "done"})
    except anthropic.RateLimitError:
        yield sse({"type": "error", "message": "Too many messages at once. Wait a few seconds and try again."})
    except anthropic.AuthenticationError:
        yield sse({"type": "error", "message": "The server's Claude API key is missing or wrong."})
    except anthropic.APIStatusError as e:
        yield sse({"type": "error", "message": f"Claude returned an error ({e.status_code}). Try again."})
    except anthropic.APIConnectionError:
        yield sse({"type": "error", "message": "The server couldn't reach Claude. Try again."})


# ---------------------------------------------------------------- routes


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": MODEL}


@app.post("/chat", dependencies=[Depends(check_token)])
async def chat(req: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        reply_stream(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


_SUGGEST_PROMPT = """A Japanese learner ({level}) is chatting with their friend Hana in {style} Recent conversation:
{history}

Suggest 3 different short, natural things the learner could say next. Reply with only a JSON array: [{{"jp": "...", "en": "..."}}]"""


@app.post("/suggest", dependencies=[Depends(check_token)])
async def suggest(req: ChatRequest) -> list[dict]:
    history = "\n".join(
        ("Learner: " if t.role == "user" else "Hana: ") + t.content for t in req.messages[-8:]
    )
    try:
        msg = await client.messages.create(
            model=MODEL,
            max_tokens=2000,
            output_config={"effort": EFFORT},
            messages=[{"role": "user", "content": _SUGGEST_PROMPT.format(
                level=LEVELS[req.level], style=STYLES[req.style], history=history)}],
        )
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail="Couldn't get suggestions. Try again.") from e
    text = "".join(b.text for b in msg.content if b.type == "text")
    match = re.search(r"\[.*\]", text, re.S)
    try:
        items = json.loads(match.group(0)) if match else []
    except json.JSONDecodeError:
        items = []
    return [
        {"jp": str(i["jp"]), "en": str(i.get("en", ""))}
        for i in items
        if isinstance(i, dict) and i.get("jp")
    ][:3]


# The iPhone/Android web app (add it to your home screen from Safari).
# Mounted last so the API routes above take priority.
app.mount("/", StaticFiles(directory=Path(__file__).parent / "web", html=True), name="web")
