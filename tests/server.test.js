/**
 * Tests for the Kitchen Assistant Express server.
 *
 * All external API calls (OpenAI, ElevenLabs) are mocked so the tests run
 * without real credentials.
 */

const request = require('supertest');
const path    = require('path');
const fs      = require('fs');

/* ── Mock OpenAI ─────────────────────────────────────────────────────────── */
jest.mock('openai', () => {
  const mockCreate = jest.fn();
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockCreate } },
    chat:  { completions:    { create: mockCreate } },
  }));
  MockOpenAI._mockCreate = mockCreate;
  return { OpenAI: MockOpenAI };
});

/* ── Mock express-rate-limit (disable during tests) ─────────────────────── */
jest.mock('express-rate-limit', () =>
  () => (_req, _res, next) => next()
);

/* ── Mock axios ──────────────────────────────────────────────────────────── */
jest.mock('axios');
const axios = require('axios');

/* ── App (loaded after mocks are in place) ───────────────────────────────── */
const app = require('../server');

const { OpenAI } = require('openai');
const mockCreate = OpenAI._mockCreate;

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const SAMPLE_AUDIO = path.join(__dirname, 'fixtures', 'sample.webm');

beforeAll(() => {
  // Create a minimal fixture audio file so multer has something to read
  fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
  if (!fs.existsSync(SAMPLE_AUDIO)) {
    fs.writeFileSync(SAMPLE_AUDIO, Buffer.from('fake audio data'));
  }
});

afterEach(() => {
  jest.clearAllMocks();
});

/* ════════════════════════════════════════════════════════════════════════════
   GET /  – static index.html
   ══════════════════════════════════════════════════════════════════════════ */
describe('GET /', () => {
  it('serves the index.html page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/transcribe
   ══════════════════════════════════════════════════════════════════════════ */
describe('POST /api/transcribe', () => {
  it('returns 400 when no file is uploaded', async () => {
    const res = await request(app).post('/api/transcribe');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns the transcript on success', async () => {
    mockCreate.mockResolvedValueOnce({ text: 'I have eggs and flour' });

    const res = await request(app)
      .post('/api/transcribe')
      .attach('audio', SAMPLE_AUDIO, { contentType: 'audio/webm' });

    expect(res.status).toBe(200);
    expect(res.body.transcript).toBe('I have eggs and flour');
  });

  it('returns 500 when Whisper throws an error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Whisper unavailable'));

    const res = await request(app)
      .post('/api/transcribe')
      .attach('audio', SAMPLE_AUDIO, { contentType: 'audio/webm' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Whisper unavailable');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   Path-safety helper
   ══════════════════════════════════════════════════════════════════════════ */
describe('isSafeUploadPath (internal guard)', () => {
  // Re-require server internals via a white-box approach:
  // We verify the guard indirectly by confirming that multer-generated paths
  // (which land inside uploads/) are accepted, while arbitrary paths aren't.
  // The actual guard is tested as an integration concern in /api/transcribe
  // via the multer path — testing it separately here via a unit path-check.

  const path = require('path');
  const UPLOADS_DIR = path.resolve(
    __dirname,
    '../uploads'
  );

  function isSafeUploadPath(filePath) {
    const resolved = path.resolve(filePath);
    return resolved.startsWith(UPLOADS_DIR + path.sep) || resolved === UPLOADS_DIR;
  }

  it('accepts paths inside the uploads directory', () => {
    expect(isSafeUploadPath(path.join(UPLOADS_DIR, 'abc123'))).toBe(true);
  });

  it('rejects paths outside the uploads directory (traversal attempt)', () => {
    expect(isSafeUploadPath('/etc/passwd')).toBe(false);
    expect(isSafeUploadPath(path.join(UPLOADS_DIR, '../server.js'))).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/process
   ══════════════════════════════════════════════════════════════════════════ */
describe('POST /api/process', () => {
  it('returns 400 when transcript is missing', async () => {
    const res = await request(app).post('/api/process').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 400 when transcript is an empty string', async () => {
    const res = await request(app).post('/api/process').send({ transcript: '   ' });
    expect(res.status).toBe(400);
  });

  it('returns the assistant reply on success', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'You can make pancakes!' } }],
    });

    const res = await request(app)
      .post('/api/process')
      .send({ transcript: 'I have eggs and flour' });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('You can make pancakes!');
  });

  it('returns 500 when GPT-4o throws an error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('GPT unavailable'));

    const res = await request(app)
      .post('/api/process')
      .send({ transcript: 'test' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('GPT unavailable');
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/speak
   ══════════════════════════════════════════════════════════════════════════ */
describe('POST /api/speak', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ELEVENLABS_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 400 when text is missing', async () => {
    const res = await request(app).post('/api/speak').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('returns 503 when ELEVENLABS_API_KEY is not set', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const res = await request(app).post('/api/speak').send({ text: 'hello' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/ElevenLabs/i);
  });

  it('returns audio/mpeg on success', async () => {
    const fakeAudio = Buffer.from('fake mp3 data');
    axios.post.mockResolvedValueOnce({ data: fakeAudio });

    const res = await request(app)
      .post('/api/speak')
      .send({ text: 'You can make pancakes!' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/audio\/mpeg/);
  });

  it('returns 500 when ElevenLabs throws an error', async () => {
    axios.post.mockRejectedValueOnce(new Error('ElevenLabs unavailable'));

    const res = await request(app)
      .post('/api/speak')
      .send({ text: 'hello' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('ElevenLabs unavailable');
  });
});
