require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const path = require('path');
const WebSocket = require('ws');
const speech = require('@google-cloud/speech');
const twilio = require('twilio');
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Middleware to parse URL-encoded bodies (Twilio sends data this way)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const LANGUAGE_CODE = process.env.LANGUAGE_CODE || 'ar-SA'; // Default to Arabic (Saudi Arabia)
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const TWILIO_API_KEY = process.env.TWILIO_API_KEY;
const TWILIO_API_SECRET = process.env.TWILIO_API_SECRET;
const TWILIO_TWIML_APP_SID = process.env.TWILIO_TWIML_APP_SID;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;

// Store call history and transcriptions in memory
const callHistory = [];
const transcriptions = [];
const liveTranscriptions = new Map(); // Store live transcription state per call

// Initialize Google Cloud Speech client
const speechClient = new speech.SpeechClient();

// Create WebSocket server for Twilio Media Streams
const wss = new WebSocket.Server({ server, path: '/media-stream' });

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('Dashboard client connected');

  // Send existing history to newly connected client
  socket.emit('init', {
    calls: callHistory,
    transcriptions: transcriptions
  });

  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected');
  });
});

// WebSocket handler for Twilio Media Streams
wss.on('connection', (ws) => {
  console.log('\n🔌 New Media Stream connection');

  let callSid = null;
  let streamSid = null;
  let recognizeStreamInbound = null;  // For the person you called
  let recognizeStreamOutbound = null; // For you (caller)

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Stream started - Call SID: ${callSid}`);
          console.log(`🎯 Dual-channel mode enabled (both speakers)`);

          // Initialize live transcription state for BOTH speakers
          liveTranscriptions.set(callSid, {
            callSid,
            inbound: {
              fullTranscript: '',
              interim: ''
            },
            outbound: {
              fullTranscript: '',
              interim: ''
            },
            lastUpdate: new Date().toISOString()
          });

          // Create Google Cloud Speech config
          // Note: phone_call model only supports English, use default for other languages
          const isEnglish = LANGUAGE_CODE.startsWith('en-');
          const config = {
            encoding: 'MULAW',
            sampleRateHertz: 8000,
            languageCode: LANGUAGE_CODE,
            enableAutomaticPunctuation: true,
          };

          // Only use phone_call model and enhanced for English
          if (isEnglish) {
            config.model = 'phone_call';
            config.useEnhanced = true;
          }

          const request = {
            config,
            interimResults: true,
          };

          // Helper function to create a recognition stream for a specific track
          const createRecognitionStream = (track) => {
            return speechClient
              .streamingRecognize(request)
              .on('error', (error) => {
                console.error(`❌ Google Speech API error (${track}):`, error);
                io.emit('error', {
                  message: `Speech recognition error (${track}): ` + error.message,
                  callSid
                });
              })
              .on('data', (data) => {
                const result = data.results[0];
                if (result && result.alternatives[0]) {
                  const transcript = result.alternatives[0].transcript;
                  const isFinal = result.isFinal;

                  if (transcript && transcript.trim().length > 0) {
                    const speaker = track === 'inbound' ? 'Them' : 'You';
                    console.log(`🎙️ [${speaker}] ${isFinal ? 'FINAL' : 'INTERIM'}: ${transcript}`);

                    const liveState = liveTranscriptions.get(callSid);
                    if (liveState) {
                      if (isFinal) {
                        liveState[track].fullTranscript += transcript + ' ';
                        liveState[track].interim = '';
                      } else {
                        liveState[track].interim = transcript;
                      }
                      liveState.lastUpdate = new Date().toISOString();

                      // Emit real-time transcription to dashboard
                      io.emit('liveTranscript', {
                        callSid,
                        track,
                        speaker,
                        transcript,
                        isFinal,
                        fullTranscript: liveState[track].fullTranscript,
                        interim: liveState[track].interim,
                        timestamp: liveState.lastUpdate
                      });
                    }
                  }
                }
              });
          };

          try {
            recognizeStreamInbound = createRecognitionStream('inbound');
            recognizeStreamOutbound = createRecognitionStream('outbound');
            console.log('✅ Google Cloud Speech recognition started for BOTH channels');
          } catch (error) {
            console.error('❌ Failed to start Google Cloud Speech:', error);
            io.emit('error', {
              message: 'Failed to start speech recognition: ' + error.message,
              callSid
            });
          }
          break;

        case 'media':
          // Forward audio to the appropriate Google Cloud Speech stream based on track
          if (msg.media?.payload) {
            try {
              const audioBuffer = Buffer.from(msg.media.payload, 'base64');
              const track = msg.media.track;

              if (track === 'inbound' && recognizeStreamInbound) {
                recognizeStreamInbound.write(audioBuffer);
              } else if (track === 'outbound' && recognizeStreamOutbound) {
                recognizeStreamOutbound.write(audioBuffer);
              }
            } catch (error) {
              console.error('Error writing to recognition stream:', error);
            }
          }
          break;

        case 'stop':
          console.log(`🛑 Stream stopped - Call SID: ${callSid}`);

          // Save final transcription for BOTH speakers
          const finalState = liveTranscriptions.get(callSid);
          if (finalState) {
            const inboundText = finalState.inbound.fullTranscript.trim();
            const outboundText = finalState.outbound.fullTranscript.trim();

            if (inboundText || outboundText) {
              const transcription = {
                callSid,
                inbound: inboundText || '(No speech detected)',
                outbound: outboundText || '(No speech detected)',
                status: 'completed',
                timestamp: new Date().toISOString(),
                isRealTime: true,
                isDualChannel: true
              };

              transcriptions.unshift(transcription);
              if (transcriptions.length > 50) {
                transcriptions.pop();
              }

              // Emit final transcription
              io.emit('transcription', transcription);

              console.log('\n========== FINAL TRANSCRIPTION ==========');
              console.log(`Call SID: ${callSid}`);
              console.log(`\n--- THEM (Inbound) ---`);
              console.log(inboundText || '(No speech detected)');
              console.log(`\n--- YOU (Outbound) ---`);
              console.log(outboundText || '(No speech detected)');
              console.log('------------------\n');
            }
          }

          // Cleanup
          if (recognizeStreamInbound) {
            recognizeStreamInbound.end();
          }
          if (recognizeStreamOutbound) {
            recognizeStreamOutbound.end();
          }
          liveTranscriptions.delete(callSid);
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.on('close', () => {
    console.log('🔌 Media Stream connection closed');
    if (recognizeStreamInbound) {
      recognizeStreamInbound.end();
    }
    if (recognizeStreamOutbound) {
      recognizeStreamOutbound.end();
    }
    if (callSid) {
      liveTranscriptions.delete(callSid);
    }
  });
});

// Token endpoint - generates access token for Twilio Client
app.get('/token', (req, res) => {
  console.log('\n=== Token Request ===');
  console.log('Account SID:', TWILIO_ACCOUNT_SID);
  console.log('API Key:', TWILIO_API_KEY);
  console.log('API Secret:', TWILIO_API_SECRET ? '***' + TWILIO_API_SECRET.slice(-4) : 'MISSING');
  console.log('TwiML App SID:', TWILIO_TWIML_APP_SID);

  if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY || !TWILIO_API_SECRET || !TWILIO_TWIML_APP_SID) {
    console.error('ERROR: Missing required credentials!');
    return res.status(500).json({ error: 'Missing Twilio credentials' });
  }

  const identity = 'browser_user_' + Date.now();

  try {
    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY,
      TWILIO_API_SECRET,
      { identity: identity }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: TWILIO_TWIML_APP_SID,
      incomingAllow: true,
    });

    token.addGrant(voiceGrant);

    const jwt = token.toJwt();
    console.log('Token generated successfully for identity:', identity);
    console.log('JWT preview:', jwt.substring(0, 50) + '...');

    res.json({
      identity: identity,
      token: jwt
    });
  } catch (error) {
    console.error('Error generating token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Voice endpoint - TwiML for outbound calls with Media Streams
app.post('/voice', (req, res) => {
  console.log('\n=== /voice endpoint called ===');
  console.log('Request body:', req.body);

  // Custom parameters from Voice SDK are prefixed
  const toNumber = req.body.To || req.query.To;

  console.log('Calling number:', toNumber);

  if (!toNumber) {
    console.error('ERROR: No phone number provided!');
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Error: No phone number provided.</Say>
  <Hangup/>
</Response>`;
    res.type('text/xml');
    return res.send(errorTwiml);
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Start>
    <Stream url="wss://${WEBHOOK_BASE_URL.replace('https://', '').replace('http://', '')}/media-stream" track="both_tracks" />
  </Start>
  <Dial callerId="${TWILIO_PHONE_NUMBER}">
    <Number>${toNumber}</Number>
  </Dial>
</Response>`;

  console.log('Sending TwiML:', twiml);

  res.type('text/xml');
  res.send(twiml);
});

// Webhook endpoint for call status updates
app.post('/status', (req, res) => {
  const { CallSid, CallStatus, From, To, Direction, Duration } = req.body;

  const statusUpdate = {
    callSid: CallSid,
    status: CallStatus,
    from: From,
    to: To,
    direction: Direction,
    duration: Duration,
    timestamp: new Date().toISOString()
  };

  console.log('\n========== CALL STATUS UPDATE ==========');
  console.log(`Call SID: ${CallSid}`);
  console.log(`Status: ${CallStatus}`);
  console.log(`From: ${From}`);
  console.log(`To: ${To}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log('========================================\n');

  // Update or add to call history
  const existingCallIndex = callHistory.findIndex(c => c.callSid === CallSid);
  if (existingCallIndex !== -1) {
    callHistory[existingCallIndex] = { ...callHistory[existingCallIndex], ...statusUpdate };
  } else {
    callHistory.unshift(statusUpdate);
  }

  // Keep only last 50 calls
  if (callHistory.length > 50) {
    callHistory.pop();
  }

  // Emit to all connected dashboards
  io.emit('callStatus', statusUpdate);

  res.sendStatus(200);
});

// Webhook endpoint for transcription results
app.post('/transcription', (req, res) => {
  const {
    TranscriptionText,
    TranscriptionStatus,
    CallSid,
    RecordingSid,
    RecordingUrl
  } = req.body;

  const transcription = {
    callSid: CallSid,
    recordingSid: RecordingSid,
    text: TranscriptionText || '(No speech detected)',
    status: TranscriptionStatus,
    recordingUrl: RecordingUrl,
    timestamp: new Date().toISOString()
  };

  console.log('\n========== TRANSCRIPTION RECEIVED ==========');
  console.log(`Call SID: ${CallSid}`);
  console.log(`Recording SID: ${RecordingSid}`);
  console.log(`Status: ${TranscriptionStatus}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log('\n--- TRANSCRIPT ---');
  console.log(TranscriptionText || '(No speech detected)');
  console.log('------------------');

  if (RecordingUrl) {
    console.log(`\nRecording URL: ${RecordingUrl}`);
  }
  console.log('==========================================\n');

  // Store transcription
  transcriptions.unshift(transcription);

  // Keep only last 50 transcriptions
  if (transcriptions.length > 50) {
    transcriptions.pop();
  }

  // Emit to all connected dashboards
  io.emit('transcription', transcription);

  res.sendStatus(200);
});

// API endpoint to get history
app.get('/api/history', (req, res) => {
  res.json({
    calls: callHistory,
    transcriptions: transcriptions
  });
});

server.listen(PORT, () => {
  console.log(`\n🎙️  Twilio Dashboard Server Started`);
  console.log(`================================`);
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Port: ${PORT}`);
  console.log(`Language: ${LANGUAGE_CODE}`);
  console.log(`\nWebhook Endpoints:`);
  console.log(`  Status: http://localhost:${PORT}/status`);
  console.log(`  Transcription: http://localhost:${PORT}/transcription`);
  console.log(`\nWaiting for webhooks from Twilio...`);
  console.log(`================================\n`);
});
