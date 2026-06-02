// api/bookings.js - Secure backend endpoint for booking operations
// This backend handles all Supabase operations with environment variables
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');
console.log('Loading environment files:', envPath, envLocalPath);
dotenv.config({ path: envPath });
dotenv.config({ path: envLocalPath });

// Initialize Supabase with environment variables (not exposed to client)
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase environment variables are missing:', {
    SUPABASE_URL: !!supabaseUrl,
    SUPABASE_KEY: !!supabaseKey
  });
  throw new Error('Supabase configuration missing. Please add SUPABASE_URL and SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY to your .env.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Health check endpoint
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { action, bookingDate, timeSlot, court, customer_name, phone_number } = req.body;

  try {
    // Check connection to Supabase
    if (action === 'check-connection') {
      const { error } = await supabase.from('bookings').select('id').limit(1);
      if (error) throw error;
      
      return res.status(200).json({ 
        status: 'connected',
        message: 'Successfully connected to database'
      });
    }

    // Get booked slots for a specific date
    if (action === 'get-booked-slots') {
      if (!bookingDate) {
        return res.status(400).json({ error: 'bookingDate is required' });
      }

      const { data, error } = await supabase
        .from('bookings')
        .select('time_slot,court,customer_name')
        .eq('booking_date', bookingDate);
      
      if (error) throw error;
      
      return res.status(200).json({ 
        success: true,
        bookings: data || []
      });
    }

    // Create a new booking
    if (action === 'create-booking') {
      if (!bookingDate || !timeSlot || !court || !customer_name || !phone_number) {
        return res.status(400).json({ 
          error: 'Missing required fields: bookingDate, timeSlot, court, customer_name, phone_number' 
        });
      }

      // Validate input to prevent injection
      if (!/^\d{4}-\d{2}-\d{2}$/.test(bookingDate)) {
        return res.status(400).json({ error: 'Invalid date format' });
      }

      const { data, error } = await supabase
        .from('bookings')
        .insert([{
          booking_date: bookingDate,
          booking_time: timeSlot,
          time_slot: timeSlot,
          court: court,
          court_name: court,
          customer_name: customer_name.substring(0, 100), // Limit length
          phone_number: phone_number.substring(0, 20),
          status: 'pending',
          price: 0,
          rate: 0,
          created_at: new Date().toISOString()
        }])
        .select();
      
      if (error) throw error;
      
      return res.status(201).json({ 
        success: true,
        booking: data?.[0] || null
      });
    }

    // Bulk insert bookings
    if (action === 'bulk-insert-bookings') {
      const { bookings } = req.body;
      
      if (!bookings || !Array.isArray(bookings) || bookings.length === 0) {
        return res.status(400).json({ 
          error: 'Missing required fields: bookings array' 
        });
      }

      // Validate and sanitize each booking
      const validatedBookings = bookings.map(booking => ({
        booking_date: booking.booking_date,
        booking_time: booking.booking_time || booking.time_slot,
        time_slot: booking.time_slot || booking.booking_time,
        court: booking.court || booking.court_name,
        court_name: booking.court_name || booking.court,
        customer_name: String(booking.customer_name || '').substring(0, 100),
        phone_number: String(booking.phone_number || '').substring(0, 20),
        reference_code: String(booking.reference_code || '').substring(0, 50),
        receipt_reference: booking.receipt_reference ? String(booking.receipt_reference).substring(0, 50) : null,
        status: booking.status || 'pending',
        price: booking.price || 0,
        rate: booking.rate || 0,
        notes: booking.notes ? String(booking.notes).substring(0, 500) : null,
        created_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('bookings')
        .insert(validatedBookings)
        .select();
      
      if (error) throw error;
      
      return res.status(201).json({ 
        success: true,
        count: data?.length || 0,
        bookings: data || []
      });
    }

    // Get bookings by reference code
    if (action === 'get-booking-by-reference') {
      const { reference } = req.body;
      
      if (!reference) {
        return res.status(400).json({ error: 'reference is required' });
      }

      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('reference_code', reference);
      
      if (error) throw error;
      
      return res.status(200).json({ 
        success: true,
        bookings: data || []
      });
    }

    // Check if receipt reference already exists
    if (action === 'check-duplicate-receipt') {
      const { receipt_reference } = req.body;
      
      if (!receipt_reference) {
        return res.status(400).json({ error: 'receipt_reference is required' });
      }

      const { data, error } = await supabase
        .from('bookings')
        .select('id')
        .eq('receipt_reference', receipt_reference)
        .limit(1);
      
      if (error) throw error;
      
      return res.status(200).json({ 
        success: true,
        exists: data && data.length > 0,
        bookings: data || []
      });
    }

  } catch (error) {
    console.error('Bookings API Error:', error);
    console.error('Bookings API Error details:', {
      message: error?.message,
      code: error?.code,
      hint: error?.hint,
      details: error?.details,
      status: error?.status
    });
    return res.status(500).json({ 
      error: 'Database operation failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error?.details : undefined
    });
  }
}
