// api/confirm-booking.js - Confirm booking and send messenger notification
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Send booking confirmation via Messenger
const sendBookingConfirmation = async (senderId, booking) => {
  if (!senderId || !PAGE_ACCESS_TOKEN) {
    console.log('Skipping Messenger notification - facebook_user_id or token missing');
    return;
  }

  try {
    const bookingDate = new Date(booking.booking_date);
    const formattedDate = bookingDate.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    const confirmationMessage = `✅ **BOOKING CONFIRMED**\n\nName: ${booking.customer_name}\nBooking Reference: ${booking.reference_code}\nDate: ${formattedDate}\nCourt: ${booking.court || 'N/A'}\nTime: ${booking.time_slot || 'N/A'}\nTotal Amount Paid: ₱${booking.price || '600'}\n\nThank you for booking with Pickle Social - Cebu! See you on the court. 🎾`;

    const response = await fetch(`https://graph.facebook.com/v17.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: { text: confirmationMessage },
      }),
    });

    if (!response.ok) {
      console.warn('Messenger notification sent with status:', response.status);
    }
  } catch (error) {
    console.error('Error sending Messenger notification:', error.message);
  }
};

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reference_code } = req.body;

  try {
    if (!reference_code) {
      return res.status(400).json({ error: 'reference_code is required' });
    }

    console.log('Confirming booking with reference:', reference_code);

    // Get booking from database
    const { data: booking, error: selectError } = await supabase
      .from('bookings')
      .select('*')
      .eq('reference_code', reference_code)
      .single();

    if (selectError) {
      console.error('Database select error:', selectError);
      return res.status(404).json({ error: 'Booking not found', details: selectError.message });
    }

    if (!booking) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    console.log('Found booking:', booking.reference_code, 'Status:', booking.status);

    // Update booking status to confirmed
    const { data: updatedData, error: updateError } = await supabase
      .from('bookings')
      .update({ status: 'confirmed' })
      .eq('reference_code', reference_code)
      .select();

    if (updateError) {
      console.error('Error updating booking:', updateError);
      return res.status(500).json({ error: 'Failed to confirm booking', details: updateError.message });
    }

    console.log('Booking updated to confirmed');

    // Send messenger notification if facebook_user_id exists
    if (booking.facebook_user_id) {
      console.log('Sending Messenger notification to user:', booking.facebook_user_id);
      await sendBookingConfirmation(booking.facebook_user_id, booking);
    } else {
      console.log('No facebook_user_id found - customer will need to check Messenger manually');
    }

    return res.status(200).json({
      success: true,
      message: 'Booking confirmed',
      booking: {
        reference_code: booking.reference_code,
        customer_name: booking.customer_name,
        status: 'confirmed'
      }
    });
  } catch (error) {
    console.error('Confirm booking error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
