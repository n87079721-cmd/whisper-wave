import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');

// Auto-detect ffmpeg path
function findFfmpeg() {
  const candidates = ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} -version`, { stdio: 'pipe' });
      return cmd;
    } catch {}
  }
  // Try which/where
  try {
    return execSync('which ffmpeg', { stdio: 'pipe' }).toString().trim();
  } catch {}
  throw new Error('ffmpeg not found. Install ffmpeg on your system.');
}

let ffmpegPath = null;

function getFfmpeg() {
  if (!ffmpegPath) ffmpegPath = findFfmpeg();
  return ffmpegPath;
}

// Available voices for the API
export const VOICES = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', desc: 'Warm, authoritative', gender: 'male' },
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', desc: 'Friendly, natural', gender: 'female' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', desc: 'Calm, professional', gender: 'male' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', desc: 'Gentle, soothing', gender: 'female' },
  { id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger', desc: 'Deep, confident', gender: 'male' },
  { id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura', desc: 'Clear, bright', gender: 'female' },
  { id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie', desc: 'Energetic, youthful', gender: 'male' },
  { id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum', desc: 'Smooth, narrative', gender: 'male' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', desc: 'Non-binary, calm', gender: 'neutral' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice', desc: 'Warm, British', gender: 'female' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', desc: 'Warm, storytelling', gender: 'female' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', desc: 'Authoritative, deep', gender: 'male' },
];

export async function generateVoiceNote(apiKey, text, voiceId, modelId) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const ffmpeg = getFfmpeg();
  const fileId = uuid();
  const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
  const oggPath = path.join(TEMP_DIR, `${fileId}.ogg`);

  try {
    // Use eleven_v3 by default for highest quality creative output
    const model = modelId || 'eleven_v3';

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: {
            stability: 0.3,
            similarity_boost: 0.6,
            style: 0.7,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(mp3Path, Buffer.from(audioBuffer));

    // Convert MP3 → OGG/Opus for WhatsApp PTT (waveform display)
    execSync(
      `${ffmpeg} -y -i "${mp3Path}" -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip "${oggPath}"`,
      { stdio: 'pipe' }
    );

    const oggBuffer = fs.readFileSync(oggPath);
    return oggBuffer;
  } finally {
    try { fs.unlinkSync(mp3Path); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}
  }
}

// Generate MP3 preview (not converted to OGG, for browser playback)
export async function generatePreviewAudio(apiKey, text, voiceId, modelId) {
  const model = modelId || 'eleven_multilingual_v2';

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
