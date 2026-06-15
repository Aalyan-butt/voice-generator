# AI Voice Converter

Text to voice using Microsoft's free neural TTS engine (edge-tts).
No API key required. No cost. Runs locally.

---

## Setup

### 1. Install dependencies
```
pip install -r requirements.txt
```

### 2. Start the backend
```
python app.py
```

### 3. Open the frontend
Open `index.html` in your browser — or visit http://localhost:5000

---

## Stack

| Layer     | Tech                        |
|-----------|-----------------------------|
| Frontend  | HTML + CSS + Vanilla JS     |
| Backend   | Python 3.x + Flask          |
| TTS       | edge-tts (Microsoft Neural) |
| CORS      | flask-cors                  |

---

## Voices included

| Key    | Name   | Gender | Style                |
|--------|--------|--------|----------------------|
| aria   | Aria   | Female | Natural, conversational |
| jenny  | Jenny  | Female | Friendly, warm       |
| guy    | Guy    | Male   | Professional, clear  |
| davis  | Davis  | Male   | Casual, relaxed      |
| jane   | Jane   | Female | Expressive, bright   |
| jason  | Jason  | Male   | Deep, authoritative  |
| sara   | Sara   | Female | Cheerful, energetic  |
| tony   | Tony   | Male   | Confident, direct    |
| sonia  | Sonia  | Female | British, refined     |
| ryan   | Ryan   | Male   | British, warm        |

---

## Features

- 10 neural voices
- Speed and pitch controls
- Waveform visualizer
- Download generated audio as MP3
- Session history (last 8 conversions)
- Works offline after install
