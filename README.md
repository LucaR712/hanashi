# Hanashi

Hanashi (話し) is a phone app for practising spoken Japanese. You talk with Hana, a 26-year-old friend who lives in Kichijōji, Tokyo. You can talk about anything, ask her about life in Japan, and get gentle corrections on what you said.

- **Voice first.** Tap the mic and speak Japanese. Your phone turns your speech into text.
- **Fast replies.** Hana's reply streams in, and she starts speaking after the first sentence.
- **Hands-free mode.** When Hana finishes talking, the app starts listening again, so it flows like a phone call.
- **Corrections without interruptions.** Hana answers like a friend and never lectures. Corrections appear under your message: a fixed version, a more natural version, and a short English explanation. Every correction is saved to **Notes**.
- **Ask anything.** Questions like "what does やばい really mean?" or "how do I say 'I'm exhausted'?" get an answer in Japanese plus an English explanation card.
- **Reading help.** Every reply shows a hiragana reading and has an English translation button.
- **Help me reply.** Shows three things you could say next.
- **Settings:** level (N5–N4, N3, N2–N1), casual or polite Japanese, and speaking speed.

```
hanashi/
├── server/   Python (FastAPI). Holds your Claude API key and talks to Claude.
└── app/      React Native (Expo) phone app for iPhone and Android.
```

The phone never holds your Claude API key. The app talks to your server, and the server talks to Claude.

---

## 1. Run the server

You need a Claude API key from https://platform.claude.com.

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Open `.env` and fill in two values:

- `ANTHROPIC_API_KEY`: your Claude API key.
- `HANASHI_APP_TOKEN`: any long random string you make up. The app sends it with every request, so strangers can't use your key.

Then start the server:

```bash
uvicorn hanashi_server:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000/health in a browser. It should say `{"ok": true, ...}`.

### Put it online (recommended)

To use the app away from home, deploy the server anywhere that runs a Dockerfile, such as Render, Railway or Fly.io. Point the host at the `server/` folder and set `ANTHROPIC_API_KEY` and `HANASHI_APP_TOKEN` as environment variables. You'll get an `https://…` address to enter in the app.

For testing at home, your phone and computer must be on the same Wi-Fi. Use `http://<your computer's local IP>:8000`, for example `http://192.168.1.20:8000`.

### Model and cost

The server uses Claude Opus 5.5 at low effort, which keeps replies quick. You can change this in `.env` with `HANASHI_MODEL` and `HANASHI_EFFORT`. Each turn sends the recent conversation, up to 40 messages. Prompt caching is on to keep repeat costs down.

If a request is ever declined by a safety check, the server's automatic fallback retries it on another suitable model.

---

## 2a. iPhone without a Mac: add Hanashi to your Home Screen (free)

The server also serves Hanashi as a web app. It uses Safari's built-in Japanese speech recognition and Japanese voice, and works like an app from your Home Screen. You don't need a Mac, an Apple Developer account or the App Store.

1. Put the server online (see "Put it online" above). The microphone only works over `https://`.
2. On your iPhone, open your server's address in **Safari**, for example `https://hanashi-xyz.onrender.com`.
3. Tap **Share → Add to Home Screen → Add**. Hanashi now has its own 話 icon and opens full screen.
4. Open it from the Home Screen. Enter your app token in Settings and tap the mic. Allow the microphone and speech recognition when asked.

If the mic doesn't work from the Home Screen icon, use the same address in a normal Safari tab. A few iOS versions only allow speech recognition there.

Sometimes iPhone won't let the page start listening by itself after Hana speaks. When that happens, the app asks you to tap the mic for each turn. Everything else works the same.

If you use Render's free plan, the server sleeps when unused. The first message after a break can take about a minute to arrive.

---

## 2b. Install the native app on your phone

Speech recognition is native code, so the app **does not run in Expo Go**. You need your own build. It's free for Android. For iPhone it's free with a Mac, or needs a paid Apple Developer account otherwise.

```bash
cd app
npm install
```

First change `com.example.hanashi` in `app.json` to your own identifier, for example `com.yourname.hanashi`.

### Android, no computer setup needed (EAS cloud build)

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest build -p android --profile preview
```

When the build finishes, open the link on your phone and install the APK.

### Android, built locally (Android Studio installed, phone plugged in)

```bash
npx expo run:android --device
```

### iPhone with a Mac and Xcode

Plug the phone in. A free Apple ID works, but the app has to be reinstalled every 7 days.

```bash
npx expo run:ios --device
```

### iPhone without a Mac

This needs a paid Apple Developer account. The command walks you through registering your phone.

```bash
npx eas-cli@latest build -p ios --profile preview
```

### First launch

Settings opens automatically. Enter your **server address** and **app token**, then tap **Test connection**. Close Settings and tap the mic.

---

## How it works

1. The phone's own speech recognizer (`expo-speech-recognition`, set to Japanese) turns your voice into text. Recognition stops when you pause, or when you tap the mic again.
2. The app sends the conversation to `POST /chat`. The server streams Claude's reply back as Server-Sent Events.
3. Claude writes Hana's spoken reply first, then a `###` line, then a JSON object with the reading, translation, explanation and correction. The server streams the spoken part immediately and sends the JSON at the end, so the voice can start before the notes arrive.
4. The app speaks each finished sentence with the phone's Japanese voice (`expo-speech`). In hands-free mode it starts listening again when the voice finishes.

**Better voice:** on iPhone, go to Settings → Accessibility → Spoken Content → Voices → Japanese and download an "Enhanced" or "Premium" voice. Hanashi picks it automatically.

---

## Files

| File | What it does |
|---|---|
| `server/web/index.html` | The Home Screen web app for iPhone (and any phone browser) |
| `server/hanashi_server.py` | Hana's persona, `/chat` (streaming reply and corrections), `/suggest`, `/health` |
| `app/App.tsx` | Main screen, microphone, hands-free loop, Settings and Notes |
| `app/src/api.ts` | Talks to the server and reads the stream |
| `app/src/voice.ts` | Speaks sentence by sentence and reports when speech finishes |
| `app/src/store.ts` | Settings, chat history and notes saved on the phone |
| `app/src/ui.tsx` | Chat bubbles, correction cards and controls |
