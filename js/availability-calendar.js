/* Full-screen shared availability calendar, styled after the On Track calendar. */
(function () {
  'use strict';

  var root = document.querySelector('[data-availability-calendar]');
  if (!root) return;

  var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var cache = {};
  var now = new Date();
  var state = {
    view: 'month',
    cursor: new Date(now.getFullYear(), now.getMonth(), 1),
    selected: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    duration: 120,
    blocked: {},
    ready: false
  };

  var monthLabel = root.querySelector('[data-calendar-month]');
  var status = root.querySelector('[data-calendar-status]');
  var surface = root.querySelector('[data-calendar-surface]');
  var viewButtons = root.querySelectorAll('[data-calendar-view]');
  var durationSelect = root.querySelector('[data-calendar-duration]');

  function pad(value) { return String(value).padStart(2, '0'); }
  function iso(date) { return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()); }
  function fromIso(value) { var parts = value.split('-').map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
  function minutesToTime(value) { return pad(Math.floor(value / 60)) + ':' + pad(value % 60); }
  function timeToMinutes(value) { var parts = value.split(':').map(Number); return parts[0] * 60 + parts[1]; }
  function niceTime(value) { var parts = value.split(':'); var hour = Number(parts[0]); return (hour % 12 || 12) + ':' + parts[1] + ' ' + (hour >= 12 ? 'pm' : 'am'); }
  function niceDate(date) { return days[date.getDay()] + ', ' + date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear(); }
  function startOfWeek(date) { var result = new Date(date); result.setDate(result.getDate() - result.getDay()); return result; }
  function addDays(date, amount) { var result = new Date(date); result.setDate(result.getDate() + amount); return result; }
  function sameDay(left, right) { return iso(left) === iso(right); }
  function hoursFor(date) { if (date.getDay() === 0) return null; return date.getDay() === 6 ? { open: 540, close: 960 } : { open: 480, close: 1080 }; }
  function blockedAt(date, time) { return !!(state.blocked[iso(date)] && state.blocked[iso(date)][time]); }

  function rangeForView() {
    if (state.view === 'day') return { from: iso(state.selected), to: iso(state.selected) };
    if (state.view === 'week') {
      var weekStart = startOfWeek(state.selected);
      return { from: iso(weekStart), to: iso(addDays(weekStart, 6)) };
    }
    return {
      from: iso(new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1)),
      to: iso(new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 0))
    };
  }

  function availableStarts(date, duration) {
    var hours = hoursFor(date);
    var result = [];
    if (!hours) return result;
    for (var start = hours.open; start + duration <= hours.close; start += 30) {
      var free = true;
      for (var slot = start; slot < start + duration; slot += 30) {
        if (blockedAt(date, minutesToTime(slot))) { free = false; break; }
      }
      result.push({ time: minutesToTime(start), free: free });
    }
    return result;
  }

  function mergedBlocks(date) {
    var hours = hoursFor(date);
    var blocked = state.blocked[iso(date)] || {};
    var values = Object.keys(blocked).sort();
    var result = [];
    if (!hours) return result;
    values.forEach(function (time) {
      var start = timeToMinutes(time);
      var previous = result[result.length - 1];
      if (previous && previous.end === start) previous.end += 30;
      else result.push({ start: start, end: start + 30 });
    });
    return result;
  }

  function setBlocked(data) {
    state.blocked = {};
    (data.blocked || []).forEach(function (slot) {
      if (!state.blocked[slot.date]) state.blocked[slot.date] = {};
      state.blocked[slot.date][slot.time] = true;
    });
  }

  function loadAvailability() {
    var range = rangeForView();
    var key = range.from + ':' + range.to;
    state.ready = false;
    status.textContent = 'Loading live availability…';
    renderSurface();
    if (!cache[key]) {
      cache[key] = fetch('/api/booking-availability?' + new URLSearchParams(range).toString())
        .then(function (response) { if (!response.ok) throw new Error('Availability request failed'); return response.json(); });
    }
    cache[key].then(function (data) {
      setBlocked(data);
      state.ready = true;
      status.textContent = 'Live availability updates automatically. Click a free time to request it.';
      renderSurface();
    }).catch(function () {
      state.ready = false;
      status.textContent = 'Live availability is temporarily unavailable. Please call 07843969254.';
      renderSurface();
    });
  }

  function eventClass(index) { return 'availability-event--taken-' + ((index % 3) + 1); }

  function cellMarkup(date, outside) {
    var dateValue = iso(date);
    var hours = hoursFor(date);
    var blocks = mergedBlocks(date);
    var starts = state.ready ? availableStarts(date, state.duration) : [];
    var freeCount = starts.filter(function (slot) { return slot.free; }).length;
    var content = '';
    if (outside) return '<article class="availability-cell is-outside"><div class="availability-day-head"><button class="availability-day-number" type="button" data-select-date="' + dateValue + '" aria-label="View ' + niceDate(date) + '">' + date.getDate() + '</button></div><div class="availability-cell__content"></div></article>';
    if (!hours) content = '<span class="availability-closed-note">Closed Sunday</span>';
    else if (!state.ready) content = '<span class="availability-closed-note">Checking slots…</span>';
    else {
      blocks.forEach(function (block, index) {
        content += '<div class="availability-event ' + eventClass(index) + '"><small>' + niceTime(minutesToTime(block.start)) + '–' + niceTime(minutesToTime(block.end)) + '</small>Taken</div>';
      });
      if (freeCount) content += '<button class="availability-free-note" type="button" data-select-date="' + dateValue + '">' + freeCount + ' free starts · view times</button>';
      if (!blocks.length && !freeCount) content += '<span class="availability-closed-note">Fully booked</span>';
    }
    return '<article class="availability-cell' + (outside ? ' is-outside' : '') + (sameDay(date, now) ? ' is-today' : '') + '">' +
      '<div class="availability-day-head"><button class="availability-day-number" type="button" data-select-date="' + dateValue + '" aria-label="View ' + niceDate(date) + '">' + date.getDate() + '</button></div>' +
      '<div class="availability-cell__content">' + content + '</div></article>';
  }

  function weekdaysMarkup() { return shortDays.map(function (day) { return '<div class="availability-weekday">' + day + '</div>'; }).join(''); }

  function renderMonth() {
    var first = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
    var count = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 0).getDate();
    var html = weekdaysMarkup();
    for (var index = 0; index < first.getDay(); index++) html += cellMarkup(new Date(state.cursor.getFullYear(), state.cursor.getMonth(), index - first.getDay() + 1), true);
    for (var day = 1; day <= count; day++) html += cellMarkup(new Date(state.cursor.getFullYear(), state.cursor.getMonth(), day), false);
    var trailing = (7 - ((first.getDay() + count) % 7)) % 7;
    for (var trailingDay = 1; trailingDay <= trailing; trailingDay++) html += cellMarkup(new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, trailingDay), true);
    surface.innerHTML = '<div class="availability-calendar-head"><strong>' + months[state.cursor.getMonth()] + ' ' + state.cursor.getFullYear() + '</strong><span>Available times are green · taken bookings are colour-coded</span></div><div class="availability-month-grid">' + html + '</div>';
  }

  function renderWeek() {
    var weekStart = startOfWeek(state.selected);
    var html = '';
    for (var index = 0; index < 7; index++) html += '<div class="availability-weekday">' + shortDays[index] + ' ' + addDays(weekStart, index).getDate() + '</div>';
    for (var day = 0; day < 7; day++) html += cellMarkup(addDays(weekStart, day), false);
    surface.innerHTML = '<div class="availability-calendar-head"><strong>Week of ' + niceDate(weekStart) + '</strong><span>Choose a day to see individual start times</span></div><div class="availability-week-grid">' + html + '</div>';
  }

  function renderDay() {
    var date = state.selected;
    var hours = hoursFor(date);
    var body = '';
    if (!hours) body = '<div class="availability-empty">Sunday is closed. Please choose Monday to Saturday.</div>';
    else if (!state.ready) body = '<div class="availability-empty">Checking live slots…</div>';
    else {
      for (var start = hours.open; start < hours.close; start += 30) {
        var value = minutesToTime(start);
        var canStart = start + state.duration <= hours.close;
        var free = canStart && availableStarts(date, state.duration).some(function (slot) { return slot.time === value && slot.free; });
        body += '<button class="availability-slot ' + (free ? 'is-free' : (canStart ? 'is-taken' : 'is-unavailable')) + '" type="button" ' + (free ? 'data-request-date="' + iso(date) + '" data-request-time="' + value + '"' : 'disabled') + '><span>' + niceTime(value) + '</span><small>' + (free ? 'Request this slot' : (canStart ? 'Taken' : 'Outside opening hours')) + '</small></button>';
      }
    }
    surface.innerHTML = '<div class="availability-calendar-head"><strong>' + niceDate(date) + '</strong><span>Cleaning duration: ' + (state.duration / 60) + ' hour' + (state.duration === 60 ? '' : 's') + '</span></div><div class="availability-day-view"><aside class="availability-day-summary"><h2>' + (hours ? 'Choose a start time' : 'Closed') + '</h2><p>Click a green slot to continue your request through the contact form.</p></aside><div class="availability-day-slots">' + body + '</div></div>';
  }

  function renderSurface() {
    monthLabel.textContent = state.view === 'day' ? months[state.selected.getMonth()] + ' ' + state.selected.getFullYear() : months[state.cursor.getMonth()] + ' ' + state.cursor.getFullYear();
    viewButtons.forEach(function (button) { button.classList.toggle('is-active', button.getAttribute('data-calendar-view') === state.view); });
    if (state.view === 'month') renderMonth();
    else if (state.view === 'week') renderWeek();
    else renderDay();
  }

  function move(amount) {
    if (state.view === 'month') state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + amount, 1);
    else if (state.view === 'week') state.selected = addDays(state.selected, amount * 7);
    else state.selected = addDays(state.selected, amount);
    if (state.view !== 'month') state.cursor = new Date(state.selected.getFullYear(), state.selected.getMonth(), 1);
    loadAvailability();
  }

  root.addEventListener('click', function (event) {
    var viewButton = event.target.closest('[data-calendar-view]');
    if (viewButton) {
      state.view = viewButton.getAttribute('data-calendar-view');
      state.cursor = new Date(state.selected.getFullYear(), state.selected.getMonth(), 1);
      loadAvailability();
      return;
    }
    var dateButton = event.target.closest('[data-select-date]');
    if (dateButton) {
      state.selected = fromIso(dateButton.getAttribute('data-select-date'));
      state.cursor = new Date(state.selected.getFullYear(), state.selected.getMonth(), 1);
      state.view = 'day';
      loadAvailability();
      return;
    }
    var requestButton = event.target.closest('[data-request-date][data-request-time]');
    if (requestButton) {
      var params = new URLSearchParams({ booking_date: requestButton.getAttribute('data-request-date'), booking_start: requestButton.getAttribute('data-request-time'), booking_duration: String(state.duration) });
      window.location.href = 'contact.html?' + params.toString();
    }
  });

  root.querySelector('[data-calendar-prev]').addEventListener('click', function () { move(-1); });
  root.querySelector('[data-calendar-next]').addEventListener('click', function () { move(1); });
  root.querySelector('[data-calendar-today]').addEventListener('click', function () {
    state.selected = new Date();
    state.selected.setHours(0, 0, 0, 0);
    state.cursor = new Date(state.selected.getFullYear(), state.selected.getMonth(), 1);
    loadAvailability();
  });
  durationSelect.addEventListener('change', function () { state.duration = Number(durationSelect.value); renderSurface(); });

  renderSurface();
  loadAvailability();
}());
