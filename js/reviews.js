/* Bryant & Co Cleaning — shared customer review slideshow */
(function () {
  'use strict';

  var roots = document.querySelectorAll('[data-reviews-carousel]');
  if (!roots.length) return;

  var fallbackReviews = [
    { first_name: 'James', last_name: 'H.', rating: 5, message: 'Really impressed with the standard of cleaning. The team were friendly, punctual and left everything spotless.', location: 'Poole' },
    { first_name: 'Linda', last_name: 'T.', rating: 5, message: 'Had a deep clean done before a family event and the results were incredible. Great communication throughout too.', location: 'Christchurch' }
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function reviewName(review) {
    var first = String(review.first_name || '').trim();
    var last = String(review.last_name || '').trim();
    return (first || 'Customer') + (last ? ' ' + last.charAt(0).replace(/[^A-Za-z]/g, '') + '.' : '');
  }

  function ratingValue(review) {
    var parsed = Number.parseInt(review.rating, 10);
    return Math.min(5, Math.max(1, Number.isFinite(parsed) ? parsed : 5));
  }

  function render(root, reviews) {
    root._reviews = reviews;
    var track = root.querySelector('[data-reviews-track]');
    var status = root.querySelector('[data-reviews-status]');
    if (!track) return;

    track.innerHTML = reviews.map(function (review) {
      var rating = ratingValue(review);
      var stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
      var location = review.location ? '<div class="testimonial-card__loc">' + escapeHtml(review.location) + '</div>' : '';
      return '<article class="testimonial-card reviews-carousel__slide">' +
        '<div class="testimonial-card__stars" aria-label="' + rating + ' out of 5 stars">' + stars + '</div>' +
        '<p class="testimonial-card__text">&ldquo;' + escapeHtml(review.message) + '&rdquo;</p>' +
        '<div class="testimonial-card__author"><div class="testimonial-card__avatar" aria-hidden="true">' + escapeHtml(String(review.first_name || 'C').charAt(0).toUpperCase()) + '</div><div><div class="testimonial-card__name">' + escapeHtml(reviewName(review)) + '</div>' + location + '</div></div>' +
        '</article>';
    }).join('');

    var slides = Array.prototype.slice.call(track.querySelectorAll('.reviews-carousel__slide'));
    var current = 0;
    var previous = root.querySelector('[data-reviews-prev]');
    var next = root.querySelector('[data-reviews-next]');
    var dots = root.querySelector('[data-reviews-dots]');

    function show(index) {
      current = (index + slides.length) % slides.length;
      slides.forEach(function (slide, slideIndex) { slide.classList.toggle('is-active', slideIndex === current); });
      if (dots) dots.innerHTML = slides.map(function (_, dotIndex) { return '<button type="button" class="reviews-carousel__dot' + (dotIndex === current ? ' is-active' : '') + '" data-review-dot="' + dotIndex + '" aria-label="Show review ' + (dotIndex + 1) + '" aria-pressed="' + (dotIndex === current ? 'true' : 'false') + '"></button>'; }).join('');
      if (status) status.textContent = reviews.length + (reviews.length === 1 ? ' customer review' : ' customer reviews');
    }

    if (previous) previous.onclick = function () { show(current - 1); };
    if (next) next.onclick = function () { show(current + 1); };
    if (dots) dots.onclick = function (event) { var button = event.target.closest('[data-review-dot]'); if (button) show(Number(button.getAttribute('data-review-dot'))); };
    show(0);

    if (root._reviewTimer) clearInterval(root._reviewTimer);
    if (slides.length > 1) root._reviewTimer = setInterval(function () { show(current + 1); }, 6500);
  }

  function load(root) {
    render(root, fallbackReviews);
    fetch('/api/reviews', { headers: { 'Accept': 'application/json' } })
      .then(function (response) { if (!response.ok) throw new Error('Review feed unavailable'); return response.json(); })
      .then(function (data) { render(root, Array.isArray(data.reviews) && data.reviews.length ? data.reviews : fallbackReviews); })
      .catch(function () { render(root, fallbackReviews); });
  }

  roots.forEach(load);

  window.addEventListener('review:submitted', function (event) {
    roots.forEach(function (root) {
      var submitted = event.detail || {};
      var cached = root._reviews || fallbackReviews;
      root._reviews = [submitted].concat(cached);
      render(root, root._reviews);
    });
  });
}());
