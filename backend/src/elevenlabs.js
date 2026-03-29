import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');
const SOUNDS_DIR = path.join(__dirname, '..', 'data', 'sounds');

// Background sound prompts for ElevenLabs Sound Effects API
const BG_SOUND_PROMPTS = {
  cafe: 'Coffee shop ambience with quiet conversations, espresso machine, cups clinking, cozy indoor cafe background noise',
  rain: 'Gentle rain falling on a window, steady rainfall, calming rain sounds, light drizzle ambience',
  street: 'City street ambience, distant traffic, car horns, pedestrians walking, urban outdoor background',
  nature: 'Forest ambience with birds chirping, gentle wind through trees, leaves rustling, outdoor nature sounds',
  office: 'Quiet office ambience, keyboard typing, mouse clicks, subtle air conditioning hum, distant murmurs',
  car: 'Car interior driving sounds, road noise, engine hum, gentle vibrations, inside a moving vehicle',
  crowd: 'Busy crowd chatter, many people talking in background, indoor gathering, cocktail party ambience',
  ocean: 'Ocean waves gently crashing on beach, seagulls in distance, coastal ambience, sea breeze',
  fireplace: 'Crackling fireplace, wood burning, warm fire sounds, cozy hearth ambience, popping embers',
};

// Auto-detect ffmpeg path
function findFfmpeg() {
  const candidates = ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg'];
  for (const cmd of candidates) {
    try {
      execSync(`${cmd} -version`, { stdio: 'pipe' });
      return cmd;
    } catch {}
  }
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

// Generate or get cached background sound
async function getBackgroundSound(apiKey, soundId) {
  if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });

  // Check for custom sound first
  if (soundId.startsWith('custom-')) {
    const customPath = path.join(SOUNDS_DIR, `${soundId}.mp3`);
    if (fs.existsSync(customPath)) {
      console.log(`Using custom background sound: ${soundId}`);
      return customPath;
    }
    console.warn(`Custom sound not found: ${soundId}`);
    return null;
  }

  if (!BG_SOUND_PROMPTS[soundId]) return null;

  const cachedPath = path.join(SOUNDS_DIR, `${soundId}.mp3`);

  // Return cached version if it exists
  if (fs.existsSync(cachedPath)) {
    console.log(`Using cached background sound: ${soundId}`);
    return cachedPath;
  }

  // Generate via ElevenLabs Sound Effects API
  console.log(`Generating background sound: ${soundId}...`);
  const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: BG_SOUND_PROMPTS[soundId],
      duration_seconds: 15,
      prompt_influence: 0.4,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Failed to generate background sound ${soundId}: ${errText}`);
    return null;
  }

  const audioBuffer = await response.arrayBuffer();
  fs.writeFileSync(cachedPath, Buffer.from(audioBuffer));
  console.log(`Cached background sound: ${soundId} (${Math.round(audioBuffer.byteLength / 1024)}KB)`);
  return cachedPath;
}

// Mix voice audio with background sound using ffmpeg
function mixAudioWithBackground(ffmpeg, voicePath, bgPath, outputPath, outputFormat = 'mp3', bgVolume = 0.15) {
  const vol = Math.max(0, Math.min(1, bgVolume));
  if (outputFormat === 'ogg') {
    execSync(
      `${ffmpeg} -y -i "${voicePath}" -stream_loop -1 -i "${bgPath}" -filter_complex "[1:a]volume=${vol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[out]" -map "[out]" -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip -vbr constrained -frame_duration 60 "${outputPath}"`,
      { stdio: 'pipe' }
    );
  } else {
    execSync(
      `${ffmpeg} -y -i "${voicePath}" -stream_loop -1 -i "${bgPath}" -filter_complex "[1:a]volume=${vol}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[out]" -map "[out]" -c:a libmp3lame -b:a 128k "${outputPath}"`,
      { stdio: 'pipe' }
    );
  }
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

const HUMAN_VOICE_SETTINGS = {
  stability: 0.38,
  similarity_boost: 0.72,
  style: 0.55,
  use_speaker_boost: true,
  speed: 0.9,
};

function normalizeSpeechText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/([,;:.!?])(?=\S)/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function generateVoiceNote(apiKey, text, voiceId, modelId, backgroundSound, bgVolume = 0.15) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const ffmpeg = getFfmpeg();
  const fileId = uuid();
  const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
  const oggPath = path.join(TEMP_DIR, `${fileId}.ogg`);
  const mixedOggPath = path.join(TEMP_DIR, `${fileId}-mixed.ogg`);

  try {
    const model = modelId || 'eleven_v3';
    const preparedText = normalizeSpeechText(text);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: preparedText,
          model_id: model,
          voice_settings: HUMAN_VOICE_SETTINGS,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
    }

    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(mp3Path, Buffer.from(audioBuffer));

    // Check for background sound
    let bgPath = null;
    if (backgroundSound && backgroundSound !== 'none') {
      bgPath = await getBackgroundSound(apiKey, backgroundSound);
    }

    if (bgPath) {
      // Mix voice with background and output as OGG
      mixAudioWithBackground(ffmpeg, mp3Path, bgPath, mixedOggPath, 'ogg');
      const oggBuffer = fs.readFileSync(mixedOggPath);
      return oggBuffer;
    } else {
      // No background — convert to WhatsApp-safe OGG Opus
      // Use voip application mode + constrained VBR for maximum WhatsApp compatibility
      execSync(
        `${ffmpeg} -y -i "${mp3Path}" -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip -vbr constrained -frame_duration 60 "${oggPath}"`,
        { stdio: 'pipe' }
      );
      const oggBuffer = fs.readFileSync(oggPath);
      // Validate output is non-trivial
      if (oggBuffer.length < 200) {
        throw new Error('Generated audio file is too small — likely corrupted');
      }
      return oggBuffer;
    }
  } finally {
    try { fs.unlinkSync(mp3Path); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}
    try { fs.unlinkSync(mixedOggPath); } catch {}
  }
}

// Generate MP3 preview (not converted to OGG, for browser playback)
export async function generatePreviewAudio(apiKey, text, voiceId, modelId, backgroundSound) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const ffmpeg = getFfmpeg();
  const model = modelId || 'eleven_v3';
  const preparedText = normalizeSpeechText(text);
  const fileId = uuid();
  const voiceMp3Path = path.join(TEMP_DIR, `${fileId}-voice.mp3`);
  const mixedMp3Path = path.join(TEMP_DIR, `${fileId}-mixed.mp3`);

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: preparedText,
          model_id: model,
          voice_settings: HUMAN_VOICE_SETTINGS,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs API error ${response.status}: ${errText}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    // Check for background sound
    let bgPath = null;
    if (backgroundSound && backgroundSound !== 'none') {
      bgPath = await getBackgroundSound(apiKey, backgroundSound);
    }

    if (bgPath) {
      // Write voice to temp file for mixing
      fs.writeFileSync(voiceMp3Path, audioBuffer);
      mixAudioWithBackground(ffmpeg, voiceMp3Path, bgPath, mixedMp3Path, 'mp3');
      return fs.readFileSync(mixedMp3Path);
    } else {
      return audioBuffer;
    }
  } finally {
    try { fs.unlinkSync(voiceMp3Path); } catch {}
    try { fs.unlinkSync(mixedMp3Path); } catch {}
  }
}
