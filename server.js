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

// Middleware to parse URL-encoded bodies (Twilio sends data this way)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const LANGUAGE_CODE = process.env.LANGUAGE_CODE || 'ar-SA'; // Default to Arabic (Saudi Arabia)

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
  let recognizeStream = null;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          callSid = msg.start.callSid;
          streamSid = msg.start.streamSid;
          console.log(`📞 Stream started - Call SID: ${callSid}`);

          // Initialize live transcription state
          liveTranscriptions.set(callSid, {
            callSid,
            fullTranscript: '',
            lastUpdate: new Date().toISOString()
          });

          // Create Google Cloud Speech streaming recognition
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

          try {
            recognizeStream = speechClient
              .streamingRecognize(request)
              .on('error', (error) => {
                console.error('❌ Google Speech API error:', error);
                io.emit('error', {
                  message: 'Speech recognition error: ' + error.message,
                  callSid
                });
              })
              .on('data', (data) => {
                const result = data.results[0];
                if (result && result.alternatives[0]) {
                  const transcript = result.alternatives[0].transcript;
                  const isFinal = result.isFinal;

                  if (transcript && transcript.trim().length > 0) {
                    console.log(`🎙️ ${isFinal ? '[FINAL]' : '[INTERIM]'} ${transcript}`);

                    const liveState = liveTranscriptions.get(callSid);
                    if (liveState) {
                      if (isFinal) {
                        liveState.fullTranscript += transcript + ' ';
                      }
                      liveState.lastUpdate = new Date().toISOString();

                      // Emit real-time transcription to dashboard
                      io.emit('liveTranscript', {
                        callSid,
                        transcript,
                        isFinal,
                        fullTranscript: liveState.fullTranscript,
                        timestamp: liveState.lastUpdate
                      });
                    }
                  }
                }
              });

            console.log('✅ Google Cloud Speech recognition started');
          } catch (error) {
            console.error('❌ Failed to start Google Cloud Speech:', error);
            io.emit('error', {
              message: 'Failed to start speech recognition: ' + error.message,
              callSid
            });
          }
          break;

        case 'media':
          // Forward audio to Google Cloud Speech
          if (recognizeStream && msg.media?.payload) {
            try {
              const audioBuffer = Buffer.from(msg.media.payload, 'base64');
              recognizeStream.write(audioBuffer);
            } catch (error) {
              console.error('Error writing to recognition stream:', error);
            }
          }
          break;

        case 'stop':
          console.log(`🛑 Stream stopped - Call SID: ${callSid}`);

          // Save final transcription
          const finalState = liveTranscriptions.get(callSid);
          if (finalState && finalState.fullTranscript.trim()) {
            const transcription = {
              callSid,
              text: finalState.fullTranscript.trim(),
              status: 'completed',
              timestamp: new Date().toISOString(),
              isRealTime: true
            };

            transcriptions.unshift(transcription);
            if (transcriptions.length > 50) {
              transcriptions.pop();
            }

            // Emit final transcription
            io.emit('transcription', transcription);

            console.log('\n========== FINAL TRANSCRIPTION ==========');
            console.log(`Call SID: ${callSid}`);
            console.log(`\n--- TRANSCRIPT ---`);
            console.log(transcription.text);
            console.log('------------------\n');
          }

          // Cleanup
          if (recognizeStream) {
            recognizeStream.end();
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
    if (recognizeStream) {
      recognizeStream.end();
    }
    if (callSid) {
      liveTranscriptions.delete(callSid);
    }
  });
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
