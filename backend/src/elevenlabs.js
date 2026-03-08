import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '..', 'data', 'temp');

export async function generateVoiceNote(apiKey, text, voiceId) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const fileId = uuid();
  const mp3Path = path.join(TEMP_DIR, `${fileId}.mp3`);
  const oggPath = path.join(TEMP_DIR, `${fileId}.ogg`);

  try {
    // 1. Generate TTS with ElevenLabs
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
          model_id: 'eleven_multilingual_v2',
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

    const audioBuffer = await response.arrayBuffer();
    fs.writeFileSync(mp3Path, Buffer.from(audioBuffer));

    // 2. Convert MP3 → OGG/Opus for WhatsApp PTT
    // Requires ffmpeg installed on the VPS
    execSync(
      `ffmpeg -y -i "${mp3Path}" -c:a libopus -b:a 64k -ar 48000 -ac 1 -application voip "${oggPath}"`,
      { stdio: 'pipe' }
    );

    const oggBuffer = fs.readFileSync(oggPath);
    return oggBuffer;
  } finally {
    // Cleanup temp files
    try { fs.unlinkSync(mp3Path); } catch {}
    try { fs.unlinkSync(oggPath); } catch {}
  }
}
