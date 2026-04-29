require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OpenAI, toFile } = require('openai');
const axios = require('axios');
const rateLimit = require('express-rate-limit');

const app = express();

const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const upload = multer({ dest: UPLOADS_DIR });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'not-configured' });

const KITCHEN_SYSTEM_PROMPT = `You are a friendly and knowledgeable Kitchen Assistant.
Your job is to help users with cooking questions, recipes, and ingredient suggestions.
When a user mentions ingredients they have on hand, suggest one or more recipes they can make,
including brief step-by-step instructions. Keep your responses concise, warm, and encouraging.
If the user asks about anything unrelated to cooking, food, or kitchen topics, politely
redirect them back to kitchen-related help.`;

// Rate limiter: max 30 API requests per IP per minute
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});

app.use('/api/', apiLimiter);

/** Whisper infers format from the multipart filename; multer's disk path has no extension. */
const WHISPER_EXT = new Set([
  'flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm',
]);

function transcriptionUploadName(originalname, mimetype) {
  const base = path.basename(originalname || '');
  const ext = path.extname(base).slice(1).toLowerCase();
  if (ext && WHISPER_EXT.has(ext)) {
    return base;
  }
  const mime = (mimetype || '').split(';')[0].trim().toLowerCase();
  const mimeMap = {
    'audio/webm': 'webm',
    'video/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/oga': 'oga',
    'audio/mp4': 'mp4',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'audio/m4a': 'm4a',
    'audio/mpga': 'mpga',
  };
  const fromMime = mimeMap[mime];
  if (fromMime) return `recording.${fromMime}`;
  return 'recording.webm';
}

/**
 * POST /api/transcribe
 * Accepts a multipart audio file upload, sends it to OpenAI Whisper,
 * and returns the transcript as JSON.
 */
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided.' });
  }

  // Reconstruct the path from the trusted base directory and the server-generated
  // filename only (never using req.file.path directly for I/O), preventing any
  // path-traversal risk from a manipulated multer field.
  const safeFileName = path.basename(req.file.filename);
  const safeFilePath = path.join(UPLOADS_DIR, safeFileName);

  try {
    const uploadName = transcriptionUploadName(req.file.originalname, req.file.mimetype);
    const file = await toFile(fs.createReadStream(safeFilePath), uploadName);
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });

    res.json({ transcript: transcription.text });
  } catch (err) {
    const message =
      err.response?.data?.error?.message ||
      err.error?.message ||
      err.message ||
      'Transcription failed.';
    res.status(500).json({ error: message });
  } finally {
    fs.unlink(safeFilePath, () => {});
  }
});

/**
 * POST /api/process
 * Accepts { transcript: string } and sends it to GPT-4o with the kitchen assistant
 * system prompt. Returns the assistant's response as JSON.
 */
app.post('/api/process', async (req, res) => {
  const { transcript } = req.body;

  if (!transcript || typeof transcript !== 'string' || transcript.trim() === '') {
    return res.status(400).json({ error: 'No transcript text provided.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: KITCHEN_SYSTEM_PROMPT },
        { role: 'user', content: transcript.trim() },
      ],
    });

    const reply = completion.choices[0].message.content;
    res.json({ reply });
  } catch (err) {
    const message = err.message || 'Processing failed.';
    res.status(500).json({ error: message });
  }
});

/**
 * POST /api/speak
 * Accepts { text: string } and requests TTS audio from ElevenLabs.
 * Returns the audio as an audio/mpeg stream.
 */
app.post('/api/speak', async (req, res) => {
  const { text } = req.body;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'No text provided.' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

  if (!apiKey) {
    return res.status(503).json({ error: 'ElevenLabs API key not configured.' });
  }

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text: text.trim(),
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      },
      {
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        responseType: 'arraybuffer',
      }
    );

    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(response.data));
  } catch (err) {
    const message = err.response?.data?.detail?.message || err.message || 'TTS failed.';
    res.status(500).json({ error: message });
  }
});

const PORT = process.env.PORT || 3000;

/* istanbul ignore next */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kitchen Assistant server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
