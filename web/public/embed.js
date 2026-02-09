/**
 * COLOSS Embed Widget Loader
 *
 * Handles iframe auto-resize and event listening for the COLOSS embeddable widget.
 * Zero dependencies, copy-paste ready.
 *
 * Usage:
 *   <iframe id="coloss-embed" src="https://app.coloss.nl/embed/EVENT_SLUG?sourceUrl=..."></iframe>
 *   <script src="https://app.coloss.nl/embed.js"></script>
 */
(function () {
  'use strict';

  // Find all COLOSS embed iframes on the page
  function findEmbedIframes() {
    var iframes = document.querySelectorAll('iframe[src*="/embed/"]');
    var result = [];
    for (var i = 0; i < iframes.length; i++) {
      var src = iframes[i].getAttribute('src') || '';
      // Match our embed URL pattern
      if (src.indexOf('/embed/') !== -1) {
        result.push(iframes[i]);
      }
    }
    return result;
  }

  // Initialize iframes with default styles
  function initIframes(iframes) {
    for (var i = 0; i < iframes.length; i++) {
      var iframe = iframes[i];
      // Set default styles if not already set
      if (!iframe.style.width) {
        iframe.style.width = '100%';
      }
      iframe.style.border = 'none';
      iframe.style.overflow = 'hidden';
      iframe.setAttribute('scrolling', 'no');
      // Minimum height while loading
      if (!iframe.style.minHeight) {
        iframe.style.minHeight = '400px';
      }
    }
  }

  // Find iframe by matching its origin to the message source
  function findIframeForEvent(iframes, event) {
    for (var i = 0; i < iframes.length; i++) {
      try {
        var src = iframes[i].getAttribute('src') || '';
        var url = new URL(src, window.location.href);
        if (url.origin === event.origin) {
          return iframes[i];
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
    return null;
  }

  // Handle messages from the embed iframe
  function handleMessage(event) {
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    // Only handle COLOSS messages
    if (typeof data.type !== 'string' || data.type.indexOf('coloss:') !== 0) return;

    var iframes = findEmbedIframes();
    var iframe = findIframeForEvent(iframes, event);

    switch (data.type) {
      case 'coloss:resize':
        if (iframe && typeof data.height === 'number' && data.height > 0) {
          iframe.style.height = data.height + 'px';
        }
        break;

      case 'coloss:ready':
        if (iframe) {
          iframe.setAttribute('data-coloss-ready', 'true');
        }
        // Dispatch custom event for integrators
        var readyEvent = new CustomEvent('coloss:ready', { detail: { iframe: iframe } });
        document.dispatchEvent(readyEvent);
        break;

      case 'coloss:checkout-complete':
        // Dispatch custom event for integrators
        var completeEvent = new CustomEvent('coloss:checkout-complete', {
          detail: {
            iframe: iframe,
            orderId: data.orderId,
            totalAmount: data.totalAmount,
          },
        });
        document.dispatchEvent(completeEvent);
        break;

      case 'coloss:error':
        // Dispatch custom event for integrators
        var errorEvent = new CustomEvent('coloss:error', {
          detail: { iframe: iframe, message: data.message },
        });
        document.dispatchEvent(errorEvent);
        break;
    }
  }

  // Initialize
  var iframes = findEmbedIframes();
  initIframes(iframes);
  window.addEventListener('message', handleMessage);

  // Re-scan for iframes that may be added dynamically
  if (typeof MutationObserver !== 'undefined') {
    var observer = new MutationObserver(function () {
      var current = findEmbedIframes();
      if (current.length > iframes.length) {
        initIframes(current);
        iframes = current;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
