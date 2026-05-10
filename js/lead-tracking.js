(function () {
  'use strict';

  const config = window.BRYANTCO || {};

  function hasTagManagerId(value) {
    return typeof value === 'string' && value.trim() && !value.includes('XXXX');
  }

  function loadTagManager() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'gtm.start': new Date().getTime(),
      event: 'gtm.js'
    });

    if (!hasTagManagerId(config.googleTagManagerId) || window.__bryantcoTagManagerLoaded) return;

    window.__bryantcoTagManagerLoaded = true;
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(config.googleTagManagerId);
    document.head.appendChild(script);
  }

  function trackEvent(name, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({
      event: name,
      page_location: window.location.href,
      page_title: document.title
    }, params || {}));
  }

  loadTagManager();

  document.addEventListener('click', function (event) {
    const link = event.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href') || '';
    if (href.indexOf('tel:') === 0) {
      trackEvent('phone_call_click', {
        phone_number: href.replace('tel:', ''),
        link_text: link.textContent.trim()
      });
    } else if (href.indexOf('mailto:') === 0) {
      trackEvent('email_click', {
        email_address: href.replace('mailto:', ''),
        link_text: link.textContent.trim()
      });
    } else if (href.indexOf('https://wa.me/') === 0) {
      trackEvent('whatsapp_click', {
        whatsapp_url: href,
        link_text: link.textContent.trim()
      });
    }
  });

  window.BryantCoTracking = {
    trackEvent,
    trackLead: function (formName) {
      trackEvent('lead_form_submit', {
        form_name: formName || 'quote_request'
      });
    }
  };
})();
