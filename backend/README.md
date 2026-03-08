# WA Controller Backend

Node.js backend for the WhatsApp Bot Controller dashboard.

## Prerequisites

- **Node.js 18+**
- **ffmpeg** (for OGG/Opus voice note conversion)
  ```bash
  # Ubuntu/Debian
  sudo apt install ffmpeg
  
  # macOS
  brew install ffmpeg
  ```

## Setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your settings
```

## Run

```bash
# Development
npm run dev

# Production
npm start
```

## Deploy on VPS

1. Clone repo to your VPS
2. Install dependencies: `npm install`
3. Install ffmpeg: `sudo apt install ffmpeg`
4. Set up `.env` with your config
5. Run with PM2:
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name wa-controller
   pm2 save
   pm2 startup
   ```
6. Set your frontend's `VITE_API_URL` to `http://your-vps-ip:3001`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Connection status + stats |
| GET | `/api/qr` | QR code as data URL |
| GET | `/api/events` | SSE stream for real-time updates |
| GET | `/api/contacts` | List all contacts |
| GET | `/api/conversations` | Contacts with last message |
| GET | `/api/messages/:contactId` | Messages for a contact |
| POST | `/api/send/text` | Send text message |
| POST | `/api/send/voice` | Generate & send voice note |
| POST | `/api/voice/preview` | Preview generated voice |
| GET | `/api/config/:key` | Get config value |
| POST | `/api/config` | Set config value |
| POST | `/api/reconnect` | Reconnect WhatsApp |
| POST | `/api/clear-session` | Clear session & logout |

## Data

All data is stored in `data/wa-controller.db` (SQLite).
WhatsApp session is stored in `data/auth/`.
