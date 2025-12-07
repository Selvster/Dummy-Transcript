# Twilio Call with Real-Time Transcription Dashboard

A Node.js application that uses Twilio to make phone calls and displays **live transcription** during the call using Google Cloud Speech-to-Text API (Vertex AI). Features a beautiful real-time web dashboard that shows transcripts as people speak!

## Features

- 🎯 Make outbound calls to any phone number
- 🎙️ **TRUE Real-time transcription** - see words appear as people speak
- 📝 Live transcription display during active calls
- 📊 Beautiful web dashboard with live updates
- 📞 Track call status in real-time
- 📈 Call statistics and history
- 💬 Socket.io-powered instant updates
- ☁️ Powered by Google Cloud Speech-to-Text (Vertex AI)

## Prerequisites

1. **Node.js** (v14 or higher)
2. **Twilio Account** - Sign up at [twilio.com](https://www.twilio.com/try-twilio)
3. **Google Cloud Account** - For Speech-to-Text API (Vertex AI)
4. **ngrok** (or similar) - For exposing your local webhook server to the internet

## Setup Instructions

### 1. Get Your Twilio Credentials

1. Sign up for a Twilio account at https://www.twilio.com/try-twilio
2. Go to your [Twilio Console](https://console.twilio.com)
3. Note down your:
   - Account SID
   - Auth Token
4. Get a Twilio phone number:
   - Go to Phone Numbers → Manage → Buy a number
   - Choose a number with Voice capabilities

### 2. Set Up Google Cloud Speech-to-Text

1. **Create a Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select an existing one

2. **Enable Speech-to-Text API:**
   - Go to [APIs & Services](https://console.cloud.google.com/apis/library)
   - Search for "Speech-to-Text API"
   - Click "Enable"

3. **Create Service Account:**
   - Go to [IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   - Click "Create Service Account"
   - Name it (e.g., "twilio-transcription")
   - Grant role: "Cloud Speech-to-Text API User"
   - Click "Done"

4. **Download Credentials:**
   - Click on the service account you just created
   - Go to "Keys" tab
   - Click "Add Key" > "Create new key"
   - Choose "JSON" format
   - Download the JSON key file
   - Save it in your project directory (e.g., `google-credentials.json`)
   - **Important:** Add this file to `.gitignore` to avoid committing credentials

### 3. Install ngrok

Download and install ngrok from https://ngrok.com/download

### 4. Configure Environment Variables

1. Copy the example environment file:
   ```bash
   copy .env.example .env
   ```

2. Edit `.env` and add your credentials:
   ```
   TWILIO_ACCOUNT_SID=your_actual_account_sid
   TWILIO_AUTH_TOKEN=your_actual_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_number
   WEBHOOK_BASE_URL=https://your-ngrok-url.ngrok.io
   PORT=3000
   GOOGLE_APPLICATION_CREDENTIALS=./google-credentials.json
   ```

   **Note:**
   - You'll update the `WEBHOOK_BASE_URL` after starting ngrok in step 5
   - Update `GOOGLE_APPLICATION_CREDENTIALS` with the path to your downloaded JSON key file

### 5. Start ngrok

In a separate terminal, run:
```bash
ngrok http 3000
```

You'll see output like:
```
Forwarding    https://abc123.ngrok.io -> http://localhost:3000
```

Copy the `https://` URL and update `WEBHOOK_BASE_URL` in your `.env` file.

## Usage

### Step 1: Start the Webhook Server

In one terminal window, run:
```bash
node server.js
```

You should see:
```
🎙️  Twilio Webhook Server Started
================================
Port: 3000
Status endpoint: http://localhost:3000/status
Transcription endpoint: http://localhost:3000/transcription

Waiting for webhooks from Twilio...
================================
```

### Step 2: Make a Call

In another terminal window, run:
```bash
node index.js +1234567890
```

Replace `+1234567890` with the phone number you want to call (include country code).

### Step 3: View Transcription

1. Answer the phone when it rings
2. Listen to the automated message
3. Speak after the beep (you have up to 60 seconds)
4. Press `#` when done or wait for the recording to finish
5. Watch your webhook server terminal for the transcription

The transcription will appear in the server console like this:
```
========== TRANSCRIPTION RECEIVED ==========
Call SID: CAxxxx
Recording SID: RExxxx
Status: completed
Time: 12/7/2025, 10:30:45 AM

--- TRANSCRIPT ---
Hello, this is a test of the transcription service.
------------------

Recording URL: https://api.twilio.com/...
==========================================
```

## File Structure

```
twilio-dummy/
├── index.js                    # Main script to initiate calls
├── server.js                   # Webhook server with real-time transcription
├── public/
│   └── index.html             # Real-time dashboard UI
├── package.json               # Project dependencies
├── .env                       # Your environment variables (not in git)
├── .env.example              # Environment template
├── google-credentials.json    # Google Cloud credentials (not in git)
├── .gitignore                # Git ignore rules
└── README.md                 # This file
```

## How It Works

1. **index.js** initiates an outbound call using Twilio's API with Media Streams enabled
2. The call uses TwiML to:
   - Play a greeting message
   - Start streaming audio to your server via WebSocket
3. **server.js** processes the call in real-time:
   - Receives audio stream via WebSocket from Twilio Media Streams
   - Forwards audio to Google Cloud Speech-to-Text API
   - Receives transcription results (both interim and final)
   - Broadcasts transcription to the dashboard via Socket.io
4. **Dashboard** displays:
   - Live transcription as words appear in real-time (marked as "LIVE")
   - Call status updates
   - Final completed transcriptions
5. When the call ends:
   - Final transcription is saved
   - Displayed permanently in the dashboard

## Troubleshooting

### "Missing required environment variables"
- Make sure you created a `.env` file (not just `.env.example`)
- Check that all values are filled in without quotes

### "Webhook server not receiving transcriptions"
- Ensure ngrok is running and the URL in `.env` matches the ngrok URL
- Check that the webhook server is running on the correct port
- Verify your ngrok URL is accessible by visiting it in a browser

### "Call fails to connect"
- Verify your Twilio phone number is correct and includes the country code (+1 for US)
- Check that your Twilio account has sufficient credit
- Ensure the destination number is in a valid format with country code

### "No transcription received"
- Make sure Google Cloud credentials are properly configured
- Check that Speech-to-Text API is enabled in your Google Cloud project
- Verify the service account has the correct permissions
- Speak clearly during the call
- Check the server console for any error messages

### "Google Cloud Speech API errors"
- Verify your `GOOGLE_APPLICATION_CREDENTIALS` path is correct
- Make sure the JSON key file exists and is readable
- Check that Speech-to-Text API is enabled in your project
- Ensure you have API quota available (check Google Cloud Console)

## Notes

- **TRUE Real-time Transcription:** Transcripts appear instantly as people speak (not delayed!)
- **Interim Results:** You'll see gray text showing what's being said in real-time, which then gets finalized
- **Phone Call Model:** Uses Google's optimized phone call transcription model for better accuracy
- Transcription accuracy depends on:
  - Audio quality (phone line quality)
  - Speech clarity
  - Background noise
  - Language and accent
- The app uses:
  - **Twilio Media Streams** - For real-time audio streaming
  - **Google Cloud Speech-to-Text** - For live transcription
  - **WebSockets** - For bidirectional communication
  - **Socket.io** - For real-time dashboard updates

## Cost

**Twilio charges for:**
- Outbound calls (varies by destination)
- Media Streams usage
- Check pricing: https://www.twilio.com/pricing

**Google Cloud charges for:**
- Speech-to-Text API usage (per 15 seconds of audio)
- First 60 minutes per month are free
- Enhanced phone call model pricing applies
- Check pricing: https://cloud.google.com/speech-to-text/pricing

**Note:** Make sure to monitor your usage in both consoles to avoid unexpected charges!

## License

ISC
"# Dummy-Transcript-Calls" 
"# Dummy-Transcript" 
