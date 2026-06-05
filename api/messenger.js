import fetch from 'node-fetch';
import { createClient } from '@supabase/supabase-js';

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Webhook verification (Facebook requires this)
export const handleWebhookVerify = (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
};

// Handle incoming messages
export const handleIncomingMessage = async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(async (entry) => {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message) {
        const messageText = webhookEvent.message.text;
        console.log(`Message from ${senderId}: ${messageText}`);
        
        // Check if it's a booking reference (format: PKL-XXXXXXXXXX)
        if (/^PKL-[A-Z0-9]{10,}$/.test(messageText.trim().toUpperCase())) {
          await handleBookingReference(senderId, messageText.trim().toUpperCase());
        } else {
          // Send auto-reply for other messages
          sendMessage(senderId, generateResponse(messageText));
        }
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
};

// Handle booking reference inquiry
const handleBookingReference = async (senderId, bookingReference) => {
  try {
    // Query database for booking
    const { data, error } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', bookingReference)
      .single();

    if (error || !data) {
      sendMessage(senderId, '❌ Booking reference not found. Please check and try again.');
      return;
    }

    // Store facebook_user_id for later confirmation
    await supabase
      .from('bookings')
      .update({ facebook_user_id: senderId })
      .eq('reference_code', bookingReference);

    if (data.status === 'pending') {
      sendMessage(senderId, `Your booking Confirmation is pending.\n\nReference: ${bookingReference}\n\nWait for a while for your confirmation.`);
    } else if (data.status === 'confirmed') {
      sendBookingConfirmation(senderId, data);
    } else if (data.status === 'cancelled') {
      sendMessage(senderId, `❌ This booking has been cancelled.\n\nReference: ${bookingReference}\n\nPlease contact support for details.`);
    }
  } catch (error) {
    console.error('Error handling booking reference:', error);
    sendMessage(senderId, 'Sorry, there was an error checking your booking. Please try again later.');
  }
};

// Send booking confirmation to customer
export const sendBookingConfirmation = async (senderId, booking) => {
  const confirmationMessage = `✅ **BOOKING CONFIRMED**\n\nName: ${booking.customer_name}\nBooking Reference: ${booking.reference_code}\nDate: ${formatDate(booking.booking_date)}\nCourt: ${booking.court}\nTime: ${booking.time_slot}\nTotal Amount Paid: ₱${booking.price || '600'}\n\nThank you for booking with Pickle Social - Cebu! See you on the court. 🎾`;

  sendMessage(senderId, confirmationMessage);
};

// Send message to user via Facebook Messenger
const sendMessage = async (senderId, messageText) => {
  try {
    const response = await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: messageText },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Error sending message:', error);
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
};

// Simple chatbot response logic for general messages
const generateResponse = (userMessage) => {
  const message = userMessage.toLowerCase();

  if (message.includes('hello') || message.includes('hi')) {
    return 'Hello! 👋 Welcome to Pickle Social Cebu.\n\nTo check your booking status, please reply with your booking reference (e.g., PKL-XXXXX)';
  }
  if (message.includes('booking') || message.includes('reserve')) {
    return 'To make a booking, please visit our website at picklesocial.com\n\nTo check your booking status, reply with your booking reference.';
  }
  if (message.includes('payment') || message.includes('price')) {
    return 'Please visit our website for pricing information and payment options.';
  }
  if (message.includes('help') || message.includes('support')) {
    return 'Our support team is here to help! Please reply with your booking reference so we can assist you.';
  }

  return 'Thanks for your message! Please reply with your booking reference (PKL-XXXXX) to check your booking status.';
};

// Format date for display
const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
};

export default { handleWebhookVerify, handleIncomingMessage, sendBookingConfirmation };
