#!/usr/bin/env node
/**
 * Gemini 3.1 Flash TTS — Voice generation for Midori agents
 *
 * Generates voice audio from text using Google's Gemini 3.1 Flash TTS model.
 * Each Phantom Thief agent has a unique voice profile with personality-matched
 * voice selection and audio tags.
 *
 * Output: OGG Opus file (WhatsApp/Telegram voice message compatible)
 * Requires: GEMINI_API_KEY env var, ffmpeg in container
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent';

// Agent voice assignments — each Phantom Thief gets a unique voice
const AGENT_VOICES = {
  'Futaba':  { voice: 'Leda',          style: 'bright, nerdy, efficient',     tags: '[matter-of-fact]' },
  'Haru':    { voice: 'Aoede',         style: 'warm, elegant, professional',  tags: '[warmly, gently]' },
  'Yusuke':  { voice: 'Enceladus',     style: 'dramatic, artistic, breathy',  tags: '[thoughtfully, dramatically]' },
  'Kasumi':  { voice: 'Kore',          style: 'precise, measured, firm',      tags: '[precisely, clearly]' },
  'Ryuji':   { voice: 'Puck',          style: 'energetic, direct, upbeat',    tags: '[excitedly, enthusiastically]' },
  'Morgana': { voice: 'Fenrir',        style: 'analytical, prideful',         tags: '[knowingly, seriously]' },
  'Anne':    { voice: 'Callirrhoe',    style: 'confident, bold, compassionate', tags: '[firmly, confidently]' },
  'Makoto':  { voice: 'Schedar',       style: 'even, authoritative, by-the-book', tags: '[formally, precisely]' },
  'Akechi':  { voice: 'Charon',        style: 'formal, cutting, firm',        tags: '[coolly, formally]' },
  'Joker':   { voice: 'Alnilam',       style: 'calm, authoritative, decisive', tags: '[calmly, deliberately]' },
};

const ALL_VOICES = [
  { name: 'Zephyr',         category: 'Bright' },
  { name: 'Puck',           category: 'Bright/Upbeat' },
  { name: 'Leda',           category: 'Bright' },
  { name: 'Autonoe',        category: 'Bright' },
  { name: 'Laomedeia',      category: 'Bright' },
  { name: 'Charon',         category: 'Firm/Informative' },
  { name: 'Kore',           category: 'Firm/Informative' },
  { name: 'Orus',           category: 'Firm' },
  { name: 'Rasalgethi',     category: 'Firm' },
  { name: 'Alnilam',        category: 'Firm/Informative' },
  { name: 'Enceladus',      category: 'Breathy/Smooth' },
  { name: 'Algieba',        category: 'Breathy' },
  { name: 'Despina',        category: 'Breathy' },
  { name: 'Sulafat',        category: 'Smooth' },
  { name: 'Iapetus',        category: 'Clear' },
  { name: 'Umbriel',        category: 'Clear' },
  { name: 'Erinome',        category: 'Easy-going' },
  { name: 'Aoede',          category: 'Clear/Easy-going' },
  { name: 'Callirrhoe',     category: 'Clear' },
  { name: 'Fenrir',         category: 'Excitable' },
  { name: 'Achernar',       category: 'Soft' },
  { name: 'Schedar',        category: 'Even' },
  { name: 'Gacrux',         category: 'Mature' },
  { name: 'Pulcherrima',    category: 'Forward' },
  { name: 'Achird',         category: 'Friendly' },
  { name: 'Zubenelgenubi',  category: 'Casual' },
  { name: 'Vindemiatrix',   category: 'Gentle' },
  { name: 'Sadachbia',      category: 'Lively' },
  { name: 'Sadaltager',     category: 'Knowledgeable' },
  { name: 'Algenib',        category: 'Gravelly' },
];

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--voice') parsed.voice = args[++i];
    else if (args[i] === '--agent') parsed.agent = args[++i];
    else if (args[i] === '--text') parsed.text = args[++i];
    else if (args[i] === '--tags') parsed.tags = args[++i];
    else if (args[i] === '--output') parsed.output = args[++i];
    else if (args[i] === '--style') parsed.style = args[++i];
  }
  return parsed;
}

async function generateSpeech(voiceName, text, outputPath) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable not set');
    console.error('Get a free key at: https://aistudio.google.com/apikey');
    process.exit(1);
  }

  const requestBody = {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName }
        }
      }
    }
  };

  const response = await fetch(`${API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`API error (${response.status}): ${err}`);
    process.exit(1);
  }

  const data = await response.json();
  const audioBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

  if (!audioBase64) {
    console.error('No audio data in response');
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // Write raw PCM
  const pcmPath = outputPath.replace(/\.[^.]+$/, '.pcm');
  fs.writeFileSync(pcmPath, Buffer.from(audioBase64, 'base64'));

  // Convert PCM to OGG Opus (WhatsApp/Telegram compatible voice message)
  try {
    execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" -c:a libopus -b:a 64k "${outputPath}" 2>/dev/null`);
    fs.unlinkSync(pcmPath);
  } catch {
    // If ffmpeg/opus not available, try WAV as fallback
    const wavPath = outputPath.replace(/\.[^.]+$/, '.wav');
    try {
      execSync(`ffmpeg -y -f s16le -ar 24000 -ac 1 -i "${pcmPath}" "${wavPath}" 2>/dev/null`);
      fs.unlinkSync(pcmPath);
      console.error(`Note: OGG Opus not available, saved as WAV: ${wavPath}`);
      return wavPath;
    } catch {
      console.error(`Note: ffmpeg not available, saved raw PCM: ${pcmPath}`);
      return pcmPath;
    }
  }

  return outputPath;
}

// Command handling
const command = process.argv[2];

if (command === 'voices') {
  console.log('Available voices:\n');
  for (const v of ALL_VOICES) {
    const agentMatch = Object.entries(AGENT_VOICES).find(([, cfg]) => cfg.voice === v.name);
    const assigned = agentMatch ? ` ← ${agentMatch[0]}` : '';
    console.log(`  ${v.name.padEnd(18)} ${v.category}${assigned}`);
  }
}

else if (command === 'agents') {
  console.log('Agent voice assignments:\n');
  for (const [agent, cfg] of Object.entries(AGENT_VOICES)) {
    console.log(`  ${agent.padEnd(10)} Voice: ${cfg.voice.padEnd(16)} Style: ${cfg.style}`);
    console.log(`  ${''.padEnd(10)} Tags: ${cfg.tags}`);
    console.log();
  }
}

else if (command === 'generate') {
  const args = parseArgs(process.argv.slice(3));

  if (!args.text) {
    console.error('Error: --text is required');
    process.exit(1);
  }

  let voiceName;
  let defaultTags = '';

  if (args.agent) {
    const agentCfg = AGENT_VOICES[args.agent];
    if (!agentCfg) {
      console.error(`Unknown agent: ${args.agent}. Available: ${Object.keys(AGENT_VOICES).join(', ')}`);
      process.exit(1);
    }
    voiceName = agentCfg.voice;
    defaultTags = agentCfg.tags;
  } else if (args.voice) {
    voiceName = args.voice;
  } else {
    console.error('Error: --voice or --agent is required');
    process.exit(1);
  }

  // Build the text with audio tags and style
  let ttsText = args.text;
  if (args.tags) {
    ttsText = `${args.tags} ${ttsText}`;
  } else if (defaultTags && !ttsText.startsWith('[')) {
    ttsText = `${defaultTags} ${ttsText}`;
  }

  // Add style prompt if agent-based
  if (args.agent && !args.style) {
    const agentCfg = AGENT_VOICES[args.agent];
    ttsText = `Say in a ${agentCfg.style} voice: ${ttsText}`;
  } else if (args.style) {
    ttsText = `Say in a ${args.style} voice: ${ttsText}`;
  }

  const outputPath = args.output || `/tmp/tts_${Date.now()}.ogg`;

  const result = await generateSpeech(voiceName, ttsText, outputPath);
  console.log(result);
}
