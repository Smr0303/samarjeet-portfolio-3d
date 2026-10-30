# samarjeet-phone agent

The voice behind the desk phone: a LiveKit Agents worker that answers as the
AI version of Samarjeet on Gemini Live. The site's `api/call-token.js` mints a
room token that dispatches this agent by name (`samarjeet-phone`).

## Deploy to LiveKit Cloud

```bash
brew install livekit-cli
lk cloud auth
echo "GOOGLE_API_KEY=<your AI Studio key>" > .env.local   # ignored by git
lk agent create            # picks up .env.local as secrets, builds, deploys
lk agent logs              # tail logs
```

LiveKit Cloud injects `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
The Vercel project needs the same three (from the LiveKit project settings) for
the token function.

## Run locally

```bash
uv sync
uv run agent.py dev        # needs LIVEKIT_* and GOOGLE_API_KEY in .env.local
```

Optional env: `GEMINI_MODEL` (default `gemini-3.8-live`), `GEMINI_VOICE` (default `Puck`).
