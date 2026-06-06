import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import bookingsHandler from './api/bookings.js';
import createPaymentHandler from './api/create-payment.js';
import { handleWebhookVerify, handleIncomingMessage } from './api/messenger.js';
import confirmBookingHandler from './api/confirm-booking.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files with proper cache headers
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.all('/api/bookings', bookingsHandler);
app.all('/api/create-payment', createPaymentHandler);
app.all('/api/confirm-booking', confirmBookingHandler);

// Facebook Messenger Webhook
app.get('/webhook', (req, res) => handleWebhookVerify(req, res));
app.post('/webhook', (req, res) => handleIncomingMessage(req, res));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Serving static files and API routes.');
});
