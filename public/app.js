/* ── DOM refs ────────────────────────────────────────────────────────────── */
const recordBtn       = document.getElementById('recordBtn');
const recordLabel     = document.getElementById('recordLabel');
const statusMsg       = document.getElementById('statusMsg');
const transcriptSection = document.getElementById('transcriptSection');
const transcriptText  = document.getElementById('transcriptText');
const responseSection = document.getElementById('responseSection');
const responseText    = document.getElementById('responseText');
const speakBtn        = document.getElementById('speakBtn');
const ttsAudio        = document.getElementById('ttsAudio');
const errorSection    = document.getElementById('errorSection');
const errorText       = document.getElementById('errorText');

/* ── State ───────────────────────────────────────────────────────────────── */
let mediaRecorder = null;
let audioChunks   = [];
let isRecording   = false;

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function setStatus(msg) { statusMsg.textContent = msg; }

function showError(msg) {
  errorText.textContent = msg;
  errorSection.classList.remove('hidden');
}

function clearError() { errorSection.classList.add('hidden'); }

function setLoading(label) {
  setStatus(`${label}…`);
}

/* ── Recording toggle ────────────────────────────────────────────────────── */
recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  clearError();
  transcriptSection.classList.add('hidden');
  responseSection.classList.add('hidden');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showError('Microphone access denied. Please allow microphone access and try again.');
    return;
  }

  audioChunks = [];
  const mime = getSupportedMimeType();
  mediaRecorder = mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);

  mediaRecorder.addEventListener('dataavailable', (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  });

  mediaRecorder.addEventListener('stop', () => {
    stream.getTracks().forEach((t) => t.stop());
    handleRecordingComplete();
  });

  // Periodic timeslice so chunks arrive during recording; relying on a single final
  // blob on stop races dataavailable vs stop in some browsers and yields truncated audio
  // (Whisper then often returns nonsense like "you").
  mediaRecorder.start(250);
  isRecording = true;
  recordBtn.classList.add('recording');
  recordLabel.textContent = 'Recording…';
  setStatus('Listening — click again to stop');
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.requestData();
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.classList.remove('recording');
  recordLabel.textContent = 'Hold to Speak';
}

function getSupportedMimeType() {
  const types = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

/** Whisper/OpenAI use the multipart filename extension; map MIME → allowed ext. */
function whisperFileExtension(mimeType) {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  const map = {
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
  if (map[base]) return map[base];
  const sub = base.includes('/') ? base.split('/')[1] : base;
  const allowed = new Set(['flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm']);
  if (sub && allowed.has(sub)) return sub;
  return 'webm';
}

/* ── Pipeline: audio → transcript → GPT response ────────────────────────── */
async function handleRecordingComplete() {
  setLoading('Transcribing your voice');

  const mimeType =
    (mediaRecorder && mediaRecorder.mimeType) ||
    audioChunks[0]?.type ||
    'audio/webm';
  const audioBlob = new Blob(audioChunks, { type: mimeType });

  // 1. Transcribe with Whisper
  const transcript = await transcribeAudio(audioBlob, mimeType);
  console.log('transcript', transcript);
  if (!transcript) return;

  transcriptText.textContent = transcript;
  transcriptSection.classList.remove('hidden');

  // 2. Process with GPT-4o
  setLoading('The Kitchen Assistant is thinking');
  const reply = await processTranscript(transcript);
  if (!reply) return;

  responseText.textContent = reply;
  responseSection.classList.remove('hidden');
  setStatus('');
}

async function transcribeAudio(blob, mimeType) {
  if (!blob || blob.size === 0) {
    showError('No audio captured. Try recording again.');
    setStatus('');
    return null;
  }
  const ext = whisperFileExtension(mimeType);
  const formData = new FormData();
  formData.append('audio', blob, `recording.${ext}`);

  try {
    const res = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Transcription failed');
    return data.transcript;
  } catch (err) {
    showError(`Transcription error: ${err.message}`);
    setStatus('');
    return null;
  }
}

async function processTranscript(transcript) {
  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Processing failed');
    return data.reply;
  } catch (err) {
    showError(`Assistant error: ${err.message}`);
    setStatus('');
    return null;
  }
}

/* ── Text-to-speech via ElevenLabs ───────────────────────────────────────── */
speakBtn.addEventListener('click', async () => {
  const text = responseText.textContent;
  if (!text) return;

  speakBtn.disabled = true;
  speakBtn.innerHTML = '<span class="spinner"></span>Loading…';

  try {
    const res = await fetch('/api/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'TTS failed');
    }

    const audioBuffer = await res.arrayBuffer();
    const audioBlob   = new Blob([audioBuffer], { type: 'audio/mpeg' });
    const audioUrl    = URL.createObjectURL(audioBlob);

    ttsAudio.src = audioUrl;
    ttsAudio.hidden = false;
    await ttsAudio.play();
  } catch (err) {
    showError(`Text-to-speech error: ${err.message}`);
  } finally {
    speakBtn.disabled = false;
    speakBtn.innerHTML = '🔊 Read Aloud';
  }
});
