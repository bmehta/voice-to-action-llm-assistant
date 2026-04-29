# 🍳 Voice-to-Action Kitchen Assistant

A real-time voice-to-action web app that listens to your voice, understands your cooking intent, and suggests recipes — all powered by OpenAI Whisper, GPT-4o, and ElevenLabs.

## Features

- 🎤 **Voice capture** via the browser's MediaRecorder API
- 📝 **Speech-to-text** transcription using OpenAI Whisper
- 🤖 **Intelligent recipe suggestions** from GPT-4o (e.g. _"I have eggs and flour, what can I make?"_)
- 🔊 **Text-to-speech playback** of the assistant's response via ElevenLabs

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JavaScript |
| Backend | Node.js + Express |
| Speech-to-Text | OpenAI Whisper API (`whisper-1`) |
| LLM | OpenAI GPT-4o |
| Text-to-Speech | ElevenLabs REST API |

## Prerequisites

- Node.js 18+
- An [OpenAI API key](https://platform.openai.com/api-keys)
- An [ElevenLabs API key](https://elevenlabs.io) _(optional – TTS is gracefully disabled without it)_

## Setup

```bash
# 1. Clone and enter the repo
git clone https://github.com/bmehta/voice-to-action-llm-assistant.git
cd voice-to-action-llm-assistant

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and add your API keys

# 4. Start the server
npm start
```

Open `http://localhost:3000` in your browser (Chrome or Edge recommended for best MediaRecorder support).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | ✅ | Your OpenAI API key |
| `ELEVENLABS_API_KEY` | ⚙️ | ElevenLabs API key (TTS is disabled without it) |
| `ELEVENLABS_VOICE_ID` | ⚙️ | Voice ID to use (defaults to `21m00Tcm4TlvDq8ikWAM` — Rachel) |
| `PORT` | ⚙️ | HTTP port (defaults to `3000`) |

## API Endpoints

### `POST /api/transcribe`
Accepts a `multipart/form-data` request with an `audio` file and returns the Whisper transcript.

```json
// Response
{ "transcript": "I have eggs and flour, what can I make?" }
```

### `POST /api/process`
Accepts a JSON body `{ "transcript": "..." }` and returns GPT-4o's kitchen assistant reply.

```json
// Response
{ "reply": "You can make a classic French crêpe! Here's how…" }
```

### `POST /api/speak`
Accepts `{ "text": "..." }` and returns an `audio/mpeg` stream from ElevenLabs TTS.

## Running Tests

```bash
npm test
```

## Example Usage

1. Click **Hold to Speak** and say _"I have chicken, garlic, and lemon — what can I make?"_
2. The app transcribes your speech and sends it to GPT-4o.
3. The Kitchen Assistant replies with recipe ideas.
4. Click **🔊 Read Aloud** to hear the response via ElevenLabs TTS.
