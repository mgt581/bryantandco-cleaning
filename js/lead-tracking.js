(function () {
  'use strict';

  var config = window.BRYANTCO || {};
  var pageTracked = false;
  var configLoaded = false;

  function clean(value) {
    return String(value || '').trim();
  }

  function getStorageValue(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return '';
    }
  }

  function setStorageValue(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) {}
  }

  function randomId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function getClientId() {
    var key = 'bryantco_client_id';
    var value = getStorageValue(window.localStorage, key);
    if (!value) {
      value = randomId('client');
      setStorageValue(window.localStorage, key, value);
    }
    return value;
  }

  function getSessionId() {
    var key = 'bryantco_session_id';
    var value = getStorageValue(window.sessionStorage, key);
    if (!value) {
      value = randomId('session');
      setStorageValue(window.sessionStorage, key, value);
    }
    return value;
  }

  function getLandingPage() {
    var key = 'bryantco_landing_page';
    var value = getStorageValue(window.sessionStorage, key);
    if (!value) {
      value = window.location.href;
      setStorageValue(window.sessionStorage, key, value);
    }
    return value;
  }

  function getFirstTouchAttribution() {
    var key = 'bryantco_first_touch_attribution';
    var stored = getStorageValue(window.sessionStorage, key);

    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (error) {}
    }

    var params = new URLSearchParams(window.location.search);
    var attribution = {
      referrer: document.referrer || '',
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_term: params.get('utm_term') || '',
      utm_content: params.get('utm_content') || '',
      gclid: params.get('gclid') || '',
      fbclid: params.get('fbclid') || '',
      msclkid: params.get('msclkid') || ''
    };

    setStorageValue(window.sessionStorage, key, JSON.stringify(attribution));
    return attribution;
  }

  function getAttribution() {
    var firstTouch = getFirstTouchAttribution();
    return {
      page: window.location.href,
      landing_page: getLandingPage(),
      referrer: firstTouch.referrer || '',
      utm_source: firstTouch.utm_source || '',
      utm_medium: firstTouch.utm_medium || '',
      utm_campaign: firstTouch.utm_campaign || '',
      utm_term: firstTouch.utm_term || '',
      utm_content: firstTouch.utm_content || '',
      gclid: firstTouch.gclid || '',
      fbclid: firstTouch.fbclid || '',
      msclkid: firstTouch.msclkid || '',
      session_id: getSessionId(),
      client_id: getClientId()
    };
  }

  function getLeadEndpoint() {
    return clean(config.leadEndpoint || '/api/send-lead');
  }

  function getLeadEventEndpoint() {
    return clean(config.leadEventEndpoint || '/api/lead-event');
  }

  function getGtmId() {
    return clean(config.googleTagManagerId || '');
  }

  function loadGtm() {
    if (configLoaded) return;
    configLoaded = true;

    var gtmId = getGtmId();
    if (!gtmId || window.__bryantcoTagManagerLoaded) return;

    window.__bryantcoTagManagerLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'gtm.start': new Date().getTime(),
      event: 'gtm.js'
    });

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(gtmId);
    document.head.appendChild(script);
  }

  function trackEvent(name, params, options) {
    var eventName = clean(name);
    if (!eventName) return;

    var payload = Object.assign({}, getAttribution(), params || {}, { event_name: eventName });
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: eventName }, params || {}));

    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }

    if (options && options.store === false) return;

    var body = JSON.stringify(payload);
    var endpoint = getLeadEventEndpoint();
    if (!endpoint) return;

    if (navigator.sendBeacon) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, blob)) return;
      } catch (error) {}
    }

    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function () {});
  }

  function trackLead(formName) {
    trackEvent('generate_lead', {
      form_name: formName || 'quote_request',
      source: 'website'
    }, { store: false });
  }

  function trackPageView() {
    if (pageTracked) return;
    pageTracked = true;
    trackEvent('page_view', {
      page_title: document.title,
      page_location: window.location.href,
      source: 'website'
    });
  }

  function trackThankYouView() {
    var pathname = window.location.pathname.toLowerCase();
    if (pathname.indexOf('thank-you') === -1) return;
    trackEvent('lead_thank_you_view', {
      page_title: document.title,
      page_location: window.location.href,
      source: 'website'
    });
  }

  function trackClicks() {
    document.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;

      var href = link.getAttribute('href') || '';
      if (href.indexOf('tel:') === 0) {
        trackEvent('phone_click', {
          phone_number: href.replace('tel:', ''),
          link_text: link.textContent.trim(),
          link_url: link.href
        });
        return;
      }

      if (href.indexOf('mailto:') === 0) {
        trackEvent('email_click', {
          email_address: href.replace('mailto:', ''),
          link_text: link.textContent.trim(),
          link_url: link.href
        });
        return;
      }

      if (link.href.indexOf('wa.me') !== -1) {
        var match = link.href.match(/wa\.me\/([^?]+)/);
        trackEvent('whatsapp_click', {
          whatsapp_number: match ? match[1] : '',
          link_text: link.textContent.trim(),
          link_url: link.href
        });
        return;
      }

      if (href.indexOf('contact.html') !== -1 || href.indexOf('/contact') !== -1) {
        trackEvent('quote_cta_click', {
          link_text: link.textContent.trim(),
          link_url: link.href
        });
      }
    });
  }

  function init() {
    loadGtm();
    trackPageView();
    trackThankYouView();
    trackClicks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.BryantCoTracking = {
    getAttribution: getAttribution,
    trackEvent: trackEvent,
    trackLead: trackLead
  };
})();
