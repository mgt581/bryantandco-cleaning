/* Bryant & Co Cleaning — shared availability calendar for quote forms */
(function () {
  'use strict';

  var widgets = document.querySelectorAll('[data-booking-widget]');
  if (!widgets.length) return;

  var cache = {};
  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  widgets.forEach(function (root) {
    var now = new Date();
    var state = { month: new Date(now.getFullYear(), now.getMonth(), 1), date: '', start: '', duration: 120, recurrence: 'once', until: '', blocked: {}, ready: false };
    var requestParams = new URLSearchParams(window.location.search);
    var requestedDate = requestParams.get('booking_date');
    var requestedStart = requestParams.get('booking_start');
    var requestedDuration = Number(requestParams.get('booking_duration'));
    if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '')) {
      var requestedDateObject = new Date(requestedDate + 'T00:00:00');
      if (!Number.isNaN(requestedDateObject.getTime())) {
        state.date = requestedDate;
        state.month = new Date(requestedDateObject.getFullYear(), requestedDateObject.getMonth(), 1);
      }
    }
    if ([60, 120, 180, 240, 300, 360].indexOf(requestedDuration) !== -1) state.duration = requestedDuration;
    if (/^\d{2}:\d{2}$/.test(requestedStart || '')) state.start = requestedStart;

    root.innerHTML = `
      <div class="booking-widget__heading"><div><label class="booking-widget__title">Choose a date and time <span>(optional)</span></label><p>Free slots are shown below. Taken times are greyed out so you can avoid double-booking.</p></div><div class="booking-widget__heading-actions"><span class="booking-widget__badge">Live availability</span><a class="booking-widget__full-link" href="ouravailability.html">Open full calendar →</a></div></div>
      <div class="booking-widget__legend" aria-label="Availability legend"><span><i class="booking-dot booking-dot--free"></i>Available</span><span><i class="booking-dot booking-dot--taken"></i>Taken</span></div>
      <div class="booking-widget__status" role="status" aria-live="polite">Loading live availability…</div>
      <div class="booking-widget__calendar"><div class="calendar-header"><button class="cal-nav booking-prev" type="button" aria-label="Previous month">&#8249;</button><span class="cal-month-label booking-month"></span><button class="cal-nav booking-next" type="button" aria-label="Next month">&#8250;</button></div><div class="cal-grid booking-grid" role="grid" aria-label="Available cleaning dates"></div></div>
      <div class="booking-widget__selection"><div class="booking-widget__selected-date">Select a date to see available start times.</div><div class="form-row booking-widget__options"><div class="form-group"><label>Cleaning duration</label><select class="booking-duration" aria-label="Cleaning duration"><option value="60">1 hour</option><option value="120" selected>2 hours</option><option value="180">3 hours</option><option value="240">4 hours</option><option value="300">5 hours</option><option value="360">6 hours</option></select></div><div class="form-group"><label>Frequency</label><select class="booking-recurrence" aria-label="Booking frequency"><option value="once">One-off</option><option value="weekly">Every week</option><option value="fortnightly">Every 2 weeks</option><option value="monthly">Every month</option></select></div></div><div class="form-group booking-until-wrap" hidden><label>Recurring booking until</label><input class="booking-until" type="date" aria-label="Recurring booking end date"><small>We will request the same day and time for each occurrence up to this date.</small></div><div class="booking-time-label">Available start times</div><div class="time-slots booking-times" role="group" aria-label="Available start times"></div><p class="booking-widget__hint">You can leave the calendar blank if you only want a quote.</p></div>
      <input type="hidden" name="booking_date" class="booking-date"><input type="hidden" name="booking_start" class="booking-start"><input type="hidden" name="booking_duration" class="booking-duration-value" value="120"><input type="hidden" name="booking_recurrence" class="booking-recurrence-value" value="once"><input type="hidden" name="booking_until" class="booking-until-value">`;

    var status = root.querySelector('.booking-widget__status');
    var grid = root.querySelector('.booking-grid');
    var monthLabel = root.querySelector('.booking-month');
    var selectedDate = root.querySelector('.booking-widget__selected-date');
    var times = root.querySelector('.booking-times');
    var durationSelect = root.querySelector('.booking-duration');
    var recurrenceSelect = root.querySelector('.booking-recurrence');
    var untilWrap = root.querySelector('.booking-until-wrap');
    var untilInput = root.querySelector('.booking-until');
    var dateInput = root.querySelector('.booking-date');
    var startInput = root.querySelector('.booking-start');
    var durationInput = root.querySelector('.booking-duration-value');
    var recurrenceInput = root.querySelector('.booking-recurrence-value');
    var untilValue = root.querySelector('.booking-until-value');
    durationSelect.value = String(state.duration);
    durationInput.value = String(state.duration);
    dateInput.value = state.date;
    startInput.value = state.start;
    if (state.date) selectedDate.textContent = niceDate(state.date) + (state.start ? ' — ' + niceTime(state.start) + ' selected' : ' — choose a start time');

    function pad(value) { return String(value).padStart(2, '0'); }
    function iso(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
    function parseIso(value) { var p = value.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
    function addMonths(date, amount) { return new Date(date.getFullYear(), date.getMonth() + amount, date.getDate()); }
    function minutesToTime(value) { return pad(Math.floor(value / 60)) + ':' + pad(value % 60); }
    function niceTime(value) { var p = value.split(':'); var hour = Number(p[0]); return (hour % 12 || 12) + ':' + p[1] + ' ' + (hour >= 12 ? 'pm' : 'am'); }
    function niceDate(value) { var date = parseIso(value); return days[date.getDay()] + ', ' + date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear(); }
    function hoursFor(date) { if (date.getDay() === 0) return null; return date.getDay() === 6 ? { open: 540, close: 960 } : { open: 480, close: 1080 }; }
    function blockedAt(date, time) { return !!(state.blocked[date] && state.blocked[date][time]); }
    function availableStarts(date, duration) {
      var hours = hoursFor(date); var result = [];
      if (!hours) return result;
      for (var start = hours.open; start + duration <= hours.close; start += 30) {
        var free = true;
        for (var slot = start; slot < start + duration; slot += 30) { if (blockedAt(iso(date), minutesToTime(slot))) { free = false; break; } }
        result.push({ time: minutesToTime(start), free: free });
      }
      return result;
    }
    function rangeForMonth(date) { return { from: iso(new Date(date.getFullYear(), date.getMonth(), 1)), to: iso(new Date(date.getFullYear(), date.getMonth() + 1, 0)) }; }
    function loadMonth() {
      var range = rangeForMonth(state.month); var key = range.from + ':' + range.to;
      if (!cache[key]) cache[key] = fetch('/api/booking-availability?' + new URLSearchParams(range).toString()).then(function (response) { if (!response.ok) throw new Error('Availability request failed'); return response.json(); });
      cache[key].then(applyAvailability).catch(handleAvailabilityError);
    }
    function applyAvailability(data) {
      state.blocked = {};
      (data.blocked || []).forEach(function (slot) { if (!state.blocked[slot.date]) state.blocked[slot.date] = {}; state.blocked[slot.date][slot.time] = true; });
      state.ready = true; status.textContent = 'Select a date, then choose a start time. Availability updates automatically.'; renderCalendar(); renderTimes();
    }
    function handleAvailabilityError() { state.ready = false; status.textContent = 'Live availability is temporarily unavailable. Please call 07843969254 to book a time.'; renderCalendar(); times.innerHTML = ''; }
    function renderCalendar() {
      var today = new Date(); today.setHours(0, 0, 0, 0); monthLabel.textContent = months[state.month.getMonth()] + ' ' + state.month.getFullYear(); grid.innerHTML = '';
      ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].forEach(function (day) { var heading = document.createElement('div'); heading.className = 'cal-day-name'; heading.textContent = day; grid.appendChild(heading); });
      var first = new Date(state.month.getFullYear(), state.month.getMonth(), 1).getDay(); var count = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0).getDate();
      for (var empty = 0; empty < first; empty++) { var blank = document.createElement('button'); blank.className = 'cal-day empty'; blank.disabled = true; grid.appendChild(blank); }
      for (var dayNumber = 1; dayNumber <= count; dayNumber++) {
        var date = new Date(state.month.getFullYear(), state.month.getMonth(), dayNumber); var value = iso(date); var button = document.createElement('button'); button.type = 'button'; button.className = 'cal-day'; button.textContent = dayNumber;
        var starts = state.ready ? availableStarts(date, state.duration) : []; var isFull = !starts.length;
        if (date.getTime() === today.getTime()) button.classList.add('today'); if (value === state.date) button.classList.add('selected');
        if (state.ready && starts.some(function (slot) { return slot.free; })) button.classList.add('cal-day--available'); if (state.ready && !isFull && starts.some(function (slot) { return !slot.free; })) button.classList.add('cal-day--some-taken'); if (state.ready && isFull) button.classList.add('cal-day--full');
        var closed = !hoursFor(date) || date < today || !state.ready || isFull; button.disabled = closed; button.setAttribute('aria-label', value + (isFull && state.ready ? ' fully booked' : ' available for booking'));
        if (!closed) button.addEventListener('click', function (selected) { return function () { state.date = selected; state.start = ''; dateInput.value = selected; startInput.value = ''; selectedDate.textContent = niceDate(selected) + ' — choose a start time'; renderCalendar(); renderTimes(); }; }(value));
        grid.appendChild(button);
      }
    }
    function renderTimes() {
      times.innerHTML = ''; if (!state.date || !state.ready) return;
      var starts = availableStarts(parseIso(state.date), state.duration); selectedDate.textContent = niceDate(state.date) + (state.start ? ' — ' + niceTime(state.start) + ' selected' : ' — choose a start time');
      starts.forEach(function (slot) { var button = document.createElement('button'); button.type = 'button'; button.className = 'time-slot'; button.textContent = niceTime(slot.time); if (!slot.free) { button.disabled = true; button.classList.add('time-slot--taken'); button.setAttribute('aria-label', niceTime(slot.time) + ' taken'); } else button.addEventListener('click', function () { state.start = slot.time; startInput.value = slot.time; times.querySelectorAll('.time-slot').forEach(function (item) { item.classList.remove('selected'); }); button.classList.add('selected'); selectedDate.textContent = niceDate(state.date) + ' — ' + niceTime(state.start) + ' selected'; }); times.appendChild(button); });
      if (!starts.some(function (slot) { return slot.free; })) { var note = document.createElement('p'); note.className = 'booking-widget__taken-note'; note.textContent = 'No start times are free for this duration. Try a shorter clean or another date.'; times.appendChild(note); }
    }
    function setUntilDefault() { var base = state.date ? parseIso(state.date) : new Date(); state.until = iso(addMonths(base, 12)); untilInput.value = state.until; untilValue.value = state.until; }

    root.querySelector('.booking-prev').addEventListener('click', function () { var now = new Date(); var previous = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); if (previous >= new Date(now.getFullYear(), now.getMonth(), 1)) { state.month = previous; renderCalendar(); loadMonth(); } });
    root.querySelector('.booking-next').addEventListener('click', function () { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); renderCalendar(); loadMonth(); });
    durationSelect.addEventListener('change', function () { state.duration = Number(durationSelect.value); durationInput.value = durationSelect.value; state.start = ''; startInput.value = ''; renderCalendar(); renderTimes(); });
    recurrenceSelect.addEventListener('change', function () { state.recurrence = recurrenceSelect.value; recurrenceInput.value = state.recurrence; untilWrap.hidden = state.recurrence === 'once'; if (state.recurrence === 'once') { state.until = ''; untilValue.value = ''; } else if (!state.until) setUntilDefault(); });
    untilInput.addEventListener('change', function () { state.until = untilInput.value; untilValue.value = state.until; });
    root.closest('form').addEventListener('reset', function () { setTimeout(function () { state.date = ''; state.start = ''; state.recurrence = 'once'; state.until = ''; dateInput.value = ''; startInput.value = ''; recurrenceInput.value = 'once'; untilValue.value = ''; untilWrap.hidden = true; selectedDate.textContent = 'Select a date to see available start times.'; renderCalendar(); renderTimes(); }, 0); });

    renderCalendar(); loadMonth();
  });
}());
