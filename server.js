'use strict';

const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');

const app       = express();
const PORT      = process.env.PORT || 5000;
const AUDIO_DIR = process.env.AUDIO_DIR || (process.platform === 'win32'
  ? path.join(__dirname, 'audio_output')
  : '/tmp/audio_output');
const MAX_RETRIES = 3;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// ── Voice catalogue ───────────────────────────────────────────────────────────
const VOICES = {
  aria:        { id: 'en-US-AriaNeural',                label: 'Aria',        gender: 'Female', style: 'Natural, conversational', accent: 'American'     },
  jenny:       { id: 'en-US-JennyNeural',               label: 'Jenny',       gender: 'Female', style: 'Friendly, warm',          accent: 'American'     },
  guy:         { id: 'en-US-GuyNeural',                 label: 'Guy',         gender: 'Male',   style: 'Professional, clear',     accent: 'American'     },
  ava:         { id: 'en-US-AvaMultilingualNeural',      label: 'Ava',         gender: 'Female', style: 'Expressive, bright',      accent: 'American'     },
  emma:        { id: 'en-US-EmmaMultilingualNeural',     label: 'Emma',        gender: 'Female', style: 'Smooth, articulate',      accent: 'American'     },
  michelle:    { id: 'en-US-MichelleNeural',             label: 'Michelle',    gender: 'Female', style: 'Cheerful, pleasant',      accent: 'American'     },
  ana:         { id: 'en-US-AnaNeural',                 label: 'Ana',         gender: 'Female', style: 'Lively, youthful',        accent: 'American'     },
  andrew:      { id: 'en-US-AndrewMultilingualNeural',   label: 'Andrew',      gender: 'Male',   style: 'Warm, engaging',          accent: 'American'     },
  brian:       { id: 'en-US-BrianMultilingualNeural',    label: 'Brian',       gender: 'Male',   style: 'Natural, dynamic',        accent: 'American'     },
  christopher: { id: 'en-US-ChristopherNeural',          label: 'Christopher', gender: 'Male',   style: 'Reliable, authoritative', accent: 'American'     },
  eric:        { id: 'en-US-EricNeural',                 label: 'Eric',        gender: 'Male',   style: 'Rational, confident',     accent: 'American'     },
  roger:       { id: 'en-US-RogerNeural',                label: 'Roger',       gender: 'Male',   style: 'Lively, upbeat',          accent: 'American'     },
  steffan:     { id: 'en-US-SteffanNeural',              label: 'Steffan',     gender: 'Male',   style: 'Deep, composed',          accent: 'American'     },
  sonia:       { id: 'en-GB-SoniaNeural',                label: 'Sonia',       gender: 'Female', style: 'Refined, polished',       accent: 'British'      },
  libby:       { id: 'en-GB-LibbyNeural',                label: 'Libby',       gender: 'Female', style: 'Spirited, clear',         accent: 'British'      },
  maisie:      { id: 'en-GB-MaisieNeural',               label: 'Maisie',      gender: 'Female', style: 'Fresh, energetic',        accent: 'British'      },
  ryan:        { id: 'en-GB-RyanNeural',                 label: 'Ryan',        gender: 'Male',   style: 'Warm, approachable',      accent: 'British'      },
  natasha:     { id: 'en-AU-NatashaNeural',              label: 'Natasha',     gender: 'Female', style: 'Confident, professional', accent: 'Australian'   },
  william:     { id: 'en-AU-WilliamNeural',              label: 'William',     gender: 'Male',   style: 'Relaxed, casual',         accent: 'Australian'   },
  clara:       { id: 'en-CA-ClaraNeural',                label: 'Clara',       gender: 'Female', style: 'Bright, friendly',        accent: 'Canadian'     },
  liam:        { id: 'en-CA-LiamNeural',                 label: 'Liam',        gender: 'Male',   style: 'Smooth, personable',      accent: 'Canadian'     },
  emily:       { id: 'en-IE-EmilyNeural',                label: 'Emily',       gender: 'Female', style: 'Warm, cheerful',          accent: 'Irish'        },
  connor:      { id: 'en-IE-ConnorNeural',               label: 'Connor',      gender: 'Male',   style: 'Grounded, sincere',       accent: 'Irish'        },
  mitchell:    { id: 'en-NZ-MitchellNeural',             label: 'Mitchell',    gender: 'Male',   style: 'Easygoing, genuine',      accent: 'New Zealand'  },
  luna:        { id: 'en-SG-LunaNeural',                 label: 'Luna',        gender: 'Female', style: 'Crisp, professional',     accent: 'Singaporean'  },
  luke:        { id: 'en-ZA-LukeNeural',                 label: 'Luke',        gender: 'Male',   style: 'Rich, resonant',          accent: 'South African'},
};

// ── Edge TTS protocol — mirrors edge-tts 7.x Python library exactly ──────────

const TRUSTED_CLIENT_TOKEN  = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR        = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION    = `1-${CHROMIUM_FULL_VERSION}`;
const WSS_BASE = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

const WIN_EPOCH = 11644473600;   // seconds between 1601-01-01 and 1970-01-01

// Exact port of drm.py → DRM.generate_sec_ms_gec()
function generateSecMsGec() {
  let ticks = Date.now() / 1000;   // Unix seconds (float)
  ticks += WIN_EPOCH;              // Windows FILETIME epoch, in seconds
  ticks -= ticks % 300;            // floor to nearest 5 minutes
  ticks *= 1e7;                    // convert seconds → 100-nanosecond intervals
  const strToHash = `${Math.round(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

// Exact port of drm.py → DRM.generate_muid()
function generateMuid() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Exact port of communicate.py → date_to_string()
function dateToString() {
  const d    = new Date();
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const pad  = (n) => String(n).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${MONS[d.getUTCMonth()]} ${pad(d.getUTCDate())} `
       + `${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} `
       + `GMT+0000 (Coordinated Universal Time)`;
}

// Exact port of communicate.py → connect_id()
function connectId() {
  return uuidv4().replace(/-/g, '');
}

// Exact port of communicate.py → remove_incompatible_characters()
function removeIncompatibleChars(text) {
  return text.split('').map(ch => {
    const c = ch.charCodeAt(0);
    if ((0 <= c && c <= 8) || (11 <= c && c <= 12) || (14 <= c && c <= 31)) return ' ';
    return ch;
  }).join('');
}

// Exact port of xml.sax.saxutils.escape
function xmlEscape(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Exact port of communicate.py → mkssml()
function mkSSML(voice, rate, pitch, escapedText) {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`
       + `<voice name='${voice}'>`
       + `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>`
       + `${escapedText}`
       + `</prosody></voice></speak>`;
}

// Exact port of communicate.py → ssml_headers_plus_data()
function ssmlHeadersPlusData(requestId, timestamp, ssml) {
  return `X-RequestId:${requestId}\r\n`
       + `Content-Type:application/ssml+xml\r\n`
       + `X-Timestamp:${timestamp}Z\r\n`   // trailing Z is intentional (Microsoft bug replica)
       + `Path:ssml\r\n\r\n`
       + ssml;
}

// WebSocket headers — mirrors DRM.headers_with_muid(WSS_HEADERS)
function buildWssHeaders() {
  return {
    'Pragma'              : 'no-cache',
    'Cache-Control'       : 'no-cache',
    'Origin'              : 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'Sec-WebSocket-Version': '13',
    'User-Agent'          : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
    'Accept-Encoding'     : 'gzip, deflate, br, zstd',
    'Accept-Language'     : 'en-US,en;q=0.9',
    'Cookie'              : `muid=${generateMuid()};`,
  };
}

function synthesizeOnce(text, voiceId, rate, pitch) {
  return new Promise((resolve, reject) => {
    const connId = connectId();
    const secGec = generateSecMsGec();
    const url = `${WSS_BASE}&ConnectionId=${connId}&Sec-MS-GEC=${secGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

    const ws = new WebSocket(url, {
      headers: buildWssHeaders(),
      perMessageDeflate: { clientMaxWindowBits: 15 },
    });

    const audioChunks = [];
    let audioReceived = false;
    let done = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      ws.terminate();
      if (err) return reject(err);
      if (!audioReceived) return reject(new Error('No audio was received. Please verify that your parameters are correct.'));
      resolve(Buffer.concat(audioChunks));
    };

    ws.on('open', () => {
      const ts = dateToString();

      // 1. Speech config — mirrors send_command_request()
      ws.send(
        `X-Timestamp:${ts}\r\n`
        + `Content-Type:application/json; charset=utf-8\r\n`
        + `Path:speech.config\r\n\r\n`
        + `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`
      );

      // 2. SSML request — mirrors send_ssml_request()
      const escaped = xmlEscape(removeIncompatibleChars(text));
      const ssml    = mkSSML(voiceId, rate, pitch, escaped);
      ws.send(ssmlHeadersPlusData(connectId(), ts, ssml));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Binary frame: first 2 bytes = header length, then header, then audio
        if (data.length < 2) return;
        const headerLen = data.readUInt16BE(0);
        // Parse header to confirm Path: audio
        const headerText = data.slice(2, 2 + headerLen).toString();
        if (!headerText.includes('Path:audio')) return;
        const audio = data.slice(2 + headerLen);
        if (audio.length > 0) {
          audioReceived = true;
          audioChunks.push(audio);
        }
      } else {
        const msg = typeof data === 'string' ? data : data.toString();
        if (msg.includes('Path:turn.end')) finish(null);
      }
    });

    ws.on('error', (err) => finish(err));
    ws.on('close', (code) => {
      if (!done) finish(new Error(`WebSocket closed unexpectedly (code ${code})`));
    });

    setTimeout(() => finish(new Error('TTS request timed out')), 60_000);
  });
}

async function synthesizeWithRetry(text, voiceId, rate, pitch, outputPath) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    try {
      const buf = await synthesizeOnce(text, voiceId, rate, pitch);
      fs.writeFileSync(outputPath, buf);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, attempt * 800));
    }
  }
  throw lastErr;
}

function fmtRate(v)  { v = +v; return v >= 0 ? `+${v}%`  : `${v}%`;  }
function fmtPitch(v) { v = +v; return v >= 0 ? `+${v}Hz` : `${v}Hz`; }

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/voices', (_req, res) => res.json({ voices: VOICES }));

app.post('/api/synthesize', async (req, res) => {
  const { text = '', voice = 'aria', rate = 0, pitch = 0 } = req.body;
  const trimmed = text.trim();

  if (!trimmed) return res.status(400).json({ error: 'Text is required' });
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 5000) return res.status(400).json({ error: 'Text too long — max 5000 words' });

  const voiceInfo  = VOICES[voice] ?? VOICES.aria;
  const filename   = connectId() + '.mp3';
  const outputPath = path.join(AUDIO_DIR, filename);

  try {
    await synthesizeWithRetry(trimmed, voiceInfo.id, fmtRate(rate), fmtPitch(pitch), outputPath);
  } catch (err) {
    return res.status(500).json({ error: `Synthesis failed: ${err.message}` });
  }

  res.json({
    audio_url:  `/api/audio/${filename}`,
    filename,
    voice:      voiceInfo.label,
    characters: trimmed.length,
  });
});

app.get('/api/audio/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const fp   = path.join(AUDIO_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(fp);
});

app.get('/api/download/:filename', (req, res) => {
  const safe = path.basename(req.params.filename);
  const fp   = path.join(AUDIO_DIR, safe);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.download(fp, `voice_message_${safe}`);
});

app.post('/api/cleanup', (_req, res) => {
  let count = 0;
  try {
    for (const f of fs.readdirSync(AUDIO_DIR)) {
      try { fs.unlinkSync(path.join(AUDIO_DIR, f)); count++; } catch { /* skip locked */ }
    }
  } catch { /* skip */ }
  res.json({ deleted: count });
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  VoiceAI Studio (Node.js) — http://0.0.0.0:${PORT}\n`);
});
