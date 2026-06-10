// app.js — extracted from index.html
// Global variables
let selectedSlots = new Set();
let supabaseClient = null;
let pendingBookingEntries = [];
let pendingSlotsWithTimer = {}; // Track pending slots with timestamps
let searchedBookingReference = ''; // Store searched reference for success modal
let searchedBookingData = null; // Store searched booking data
let receiptBookingReference = ''; // Booking reference for current session
let receiptBookingTotal = 0; // Total amount for current booking
let receiptFile = null; // Receipt file upload (removed)
let lastSubmissionTime = 0; // Track last submission timestamp for duplicate prevention
let lastSubmissionSlots = []; // Track last submission slot keys for duplicate prevention
const SOFT_OPENING_RATE = 350; // Soft opening rate per hour
const REGULAR_RATE = 450; // Regular rate per hour
let isRegularRateActive = false; // Set to true to switch to regular rate

// Form validation handler for confirm modal
function updateConfirmModalButtonState() {
  const confirmBtn = document.getElementById('confirmModalBtn');
  const nameInput = document.getElementById('confirmName');
  const phoneInput = document.getElementById('confirmPhone');
  
  if (!confirmBtn || !nameInput || !phoneInput) return;
  
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const isValid = name.length > 0 && phone.length > 0;
  
  confirmBtn.disabled = !isValid;
  console.log('Form validation:', { name: !!name, phone: !!phone, disabled: !isValid });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) {
    console.warn('Toast element not found:', message);
    return;
  }
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}





function populateSuccessModal() {
  if (!searchedBookingData || searchedBookingData.length === 0) {
    console.warn('No booking data to populate');
    return;
  }

  const totalAmount = searchedBookingData.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);
  const firstBooking = searchedBookingData[0];
  
  // Populate basic info
  document.getElementById('successName').textContent = firstBooking.customer_name || '—';
  
  let displayDate = 'N/A';
  try {
    if (firstBooking.booking_date) {
      displayDate = formatDateDisplay(firstBooking.booking_date);
    }
  } catch (dateErr) {
    displayDate = firstBooking.booking_date || 'N/A';
  }
  document.getElementById('successDate').textContent = displayDate;
  document.getElementById('successPaidTotal').textContent = '₱' + totalAmount.toFixed(2);
  document.getElementById('scanTitleAmount').textContent = '₱' + totalAmount.toFixed(2);
  document.getElementById('successRefDisplay').textContent = searchedBookingReference;
  
  // Populate booking items (courts and times)
  const courtGroups = {};
  searchedBookingData.forEach(booking => {
    const courtName = booking.court_name || booking.court || 'Court';
    const timeSlot = booking.time_slot || booking.booking_time || 'Unknown time';
    if (!courtGroups[courtName]) {
      courtGroups[courtName] = [];
    }
    courtGroups[courtName].push(timeSlot);
  });

  const bookingItemsHtml = Object.entries(courtGroups).map(([court, times]) => {
    const sortedTimes = times.slice().sort();
    const timesHtml = sortedTimes.map((time, index) => {
      const timeEmojis = ['🕚', '🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
      return `
        <div style="display:flex;align-items:center;gap:8px;margin:6px 0;">
          <span>${timeEmojis[index % timeEmojis.length]}</span>
          <span style="color:#f8fafc;font-size:0.95rem;">${time}</span>
        </div>
      `;
    }).join('');
    
    return `
      <div style="padding:12px;border-radius:12px;border:1px solid rgba(236,72,153,0.14);background:rgba(255,255,255,0.03);margin-bottom:10px;">
        <div style="font-weight:700;color:#f8fafc;margin-bottom:8px;">🏟️ ${court}</div>
        ${timesHtml}
      </div>
    `;
  }).join('');

  document.getElementById('successBookingItems').innerHTML = bookingItemsHtml;
  
  // Update expiry note
  document.getElementById('successExpiryNote').textContent = 'Expires in 60 minutes to pay';
}

function openSuccessModal() {
  populateSuccessModal();
  const modal = document.getElementById('successModal');
  if (modal) modal.classList.add('open');
}

function closeSuccessModal() {
  const modal = document.getElementById('successModal');
  if (modal) modal.classList.remove('open');
}

// Close modals when clicking on overlay
document.addEventListener('DOMContentLoaded', function() {
  const modals = ['aboutUsModal', 'privacyPolicyModal', 'termsModal', 'contactUsModal', 'successModal'];
  
  modals.forEach(modalId => {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          if (modalId === 'aboutUsModal') closeAboutUsModal();
          else if (modalId === 'privacyPolicyModal') closePrivacyPolicyModal();
          else if (modalId === 'termsModal') closeTermsModal();
          else if (modalId === 'contactUsModal') closeContactUsModal();
          else if (modalId === 'successModal') closeSuccessModal();
        }
      });
    }
  });
});


document.addEventListener("DOMContentLoaded", async () => {
  // Remove direct Supabase client - now using backend API
  // Supabase keys are stored in backend environment variables for security

  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusLabel");

  // Helper function to call backend API or direct Supabase client for local dev
  async function callBackendAPI(action, data = {}) {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.protocol === 'file:';

    // If a direct Supabase fallback is configured and we're running locally, use it
    if ((window.SUPABASE_FALLBACK && isLocal) || supabaseClient) {
      if (!supabaseClient) {
        const url = (window.SUPABASE_FALLBACK && window.SUPABASE_FALLBACK.url) || null;
        const key = (window.SUPABASE_FALLBACK && window.SUPABASE_FALLBACK.key) || null;
        if (!url || !key) {
          throw new Error('Supabase fallback not configured for direct client');
        }
        supabaseClient = supabase.createClient(url, key);
      }

      try {
        if (action === 'check-connection') {
          const { error } = await supabaseClient.from('bookings').select('id').limit(1);
          if (error) throw error;
          return { status: 'connected' };
        }

        if (action === 'get-booked-slots') {
          const { bookingDate } = data;
          // Include status and receipt_reference so frontend can distinguish pending vs confirmed
          const { data: rows, error } = await supabaseClient
            .from('bookings')
            .select('time_slot,court,customer_name,status,receipt_reference,created_at')
            .eq('booking_date', bookingDate);
          if (error) throw error;
          return { bookings: rows || [] };
        }

        if (action === 'create-booking') {
          const { bookingDate, timeSlot, court, customer_name, phone_number } = data;
          const { data: inserted, error } = await supabaseClient
            .from('bookings')
            .insert([{
              booking_date: bookingDate,
              time_slot: timeSlot,
              court,
              customer_name,
              phone_number,
              created_at: new Date().toISOString()
            }])
            .select();
          if (error) throw error;
          return { success: true, booking: inserted?.[0] || null };
        }

        if (action === 'bulk-insert-bookings') {
          const { bookings } = data;
          const { data: inserted, error } = await supabaseClient.from('bookings').insert(bookings).select();
          if (error) throw error;
          return { success: true, count: inserted?.length || 0, bookings: inserted || [] };
        }

        if (action === 'get-booking-by-reference') {
          const { reference } = data;
          const { data: rows, error } = await supabaseClient.from('bookings').select('*').eq('reference_code', reference);
          if (error) throw error;
          return { bookings: rows || [] };
        }

        if (action === 'check-duplicate-receipt') {
          const { receipt_reference } = data;
          const { data: rows, error } = await supabaseClient.from('bookings').select('id').eq('receipt_reference', receipt_reference).limit(1);
          if (error) throw error;
          return { exists: rows && rows.length > 0, bookings: rows || [] };
        }

        if (action === 'update-booking-receipt') {
          const { reference_code, receipt_reference, status } = data;
          const { data: updated, error } = await supabaseClient
            .from('bookings')
            .update({ receipt_reference, status })
            .eq('reference_code', reference_code)
            .select();
          if (error) throw error;
          return { success: true, updated: updated?.length || 0, bookings: updated || [] };
        }

        if (action === 'confirm-booking') {
          const { booking_id, reference_code } = data;
          let query = supabaseClient.from('bookings').update({ status: 'confirmed' });
          
          if (booking_id) {
            query = query.eq('id', booking_id);
          } else if (reference_code) {
            query = query.eq('reference_code', reference_code);
          } else {
            throw new Error('booking_id or reference_code is required');
          }
          
          const { data: updated, error } = await query.select();
          if (error) throw error;
          return { success: true, updated: updated?.length || 0, bookings: updated || [] };
        }

        throw new Error('Unsupported action for direct Supabase client: ' + action);
      } catch (err) {
        console.error('Supabase direct call failed:', err);
        throw err;
      }
    }

    // Fallback to backend POST endpoint
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...data })
      });

      if (!response.ok) {
        let errorBody = null;
        let textBody = null;
        try {
          errorBody = await response.json();
        } catch (parseError) {
          try {
            textBody = await response.text();
          } catch (textError) {
            textBody = null;
          }
        }
        const message = errorBody?.message || textBody || `API Error: ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        err.body = errorBody;
        err.text = textBody;
        throw err;
      }

      return await response.json();
    } catch (error) {
      console.error('API call failed:', error);
      throw error;
    }
  }

  try {
    const result = await callBackendAPI('check-connection');
    
    if (dot) dot.style.background = "#4ade80";
    if (dot) dot.style.boxShadow = "0 0 10px #4ade80";
    if (label) label.textContent = "Connected";
    if (label) label.style.color = "#4ade80";
  } catch (err) {
    console.error(err);
    if (dot) dot.style.background = "#f87171";
    if (label) label.textContent = "Offline Mode";
    if (label) label.style.color = "#f87171";
  }

  // Booked slots cache for the current selectedDate
  let bookedSlots = {};

  // Helper function to get initials from a name
  function getInitials(name) {
    if (!name) return '?';
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  }

  // Helper function to get remaining time for pending slots (60 mins)
  function getRemainingTime(timestamp) {
    const now = Date.now();
    const elapsed = now - timestamp;
    const sixtyMins = 60 * 60 * 1000;
    if (elapsed >= sixtyMins) return '0:00';
    const remaining = sixtyMins - elapsed;
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // Load booked slots from backend API for a specific dateKey (YYYY-MM-DD)
  async function loadBookedSlotsForDate(dk) {
    bookedSlots = {};
    try {
      const result = await callBackendAPI('get-booked-slots', { bookingDate: dk });
      if (result.bookings && Array.isArray(result.bookings)) {
        result.bookings.forEach(row => {
          const courtIndex = COURTS.indexOf(row.court);
          if (courtIndex >= 0 && row.time_slot) {
            const status = (row.status || '').toString().toLowerCase();

            const key = `${dk}|${row.time_slot}|${courtIndex}`;

            if (status === 'pending') {
              // Reconstruct pending timer from backend `created_at` so the timer
              // persists across page reloads. Use created_at fallback to now.
              let ts = Date.now();
              try {
                if (row.created_at) ts = new Date(row.created_at).getTime() || Date.now();
              } catch (e) {
                ts = Date.now();
              }
              // Only set pending timer if still within 60 minutes window
              const sixtyMins = 60 * 60 * 1000;
              if ((Date.now() - ts) < sixtyMins) {
                pendingSlotsWithTimer[key] = ts;
              } else {
                // expired on backend; ensure no pending marker left
                if (pendingSlotsWithTimer[key]) delete pendingSlotsWithTimer[key];
              }
              return;
            }

            // Confirmed booking: mark as booked and clear any local pending marker
            bookedSlots[key] = row.customer_name || 'Unknown';
            if (pendingSlotsWithTimer[key]) delete pendingSlotsWithTimer[key];
          }
        });
      }
    } catch (e) {
      console.error('loadBookedSlotsForDate error', e);
      // Don't block UI; show a subtle toast if connection failed
      showToast('Could not load bookings (offline)');
    }
  }

  // Helper to load bookings then render table
  async function loadAndRenderTable() {
    const dk = dateKey(selectedDate);
    await loadBookedSlotsForDate(dk);
    renderTable();
  }

  // 24-HOUR SLOTS
  const SLOTS = [
    '12:00 AM - 1:00 AM',
    '1:00 AM - 2:00 AM',
    '2:00 AM - 3:00 AM',
    '3:00 AM - 4:00 AM',
    '4:00 AM - 5:00 AM',
    '5:00 AM - 6:00 AM',
    '6:00 AM - 7:00 AM',
    '7:00 AM - 8:00 AM',
    '8:00 AM - 9:00 AM',
    '9:00 AM - 10:00 AM',
    '10:00 AM - 11:00 AM',
    '11:00 AM - 12:00 PM',
    '12:00 PM - 1:00 PM',
    '1:00 PM - 2:00 PM',
    '2:00 PM - 3:00 PM',
    '3:00 PM - 4:00 PM',
    '4:00 PM - 5:00 PM',
    '5:00 PM - 6:00 PM',
    '6:00 PM - 7:00 PM',
    '7:00 PM - 8:00 PM',
    '8:00 PM - 9:00 PM',
    '9:00 PM - 10:00 PM',
    '10:00 PM - 11:00 PM',
    '11:00 PM - 12:00 AM'
  ];

  const COURTS = ['Court One', 'Court Two'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  let selectedDate = new Date();
  let today = new Date();
  let viewMonth = today.getMonth();
  let viewYear = today.getFullYear();

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDateDisplay(d) {
    if (typeof d === 'string' || typeof d === 'number') {
      d = new Date(d);
    }
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
      return String(d || '');
    }
    return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  // Fixed rate per hour - manually switch between soft opening and regular
  function getRate(slot, dateStr) {
    return isRegularRateActive ? REGULAR_RATE : SOFT_OPENING_RATE;
  }

  // Helper function to check if a slot is in the past
  function isSlotPast(dateKey, slot) {
    // Only check for past slots on today
    const selectedDateObj = new Date(selectedDate);
    const todayObj = new Date(today);
    const isToday = selectedDateObj.getFullYear() === todayObj.getFullYear() &&
                    selectedDateObj.getMonth() === todayObj.getMonth() &&
                    selectedDateObj.getDate() === todayObj.getDate();

    if (!isToday) return false; // Not today, so slot is not past

    // Parse the start time from the slot (e.g., "1:00 AM - 2:00 AM" -> "1:00 AM")
    const startTimeStr = slot.split(' - ')[0];
    const [timeStr, period] = startTimeStr.match(/(\d+:\d+)\s(AM|PM)/).slice(1);
    let [hours, minutes] = timeStr.split(':').map(Number);

    // Convert to 24-hour format
    if (period === 'AM' && hours === 12) {
      hours = 0; // 12:XX AM is 00:XX
    } else if (period === 'PM' && hours !== 12) {
      hours += 12; // PM times add 12 (except 12 PM)
    }

    // Create a time object for today at this slot's start time
    const slotTime = new Date(todayObj);
    slotTime.setHours(hours, minutes, 0, 0);

    // Current time
    const now = new Date();

    // Slot is past if its start time is before current time
    return slotTime <= now;
  }

  function renderCalendar() {
    const grid = document.getElementById('calGrid');
    grid.innerHTML = '';
    document.getElementById('calMonthYear').textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    DAYS.forEach(day => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = day;
      grid.appendChild(el);
    });

    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day empty';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= totalDays; d++) {
      const day = document.createElement('div');
      day.className = 'cal-day';
      day.textContent = d;

      const thisDate = new Date(viewYear, viewMonth, d);
      const isToday = d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear();
      const isSelected = d === selectedDate.getDate() && viewMonth === selectedDate.getMonth() && viewYear === selectedDate.getFullYear();
      const isPast = thisDate < new Date(today.getFullYear(), today.getMonth(), today.getDate());

      if (isToday) day.classList.add('today');
      if (isSelected && !isToday) day.classList.add('selected');
      if (isPast) day.classList.add('past');

      if (!isPast) {
        day.onclick = () => {
          selectedDate = new Date(viewYear, viewMonth, d);
          renderCalendar();
          loadAndRenderTable();
        };
      }

      grid.appendChild(day);
    }
  }

  document.getElementById('prevBtn').onclick = () => {
    viewMonth--;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    }
    renderCalendar();
    loadAndRenderTable();
  };

  document.getElementById('nextBtn').onclick = () => {
    viewMonth++;
    if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    renderCalendar();
    loadAndRenderTable();
  };

  window.goToToday = function() {
    selectedDate = new Date(today);
    viewMonth = today.getMonth();
    viewYear = today.getFullYear();
    renderCalendar();
    loadAndRenderTable();
  };

  function updatePendingTimerButtons() {
    const now = Date.now();
    const sixtyMins = 60 * 60 * 1000;
    const pendingButtons = document.querySelectorAll('.slot-pending');
    let needsRerender = false;

    pendingButtons.forEach(btn => {
      const slotKey = btn.dataset.slotKey;
      if (!slotKey) return;
      const start = pendingSlotsWithTimer[slotKey];
      if (!start || now - start >= sixtyMins) {
        delete pendingSlotsWithTimer[slotKey];
        needsRerender = true;
        return;
      }
      btn.textContent = `PENDING\n${getRemainingTime(start)}`;
    });

    if (needsRerender) {
      renderTable();
    }
  }

  function renderTable() {
    const dk = dateKey(selectedDate);
    document.getElementById('selectedDateLabel').textContent = formatDateDisplay(selectedDate);

    const body = document.getElementById('slotBody');
    body.innerHTML = '';

    SLOTS.forEach(slot => {
      const tr = document.createElement('tr');
      
      const tdTime = document.createElement('td');
      tdTime.className = 'time-cell';
      tdTime.textContent = slot;
      tr.appendChild(tdTime);

      COURTS.forEach((court, index) => {
        const tdC = document.createElement('td');
        const key = `${dk}|${slot}|${index}`;
        const btn = document.createElement('button');
        btn.className = 'slot-btn';

        // Check if slot is in the past (only for today)
        const pastSlot = isSlotPast(dk, slot);

        // If the slot is booked in Supabase, mark as booked and show initials
        if (bookedSlots[key]) {
          btn.classList.add('slot-booked');
          btn.textContent = getInitials(bookedSlots[key]);
          btn.disabled = true;
        }
        // Check if slot is pending (receipt uploaded, awaiting admin confirmation)
        else if (pendingSlotsWithTimer[key] && (Date.now() - pendingSlotsWithTimer[key]) < 60 * 60 * 1000) {
          btn.classList.add('slot-pending');
          btn.dataset.slotKey = key;
          const remaining = getRemainingTime(pendingSlotsWithTimer[key]);
          btn.textContent = `PENDING\n${remaining}`;
          btn.style.whiteSpace = 'pre-wrap';
          btn.disabled = true;
        } else if (pastSlot) {
          // Disable past slots
          btn.classList.add('slot-past');
          btn.textContent = 'Past';
          btn.disabled = true;
        } else if (selectedSlots.has(key)) {
          btn.classList.add('slot-selected');
          btn.textContent = '✓ Selected';
        } else {
          btn.classList.add('slot-available');
          btn.textContent = 'Available';
        }

        btn.onclick = () => {
          // Prevent selecting a slot that just became booked or is in the past
          if (btn.disabled) return;
          if (selectedSlots.has(key)) {
            selectedSlots.delete(key);
          } else {
            selectedSlots.add(key);
          }
          updateCart();
          debounceRenderTable();
        };

        tdC.appendChild(btn);
        tr.appendChild(tdC);
      });

      body.appendChild(tr);
    });
  }

  function updateCart() {
    const count = selectedSlots.size;
    const total = [...selectedSlots].reduce((sum, key) => {
      const parts = key.split('|');
      return sum + getRate(parts[1], parts[0]);
    }, 0);

    document.getElementById('cartCount').textContent = `${count} slot${count !== 1 ? 's' : ''} selected`;
    document.getElementById('cartTotal').textContent = `₱${total.toLocaleString()}`;
    document.getElementById('cartBar').classList.toggle('visible', count > 0);
  }

  window.clearForm = function() {
    selectedSlots.clear();
    updateCart();
    loadAndRenderTable();
    closeModal();
    closeSuccessModal();
    const refInput = document.getElementById('searchRef');
    if (refInput) refInput.value = '';
    showToast("🧹 Selection cleared!");
  };

  window.openModal = function() {
    // Open the reference search modal (no selection required)
    const refInput = document.getElementById('searchRef');
    if (refInput) refInput.value = '';
    document.getElementById('bookingModal').classList.add('open');
    setTimeout(() => { const el = document.getElementById('searchRef'); if (el) el.focus(); }, 120);
    updateCheckButtonState();
  };

  // Open the confirm modal which summarizes selected slots and collects name/phone
  window.openConfirmModal = function() {
    console.log('openConfirmModal called, selectedSlots:', [...selectedSlots]);
    
    const container = document.getElementById('confirmSlotsContainer');
    const dateEl = document.getElementById('confirmDate');
    const countEl = document.getElementById('confirmCount');
    const totalEl = document.getElementById('confirmTotal');
    const nameEl = document.getElementById('confirmName');
    const phoneEl = document.getElementById('confirmPhone');
    const confirmBtn = document.getElementById('confirmModalBtn');

    if (!container || !dateEl || !countEl || !totalEl) {
      console.error('Missing modal elements:', { container: !!container, dateEl: !!dateEl, countEl: !!countEl, totalEl: !!totalEl });
      return openModal();
    }

    // Populate date
    dateEl.textContent = formatDateDisplay(selectedDate);

    // Build selected slots list
    container.innerHTML = '';
    const sel = [...selectedSlots];
    let total = 0;
    sel.forEach(key => {
      const parts = key.split('|');
      const date = parts[0];
      const slot = parts[1];
      const courtIndex = parseInt(parts[2], 10);
      const court = COURTS[courtIndex] || 'Court';
      const price = getRate(slot, date);
      total += price;

      const card = document.createElement('div');
      card.style.background = 'rgba(255,255,255,0.02)';
      card.style.padding = '12px';
      card.style.borderRadius = '8px';
      card.style.display = 'flex';
      card.style.justifyContent = 'space-between';
      card.style.alignItems = 'center';

      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:700;color:#e5e7eb;">${court}</div><div style="color:#9ca3af;font-size:0.9rem;">${slot}</div>`;
      const right = document.createElement('div');
      right.style.color = 'var(--accent)';
      right.style.fontWeight = '800';
      right.textContent = `₱${price}`;

      card.appendChild(left);
      card.appendChild(right);
      container.appendChild(card);
    });

    countEl.textContent = sel.length;
    totalEl.textContent = `₱${total}`;

    // Prefill name/phone from booking modal fields if available
    const existingName = document.getElementById('bookingName');
    const existingPhone = document.getElementById('bookingPhone');
    if (nameEl) nameEl.value = existingName ? existingName.value : '';
    if (phoneEl) phoneEl.value = existingPhone ? existingPhone.value : '';

    // open modal
    document.getElementById('confirmModal').classList.add('open');
    setTimeout(() => { if (nameEl) nameEl.focus(); }, 120);

    // Remove old listeners and attach the global validation function
    if (nameEl) {
      nameEl.removeEventListener('input', updateConfirmModalButtonState);
      nameEl.addEventListener('input', updateConfirmModalButtonState);
    }
    if (phoneEl) {
      phoneEl.removeEventListener('input', updateConfirmModalButtonState);
      phoneEl.addEventListener('input', updateConfirmModalButtonState);
    }
    
    // Initial check to enable/disable button
    updateConfirmModalButtonState();
    
    console.log('openConfirmModal complete, button state:', {
      disabled: confirmBtn.disabled,
      nameValue: nameEl?.value,
      phoneValue: phoneEl?.value
    });
  };

  window.closeConfirmModal = function() { document.getElementById('confirmModal').classList.remove('open'); };

  window.toggleSuccessPaymentExtension = async function() {
    const checkbox = document.getElementById('successSaveCopy');
    const section = document.getElementById('successPaySection');
    const nextSteps = document.querySelector('.next-steps-card');
    const messengerBtn = document.querySelector('.btn-messenger');
    const bookingRefCard = document.getElementById('bookingRefCardContainer');
    const bookingRefCardBottom = document.getElementById('bookingRefCardContainerBottom');
    const doneBtn = document.getElementById('successDoneBtn');
    if (!checkbox || !section || !nextSteps) return;
    if (checkbox.checked) {
      section.style.display = 'block';
      nextSteps.style.display = 'grid';
      if (messengerBtn) messengerBtn.style.display = 'inline-flex';
      if (bookingRefCard) bookingRefCard.style.display = 'block';
      if (bookingRefCardBottom) bookingRefCardBottom.style.display = 'block';
      if (doneBtn) doneBtn.disabled = false;
      await downloadBookingConfirmationImage();
    } else {
      section.style.display = 'none';
      nextSteps.style.display = 'none';
      if (messengerBtn) messengerBtn.style.display = 'none';
      if (bookingRefCard) bookingRefCard.style.display = 'none';
      if (bookingRefCardBottom) bookingRefCardBottom.style.display = 'none';
      if (doneBtn) doneBtn.disabled = true;
    }
  };

  async function downloadBookingConfirmationImage() {
    const target = document.querySelector('.success-download-card') || document.querySelector('.success-body-box');
    if (!target || !window.html2canvas) {
      console.warn('Cannot download booking image: target or html2canvas missing');
      return;
    }

    try {
      const canvas = await html2canvas(target, {
        backgroundColor: '#08090d',
        scale: Math.min(2, window.devicePixelRatio || 1)
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = 'BookingConfirmation.png';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('✅ Booking confirmation image downloaded');
    } catch (err) {
      console.error('Booking image download failed', err);
      showToast('❌ Failed to download booking image');
    }
  }


  function renderSuccessBookingItems(entries) {
    const container = document.getElementById('successBookingItems');
    if (!container) return;
    container.innerHTML = '';
    if (!entries || entries.length === 0) return;

    const grouped = entries.reduce((acc, entry) => {
      const courtName = entry.court_name || entry.court || 'Court';
      const timeText = entry.booking_time || entry.time_slot || '';
      const date = entry.booking_date || '';
      const key = `${courtName}||${timeText}||${date}`;
      if (!acc[key]) {
        acc[key] = {
          courtName,
          timeText,
          count: 0,
          amount: 0,
          status: (entry.status || 'pending').toUpperCase()
        };
      }
      acc[key].count += 1;
      acc[key].amount += (entry.price || entry.rate || 0);
      return acc;
    }, {});

    Object.values(grouped).forEach(item => {
      const row = document.createElement('div');
      row.className = 'success-booking-item';
      row.innerHTML = `
        <div class="success-booking-item-info">
          <div class="success-booking-item-title">${item.courtName}${item.count > 1 ? ` ×${item.count}` : ''}</div>
          <div class="success-booking-item-meta">${item.timeText || '—'}</div>
        </div>
        <div class="success-booking-item-right">
          <div class="success-booking-item-price">₱${item.amount.toLocaleString()}</div>
          <span class="status-badge pending">${item.status}</span>
        </div>
      `;
      container.appendChild(row);
    });
  }

  window.openBookingSubmittedModal = function(reference, totalAmount) {
    receiptBookingReference = reference;
    receiptBookingTotal = totalAmount;

    const titleEl = document.getElementById('successTitle');
    const messageEl = document.getElementById('successMessage');
    const nameEl = document.getElementById('successName');
    const courtEl = document.getElementById('successCourt');
    const dateEl = document.getElementById('successDate');
    const timeEl = document.getElementById('successTime');
    const paidTotalEl = document.getElementById('successPaidTotal');
    const refCodeEl = document.getElementById('successRefDisplay');
    const refCodeBottomEl = document.getElementById('successRefDisplayBottom');
    const statusEl = document.getElementById('successBookingStatus');
    const expiryEl = document.getElementById('successExpiryNote');
    const saveCopyCheckbox = document.getElementById('successSaveCopy');
    const paySection = document.getElementById('successPaySection');
    const actionText = document.getElementById('successPayActionText');

    if (titleEl) titleEl.textContent = 'Booking Submitted!';
    if (messageEl) messageEl.textContent = 'Save a copy of this confirmation. When you are ready, scan to pay and upload your receipt proof.';
    if (refCodeEl) refCodeEl.textContent = reference;
    if (refCodeBottomEl) refCodeBottomEl.textContent = reference;
    if (statusEl) statusEl.textContent = 'PENDING';
    if (expiryEl) expiryEl.textContent = 'Expires in 4 hours if not confirmed';
    if (actionText) actionText.textContent = 'Check the box to reveal the scan-to-pay section and upload your receipt proof.';

    const messengerBtn = document.querySelector('.btn-messenger');
    if (messengerBtn) {
      const encodedRef = encodeURIComponent(`Booking Reference: ${reference}`);
      messengerBtn.href = `https://www.messenger.com/t/1070406479496408?ref=${encodedRef}`;
    }
    if (saveCopyCheckbox) saveCopyCheckbox.checked = false;
    if (paySection) paySection.style.display = 'none';
    const nextStepsCard = document.querySelector('.next-steps-card');
    if (nextStepsCard) nextStepsCard.style.display = 'none';
    if (messengerBtn) messengerBtn.style.display = 'none';

    const bookingEntries = [...pendingBookingEntries];
    const successName = bookingEntries[0]?.customer_name || '';
    const successCourt = bookingEntries[0]?.court_name || bookingEntries[0]?.court || '';
    const successDate = bookingEntries[0]?.booking_date ? formatDateDisplay(bookingEntries[0].booking_date) : '';
    const successTime = bookingEntries[0]?.booking_time || bookingEntries[0]?.time_slot || '';
    const successPaidTotal = `₱${totalAmount.toLocaleString()}`;

    if (nameEl) nameEl.textContent = successName;
    if (courtEl) courtEl.textContent = successCourt;
    if (dateEl) dateEl.textContent = successDate;
    if (timeEl) timeEl.textContent = successTime;
    if (paidTotalEl) paidTotalEl.textContent = successPaidTotal;
    const scanTitleAmountEl = document.getElementById('scanTitleAmount');
    if (scanTitleAmountEl) scanTitleAmountEl.textContent = successPaidTotal;

    renderSuccessBookingItems(bookingEntries);
    document.getElementById('successModal').classList.add('open');
    bookingSubmissionTime = Date.now(); // Start 15-minute payment timer when modal opens
  };

  window.removeSlot = function(key) {
    selectedSlots.delete(key);
    updateCart();
    loadAndRenderTable();
    
    if (selectedSlots.size === 0) {
      closeModal();
      showToast('All slots removed');
    } else {
      openModal(); // Re-render modal
    }
  };

  window.closeModal = function() {
    document.getElementById('bookingModal').classList.remove('open');
  };

  window.closeSuccessModal = function() {
    document.getElementById('successModal').classList.remove('open');
    bookingSubmissionTime = null; // Reset timer when modal closes
  };

  window.copyBookingReference = function() {
    const refCode = document.getElementById('successRefDisplay')?.textContent || document.getElementById('successRefDisplayBottom')?.textContent || receiptBookingReference || 'PKL-000000';
    navigator.clipboard.writeText(refCode).then(() => {
      showToast(`✅ Copied: ${refCode}`);
    }).catch(err => {
      console.error('Failed to copy:', err);
      showToast('Failed to copy booking reference');
    });
  };

  window.handleDoneBooking = async function() {
    const currentRef = receiptBookingReference;
    
    // Close the success modal and return to dashboard
    closeSuccessModal();
    
    // Show message with booking reference
    if (currentRef) {
      showToast(`📋 Booking Reference: ${currentRef} • Complete your payment via Messenger`);
    }
    
    // Clear pending entries for next booking
    receiptBookingReference = '';
    receiptBookingTotal = 0;
    pendingBookingEntries = [];
    selectedSlots.clear();
    
    // Clear input fields
    const refEl = document.getElementById('searchRef');
    if (refEl) refEl.value = '';
    
    // Reload the table to show the new booking in pending or confirmed state
    await loadAndRenderTable();
  };

  // Admin function to confirm a pending booking and copy confirmation message
  window.confirmBooking = async function(referenceCode, bookingDetails) {
    try {
      // Update booking status to confirmed
      const result = await callBackendAPI('confirm-booking', { reference_code: referenceCode });
      
      if (!result.success || result.updated === 0) {
        showToast('❌ Could not confirm booking. Please try again.');
        return;
      }

      // Get all bookings for this reference to build complete confirmation
      const bookings = result.bookings || [];
      const firstBooking = bookings[0] || bookingDetails || {};
      const customerName = firstBooking.customer_name || 'Guest';
      const totalAmount = bookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);
      const bookingDate = firstBooking.booking_date || 'N/A';
      
      // Group bookings by court
      const slotsByCount = {};
      const timeSlots = {};
      
      bookings.forEach(booking => {
        const court = booking.court_name || booking.court || 'Court';
        if (!slotsByCount[court]) {
          slotsByCount[court] = [];
        }
        const timeSlot = booking.time_slot || booking.booking_time || '';
        slotsByCount[court].push(timeSlot);
      });

      // Build formatted confirmation message
      let courtSections = '';
      const courtOrder = ['Court One', 'Court Two'];
      courtOrder.forEach(court => {
        if (slotsByCount[court] && slotsByCount[court].length > 0) {
          const slots = slotsByCount[court];
          const emoji = court === 'Court One' ? '🏟️' : '🏟️';
          courtSections += `\n${emoji} ${court}\n`;
          
          const timeEmojis = ['🕚', '🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
          slots.forEach((slot, idx) => {
            const emoji = timeEmojis[idx % timeEmojis.length];
            courtSections += `${emoji} ${slot}\n`;
          });
        }
      });

      const confirmationMessage = `BOOKING CONFIRMATION

Hello ${customerName},

Thank you for booking with Pickle Social - Cebu! Your reservation has been successfully confirmed. ✅

Name: ${firstBooking.customer_name || ''}
Phone: ${firstBooking.phone_number || ''}
📌 Booking Reference: ${referenceCode}
💳 Total Paid: ₱${totalAmount.toLocaleString()}
📅 Date: ${bookingDate}${courtSections}`;

      // Copy to clipboard
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(confirmationMessage);
        showToast('✅ Booking confirmed! Message copied to clipboard.');
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = confirmationMessage;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('✅ Booking confirmed! Message copied to clipboard.');
      }

      // Reload table to update status
      await loadAndRenderTable();
    } catch (err) {
      console.error('Error confirming booking:', err);
      showToast('❌ Error confirming booking. Please try again.');
    }
  };

  window.submitBooking = async function() {
    console.log('submitBooking called, selectedSlots:', [...selectedSlots]);
    
    // IMMEDIATELY disable button to prevent rapid clicks
    const confirmBtn = document.getElementById('confirmBtn') || document.getElementById('confirmModalBtn');
    if (confirmBtn && confirmBtn.disabled) {
      console.log('Button already disabled, ignoring duplicate click');
      showToast('⏱️ Please wait - your booking is being submitted...');
      return;
    }
    
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';
      console.log('Button disabled immediately');
    }
    
    // Require slots to be selected
    if (selectedSlots.size === 0) {
      showToast('⚠️ Please select at least one time slot');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Next';
      }
      return;
    }

    // Read values from either the detailed booking modal or the compact confirm modal
    // Prefer values from the confirm modal when present (user-filled there)
    const nameField = document.getElementById('confirmName') || document.getElementById('bookingName');
    const phoneField = document.getElementById('confirmPhone') || document.getElementById('bookingPhone');
    const notesField = document.getElementById('bookingNotes');

    const name = nameField ? nameField.value.trim() : '';
    const phone = phoneField ? phoneField.value.trim() : '';
    const notes = notesField ? notesField.value.trim() : '';

    console.log('Form values:', { name, phone, notes });

    // Require name and phone
    if (!name || !phone) {
      showToast('⚠️ Please fill in your name and phone');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Next';
      }
      return;
    }

    // Duplicate prevention: Check if this is the same submission within 60 seconds
    const currentSlots = [...selectedSlots].sort(); // Sort for consistent comparison
    const now = Date.now();
    const timeSinceLastSubmission = now - lastSubmissionTime;
    const slotsMatch = currentSlots.length === lastSubmissionSlots.length && 
                       currentSlots.every((slot, idx) => slot === lastSubmissionSlots[idx]);

    console.log('Duplicate check:', { slotsMatch, timeSinceLastSubmission, lastSubmissionSlots, currentSlots });

    if (slotsMatch && timeSinceLastSubmission < 60000 && lastSubmissionSlots.length > 0) {
      console.log('DUPLICATE DETECTED! Blocking submission');
      alert('⚠️ This time slot is no longer available.\n\nAnother player has already reserved your selected date and time. Please refresh your browser and choose a different available date or time slot.\n\nThank you for your understanding.');
      showToast('⏱️ Please wait before submitting again');
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Next';
      }
      return;
    }

    // Update submission tracking IMMEDIATELY to prevent rapid duplicate clicks
    // This must happen before any async operations so rapid clicks are caught
    const previousSubmissionTime = lastSubmissionTime;
    const previousSubmissionSlots = lastSubmissionSlots;
    lastSubmissionTime = Date.now();
    lastSubmissionSlots = [...currentSlots]; // Use currentSlots (already sorted)
    
    console.log('Submission tracking updated:', { lastSubmissionTime, lastSubmissionSlots });

    try {
      // Generate booking reference
      const refCode = 'PKL-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

      // Prepare booking data and keep it pending until receipt verification
      pendingBookingEntries = [...selectedSlots].map(key => {
        const [date, slot, courtIndex] = key.split('|');
        const payload = {
          reference_code: refCode,
          customer_name: name,
          phone_number: '+63' + phone.replace(/\D/g, ''),
          booking_date: date,
          booking_time: slot,
          time_slot: slot,
          court_name: COURTS[parseInt(courtIndex)],
          court: COURTS[parseInt(courtIndex)],
          price: getRate(slot, date),
          rate: getRate(slot, date),
          status: 'pending',
          fromExistingBooking: false,
          persistedInDb: false
        };
        // Email field removed from the form; do not include customer_email here
        if (notes) payload.notes = notes;
        return payload;
      });

      const totalAmount = pendingBookingEntries.reduce((s, b) => s + (b.price || 0), 0);

      // Pre-check: Verify all selected slots are still available before saving
      const verifySlots = async () => {
        const uniqueDates = [...new Set(pendingBookingEntries.map(e => e.booking_date))];
        
        for (const date of uniqueDates) {
          try {
            const { bookings } = await callBackendAPI('get-booked-slots', { bookingDate: date });
            const bookedSlots = new Set();
            
            // Add confirmed and valid pending slots to booked set
            bookings.forEach(b => {
              if (b.status === 'confirmed') {
                bookedSlots.add(`${b.time_slot}|${b.court}`);
              } else if (b.status === 'pending') {
                // Check if pending slot is still within the 60-minute window
                const createdAt = new Date(b.created_at).getTime();
                const now = Date.now();
                const expiresAt = createdAt + (60 * 60 * 1000); // 60-minute hold
                if (now < expiresAt) {
                  bookedSlots.add(`${b.time_slot}|${b.court}`);
                }
              }
            });
            
            // Check if any of our selected slots for this date are already booked
            const slotsForDate = pendingBookingEntries.filter(e => e.booking_date === date);
            for (const entry of slotsForDate) {
              const slotKey = `${entry.time_slot}|${entry.court}`;
              if (bookedSlots.has(slotKey)) {
                return false; // Slot is unavailable
              }
            }
          } catch (err) {
            console.error('Error verifying slot availability:', err);
            return false;
          }
        }
        
        return true; // All slots are available
      };

      // Verify slots before saving
      const slotsAvailable = await verifySlots();
      if (!slotsAvailable) {
        showToast('⚠️ This time slot is no longer available.\n\nAnother player has already reserved your selected date and time. Please refresh your browser and choose a different available date or time slot.\n\nThank you for your understanding.');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Next';
        }
        return;
      }

      // Persist pending booking entries to Supabase immediately so the admin dashboard can show them
      try {
        const bookingsToSave = pendingBookingEntries.map(entry => ({
          booking_date: entry.booking_date,
          booking_time: entry.booking_time,
          time_slot: entry.time_slot,
          court: entry.court,
          court_name: entry.court_name,
          customer_name: entry.customer_name,
          phone_number: entry.phone_number,
          reference_code: entry.reference_code,
          status: entry.status,
          price: entry.price,
          rate: entry.rate,
          notes: entry.notes
        }));

        const insertResult = await callBackendAPI('bulk-insert-bookings', { bookings: bookingsToSave });
        if (!insertResult.success) {
          throw new Error(insertResult.error || 'Failed to save pending booking');
        }

        pendingBookingEntries.forEach(entry => {
          entry.persistedInDb = true;
        });
      } catch (err) {
        console.error('Error saving pending booking:', err);
        // Restore previous submission tracking if save failed (allow retry)
        lastSubmissionTime = previousSubmissionTime;
        lastSubmissionSlots = previousSubmissionSlots;
        console.log('Submission tracking restored due to error:', { lastSubmissionTime, lastSubmissionSlots });
        
        alert('⚠️ This time slot is no longer available.\n\nAnother player has already reserved your selected date and time. Please refresh your browser and choose a different available date or time slot.\n\nThank you for your understanding.');
        showToast('⚠️ This time slot is no longer available.\n\nAnother player has already reserved your selected date and time. Please refresh your browser and choose a different available date or time slot.\n\nThank you for your understanding.');
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Next';
        }
        return;
      }

      // Mark selected slots as pending with 60-minute timer
      selectedSlots.forEach(key => {
        const [date, slot, courtIndex] = key.split('|');
        const slotKey = `${date}|${slot}|${courtIndex}`;
        pendingSlotsWithTimer[slotKey] = Date.now(); // 60-minute pending timer
      });
      
      startPendingPoll(); // Start polling to detect admin confirmations

      // Close booking/confirm modal and show the booking submitted summary
      closeModal();
      closeConfirmModal();
      openBookingSubmittedModal(refCode, totalAmount);

      showToast('✅ Booking submitted! Save a copy and proceed to scan payment.');

    } catch (err) {
      console.error('Booking error:', err);
      showToast('Booking failed. Please try again.');
    } finally {
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Next';
        }
    }
  };

  function updateConfirmButtonState() {
    const confirmBtn = document.getElementById('confirmBtn');
    const nameEl = document.getElementById('bookingName');
    const phoneEl = document.getElementById('bookingPhone');
    if (!confirmBtn || !nameEl || !phoneEl) return;
    const name = nameEl.value.trim();
    const phone = phoneEl.value.trim();
    confirmBtn.disabled = !(name && phone);
  }

  // new: enable/disable the 'Check Status' button based on input
  function updateCheckButtonState() {
    const btn = document.getElementById('checkRefBtn');
    const ref = document.getElementById('searchRef');
    if (!btn) return;
    btn.disabled = !ref || !ref.value.trim();
  }

  const searchInputEl = document.getElementById('searchRef');
  if (searchInputEl) {
    searchInputEl.addEventListener('input', updateCheckButtonState);
    searchInputEl.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        const btn = document.getElementById('checkRefBtn');
        if (btn && !btn.disabled) checkReference();
      }
    });
  }

    // Wire booking form inputs to enable/disable the Confirm button
    const bookingNameEl = document.getElementById('bookingName');
    const bookingEmailEl = document.getElementById('bookingEmail');
    const bookingPhoneEl = document.getElementById('bookingPhone');
    const bookingNotesEl = document.getElementById('bookingNotes');
    const confirmBtnEl = document.getElementById('confirmBtn');

    function attachBookingInputListeners() {
      const inputs = [bookingNameEl, bookingEmailEl, bookingPhoneEl];
      inputs.forEach(inp => {
        if (!inp) return;
        inp.addEventListener('input', updateConfirmButtonState);
      });
      updateConfirmButtonState();
    }

    attachBookingInputListeners();

  // Search-by-reference handler
  window.checkReference = async function() {
    const refEl = document.getElementById('searchRef');
    const btn = document.getElementById('checkRefBtn');
    const resultsEl = document.getElementById('bookingCheckResults');
    const contentEl = document.getElementById('bookingResultsContent');
    const payBtn = document.getElementById('payNowBtn');

    if (!refEl) return;
    const ref = refEl.value.trim();
    if (!ref) {
      showToast('⚠️ Please enter a reference number');
      return;
    }

    if (btn) {
      btn.disabled = true;
      var prevText = btn.textContent;
      btn.textContent = 'Checking...';
    }

    try {
      const result = await callBackendAPI('get-booking-by-reference', { reference: ref });
      console.log('Search result:', result);
      
      if (!result || !result.bookings || result.bookings.length === 0) {
        if (contentEl) {
          contentEl.innerHTML = '<div style="color:#f87171;text-align:center;padding:16px;">🔎 Reference not found</div>';
        }
        if (resultsEl) resultsEl.style.display = 'block';
        if (payBtn) payBtn.style.display = 'none';
        return;
      }

      const status = result.bookings.some(b => b.status === 'pending')
        ? 'pending'
        : result.bookings.some(b => b.status === 'paid')
          ? 'paid'
          : result.bookings[0]?.status || 'pending';
      receiptBookingReference = ref;
      const totalAmount = result.bookings.reduce((sum, b) => sum + (b.price || b.rate || 0), 0);
      
      let displayDate = 'N/A';
      try {
        const bookingDate = result.bookings[0]?.booking_date;
        if (bookingDate) {
          displayDate = formatDateDisplay(bookingDate);
        }
      } catch (dateErr) {
        console.warn('Error formatting date:', dateErr);
        displayDate = result.bookings[0]?.booking_date || 'N/A';
      }

      const courtGroups = {};
      if (Array.isArray(result.bookings)) {
        result.bookings.forEach(booking => {
          const courtName = booking.court_name || booking.court || 'Court';
          const timeSlot = booking.time_slot || booking.booking_time || 'Unknown time';
          if (!courtGroups[courtName]) {
            courtGroups[courtName] = [];
          }
          courtGroups[courtName].push(timeSlot);
        });
      }

      const timeEmojis = ['🕚', '🕛', '🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙'];
      const courtSections = Object.entries(courtGroups).map(([court, times]) => {
        const sortedTimes = times.slice().sort();
        const timesHtml = sortedTimes.map((time, index) => `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
            <span>${timeEmojis[index % timeEmojis.length]}</span>
            <span style="color:#f8fafc;">${time}</span>
          </div>
        `).join('');
        return `
          <div style="padding:12px;border-radius:12px;border:1px solid rgba(236,72,153,0.14);background:rgba(255,255,255,0.03);">
            <div style="font-weight:700;color:#f8fafc;margin-bottom:8px;">🏟️ ${court}</div>
            ${timesHtml}
          </div>
        `;
      }).join('');

      let resultHtml = '<div style="display:flex;flex-direction:column;gap:12px;">';
      if (status === 'paid' || status === 'confirmed') {
        resultHtml += `
          <div style="text-align:center;padding:16px;border:2px solid #10b981;border-radius:12px;background:rgba(16,185,129,0.1);">
            <div style="font-size:1.2rem;margin-bottom:8px;">✅ Booking Confirmed</div>
            <div style="color:#a7f3d0;font-weight:700;">Reference: ${ref}</div>
          </div>
        `;
        if (payBtn) payBtn.style.display = 'none';
      } else if (status === 'pending') {
        resultHtml += `
          <div style="text-align:center;padding:16px;border:2px solid #f59e0b;border-radius:12px;background:rgba(245,158,11,0.1);">
            <div style="font-size:1.1rem;margin-bottom:8px;">⏳ Booking Pending Payment</div>
            <div style="color:#fcd34d;">Payment required to confirm</div>
          </div>
        `;
        if (payBtn) payBtn.style.display = 'inline-block';
        receiptBookingTotal = totalAmount;
        searchedBookingReference = ref;
        searchedBookingData = result.bookings;

        pendingBookingEntries = result.bookings.map(booking => ({
          booking_date: booking.booking_date,
          booking_time: booking.booking_time || booking.time_slot,
          time_slot: booking.time_slot || booking.booking_time,
          court: booking.court || booking.court_name,
          court_name: booking.court_name || booking.court,
          customer_name: booking.customer_name || '',
          phone_number: booking.phone_number || '',
          reference_code: booking.reference_code || ref,
          price: booking.price || booking.rate || 0,
          rate: booking.rate || booking.price || 0,
          status: booking.status || 'pending',
          notes: booking.notes,
          fromExistingBooking: true,
          persistedInDb: true
        }));
      }

      resultHtml += `
        <div style="background:rgba(255,255,255,0.03);padding:16px;border-radius:12px;border:1px solid rgba(236,72,153,0.14);">
          <div style="font-size:1rem;margin-bottom:8px;">💳 Total Paid: ₱${totalAmount}</div>
          <div style="font-size:1rem;">📅 Date: ${displayDate}</div>
        </div>
      `;
      resultHtml += courtSections;
      resultHtml += '</div>';

      if (contentEl) contentEl.innerHTML = resultHtml;
      if (resultsEl) resultsEl.style.display = 'block';

    } catch (err) {
      console.error('Search error:', err);
      console.error('Error details:', {
        message: err?.message,
        status: err?.status,
        body: err?.body,
        stack: err?.stack
      });
      if (contentEl) {
        const errorMsg = err?.message || 'Unknown error';
        contentEl.innerHTML = `<div style="color:#f87171;text-align:center;padding:16px;">❌ Error: ${errorMsg}</div>`;
      }
      if (resultsEl) resultsEl.style.display = 'block';
      if (payBtn) payBtn.style.display = 'none';
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prevText || 'Check Status';
      }
    }
  };

  receiptBookingReference = '';
  receiptBookingTotal = 0;
  // Receipt upload functionality removed - simplified to payment via Messenger only

  let receiptTimerInterval = null;
  let receiptModalTimeout = null;

  function clearReceiptModalTimer() {
    if (receiptTimerInterval) {
      clearInterval(receiptTimerInterval);
      receiptTimerInterval = null;
    }
    if (receiptModalTimeout) {
      clearTimeout(receiptModalTimeout);
      receiptModalTimeout = null;
    }
  }

  window.triggerReceiptUpload = function() {
    const input = document.getElementById('receiptFileInput');
    if (input) input.click();
  };

  // Refresh available slots from server and re-render table
  window.refreshSlots = async function() {
    location.reload();
  };

  window.closeReceiptModal = function() {
    // Receipt upload removed
  };

  function parseReceiptText() { return { reference: '', amount: null }; }
  function setReceiptFields() {}
  function getParsedReceiptData() { return { reference: '', amount: null }; }
  function updateReceiptVerificationState() {}
  function updateSuccessReceiptUploadState() {}
  function clearReceiptModalTimer() {}
  async function decodeReceiptImage() { return { canvas: null, dataUrl: '' }; }

  window.handleReceiptFile = function() {
    showToast('Receipt upload has been simplified. Please pay via Messenger with your booking reference.');
  };

  window.clearReceiptUpload = function() {
    // Receipt upload removed
  };

  // NOTE: For full protection against race conditions, add a unique DB constraint
  // on bookings(booking_date, time_slot, court) in Supabase. This front-end check helps
  // catch conflicts early, but the database constraint is the final guard.
  // Example SQL for Supabase SQL editor:
  // ALTER TABLE bookings
  //   ADD CONSTRAINT bookings_unique_slot
  //   UNIQUE (booking_date, time_slot, court);
  async function checkSlotAvailability(entries) {
    if (!entries || entries.length === 0) {
      return { ok: true, conflicts: [] };
    }

    const date = entries[0].booking_date;
    if (!date) {
      return { ok: false, conflicts: [] };
    }

    try {
      const result = await callBackendAPI('get-booked-slots', { bookingDate: date });
      
      const bookedMap = new Map();
      (result.bookings || []).forEach(row => {
        if (row.booking_date && row.time_slot && row.court) {
          bookedMap.set(`${row.booking_date}|${row.time_slot}|${row.court}`, row);
        }
      });

      const conflicts = entries.filter(entry => {
        const key = `${entry.booking_date}|${entry.booking_time}|${entry.court}`;
        return bookedMap.has(key);
      }).map(entry => ({
        booking_date: entry.booking_date,
        booking_time: entry.booking_time,
        court: entry.court
      }));

      return { ok: conflicts.length === 0, conflicts };
    } catch (err) {
      console.error('checkSlotAvailability error:', err);
      return { ok: false, conflicts: [], error: err };
    }
  }

  window.verifyReceipt = function() {
    showToast('Payment processing via Messenger. Please send your booking reference and GCash receipt proof.');
  };

  // Close modal on overlay click
  document.getElementById('bookingModal').onclick = function(e) {
    if (e.target === this) closeModal();
  };
  document.getElementById('successModal').onclick = function(e) {
    if (e.target === this) closeSuccessModal();
  };

  // Initialize
  renderCalendar();
  loadAndRenderTable();

  // Track booking submission time for timer
  let bookingSubmissionTime = null;
  // Polling interval id for checking backend confirmations of pending slots
  let pendingPollInterval = null;
  let renderTableTimeout = null;
  
  function debounceRenderTable() {
    clearTimeout(renderTableTimeout);
    renderTableTimeout = setTimeout(() => {
      renderTable();
    }, 50);
  }

  function startPendingPoll() {
    if (pendingPollInterval) return;
    pendingPollInterval = setInterval(async () => {
      if (Object.keys(pendingSlotsWithTimer).length === 0) {
        clearInterval(pendingPollInterval);
        pendingPollInterval = null;
        return;
      }
      try {
        await loadAndRenderTable();
      } catch (e) {
        console.error('Pending poll load failed', e);
      }
    }, 10000); // poll every 10s (reduced from 5s) while pending slots exist
  }

  // Update timer display every second
  setInterval(() => {
    const now = Date.now();
    const sixtyMins = 60 * 60 * 1000;
    let tableNeedsRefresh = false;

    // Remove expired pending timers and update button labels directly.
    Object.keys(pendingSlotsWithTimer).forEach(key => {
      if (now - pendingSlotsWithTimer[key] >= sixtyMins) {
        delete pendingSlotsWithTimer[key];
        tableNeedsRefresh = true;
      }
    });

    if (Object.keys(pendingSlotsWithTimer).length > 0) {
      updatePendingTimerButtons();
    } else if (tableNeedsRefresh) {
      renderTable();
    }

    // Update payment/booking modal timer (15 minutes) if modal is open
    if (bookingSubmissionTime) {
      const elapsed = now - bookingSubmissionTime;
      const thirtyMins = 30 * 60 * 1000;
      const remaining = thirtyMins - elapsed;
      
      if (remaining <= 0) {
        const expiryEl = document.getElementById('successExpiryNote');
        if (expiryEl) expiryEl.textContent = 'Payment window expired - booking requires re-submission';
        bookingSubmissionTime = null;
      } else {
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const expiryEl = document.getElementById('successExpiryNote');
        if (expiryEl) {
          expiryEl.textContent = `Expires in ${mins}:${secs.toString().padStart(2, '0')}`;
        }
      }
    }
  }, 1000);
});
