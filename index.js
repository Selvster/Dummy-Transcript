require('dotenv').config();
const twilio = require('twilio');

// Get phone number from command line arguments
const phoneNumber = process.argv[2];

if (!phoneNumber) {
  console.error('Usage: node index.js <phone-number>');
  console.error('Example: node index.js +1234567890');
  process.exit(1);
}

// Twilio credentials from environment variables
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;

if (!accountSid || !authToken || !twilioPhoneNumber || !webhookBaseUrl) {
  console.error('Error: Missing required environment variables');
  console.error('Please check your .env file contains:');
  console.error('  TWILIO_ACCOUNT_SID');
  console.error('  TWILIO_AUTH_TOKEN');
  console.error('  TWILIO_PHONE_NUMBER');
  console.error('  WEBHOOK_BASE_URL');
  process.exit(1);
}

const client = twilio(accountSid, authToken);

console.log(`\nInitiating call to ${phoneNumber}...`);
console.log('Make sure your webhook server is running on the specified URL!\n');

// Create a call with real-time transcription via Media Streams
client.calls
  .create({
    to: phoneNumber,
    from: twilioPhoneNumber,
    // TwiML instructions for the call with Media Streams
    twiml: `<?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Hello! This is a test call from Twilio with real-time transcription. Please speak now.</Say>
        <Connect>
          <Stream url="wss://${webhookBaseUrl.replace('https://', '').replace('http://', '')}/media-stream" />
        </Connect>
        <Say>Thank you for testing. Goodbye!</Say>
      </Response>`,
    statusCallback: `${webhookBaseUrl}/status`,
    statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
  })
  .then(call => {
    console.log(`Call initiated successfully!`);
    console.log(`Call SID: ${call.sid}`);
    console.log(`Status: ${call.status}`);
    console.log(`\nReal-time transcription enabled!`);
    console.log(`Watch the dashboard at ${webhookBaseUrl} for live transcripts.\n`);
  })
  .catch(error => {
    console.error('Error making call:', error.message);
    process.exit(1);
  });
