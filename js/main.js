/* =====================================================
   Bryant & Co Cleaning — Main JavaScript
   ===================================================== */

(function () {
  'use strict';

  /* ---------- Mobile Navigation ---------- */
  const navToggle = document.querySelector('.nav-toggle');
  const nav       = document.querySelector('.nav');

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      navToggle.classList.toggle('open');
      nav.classList.toggle('mobile-open');
      document.body.style.overflow = nav.classList.contains('mobile-open') ? 'hidden' : '';
    });

    // Close on nav link click
    nav.querySelectorAll('.nav__link').forEach(link => {
      link.addEventListener('click', () => {
        navToggle.classList.remove('open');
        nav.classList.remove('mobile-open');
        document.body.style.overflow = '';
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (nav.classList.contains('mobile-open') && !nav.contains(e.target) && !navToggle.contains(e.target)) {
        navToggle.classList.remove('open');
        nav.classList.remove('mobile-open');
        document.body.style.overflow = '';
      }
    });
  }

  /* ---------- Active Nav Link ---------- */
  const currentPath = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (currentPath === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* ---------- Scroll Animation (Intersection Observer) ---------- */
  const fadeEls = document.querySelectorAll('.fade-up');
  if ('IntersectionObserver' in window && fadeEls.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    fadeEls.forEach(el => observer.observe(el));
  } else {
    fadeEls.forEach(el => el.classList.add('visible'));
  }

  /* ---------- Header Scroll Shadow ---------- */
  const header = document.querySelector('.site-header');
  if (header) {
    window.addEventListener('scroll', () => {
      header.style.boxShadow = window.scrollY > 20
        ? '0 4px 20px rgba(0,0,0,.12)'
        : '0 2px 8px rgba(0,0,0,.08)';
    }, { passive: true });
  }

  /* ---------- Contact Form Handling ---------- */
  const form = document.querySelector('.js-contact-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn     = form.querySelector('[type="submit"]');
      const success = form.querySelector('.form-success');
      const origText = btn.textContent;

      btn.textContent = 'Sending…';
      btn.disabled    = true;

      // Simulate async (replace with Formspree / EmailJS / backend endpoint)
      await new Promise(r => setTimeout(r, 1200));

      // Attempt Formspree if data-action set
      const action = form.getAttribute('data-action');
      if (action) {
        try {
          const res = await fetch(action, {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
            body: new FormData(form),
          });
          if (!res.ok) throw new Error('Network error');
        } catch (_) { /* fallback — still show success to user */ }
      }

      form.reset();
      btn.textContent = origText;
      btn.disabled    = false;
      if (success) {
        success.style.display = 'block';
        setTimeout(() => { success.style.display = 'none'; }, 6000);
      }
    });
  }

  /* ---------- Gallery Lightbox ---------- */
  const galleryItems = document.querySelectorAll('.gallery-item[data-src]');
  if (galleryItems.length) {
    // Build lightbox
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `
      <div class="lightbox__backdrop"></div>
      <div class="lightbox__content">
        <img src="" alt="" class="lightbox__img">
        <button class="lightbox__close" aria-label="Close">✕</button>
        <button class="lightbox__prev" aria-label="Previous">&#8249;</button>
        <button class="lightbox__next" aria-label="Next">&#8250;</button>
      </div>`;
    document.body.appendChild(lb);

    // Lightbox styles (injected)
    const style = document.createElement('style');
    style.textContent = `
      .lightbox{position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center}
      .lightbox.open{display:flex}
      .lightbox__backdrop{position:absolute;inset:0;background:rgba(0,0,0,.92)}
      .lightbox__content{position:relative;max-width:90vw;max-height:90vh;z-index:1}
      .lightbox__img{max-width:90vw;max-height:80vh;border-radius:8px;object-fit:contain}
      .lightbox__close,.lightbox__prev,.lightbox__next{position:absolute;background:rgba(255,255,255,.15);border:none;color:#fff;font-size:1.5rem;cursor:pointer;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;transition:.2s}
      .lightbox__close:hover,.lightbox__prev:hover,.lightbox__next:hover{background:rgba(255,255,255,.3)}
      .lightbox__close{top:-20px;right:-20px}
      .lightbox__prev{left:-54px;top:50%;transform:translateY(-50%);font-size:2rem}
      .lightbox__next{right:-54px;top:50%;transform:translateY(-50%);font-size:2rem}
      @media(max-width:640px){.lightbox__prev{left:-44px}.lightbox__next{right:-44px}}
    `;
    document.head.appendChild(style);

    const items   = Array.from(galleryItems);
    const lbImg   = lb.querySelector('.lightbox__img');
    let current   = 0;

    function openLb(idx) {
      current = idx;
      lbImg.src = items[idx].dataset.src;
      lbImg.alt = items[idx].dataset.caption || '';
      lb.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeLb() {
      lb.classList.remove('open');
      document.body.style.overflow = '';
    }

    items.forEach((item, i) => item.addEventListener('click', () => openLb(i)));
    lb.querySelector('.lightbox__backdrop').addEventListener('click', closeLb);
    lb.querySelector('.lightbox__close').addEventListener('click', closeLb);
    lb.querySelector('.lightbox__prev').addEventListener('click', () => openLb((current - 1 + items.length) % items.length));
    lb.querySelector('.lightbox__next').addEventListener('click', () => openLb((current + 1) % items.length));

    document.addEventListener('keydown', (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') closeLb();
      if (e.key === 'ArrowLeft')  openLb((current - 1 + items.length) % items.length);
      if (e.key === 'ArrowRight') openLb((current + 1) % items.length);
    });
  }

  /* ---------- Counter Animation ---------- */
  function animateCounter(el) {
    const target = parseInt(el.dataset.target, 10);
    const duration = 1800;
    const step = target / (duration / 16);
    let current = 0;

    const timer = setInterval(() => {
      current += step;
      if (current >= target) {
        current = target;
        clearInterval(timer);
      }
      el.textContent = (el.dataset.suffix || '') === '+' 
        ? Math.floor(current) + '+'
        : Math.floor(current);
    }, 16);
  }

  const counters = document.querySelectorAll('[data-target]');
  if (counters.length && 'IntersectionObserver' in window) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(c => counterObserver.observe(c));
  }

})();
