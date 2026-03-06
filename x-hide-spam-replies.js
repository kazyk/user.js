// ==UserScript==
// @name         X status: hide verified non-OP tweets (SPA safe)
// @namespace    https://example.invalid/
// @version      1.0.0
// @description  On https://x.com/*/status/* pages, hide verified tweets that are not the first tweet and not by the OP (based on User-Name link match).
// @match        https://x.com/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const URL_RE = /^https:\/\/x\.com\/[^/]+\/status\/\d+(?:[/?#]|$)$/;
  const HIDE_CLASS = "tm-hide-verified-nonop";

  GM_addStyle(`
    .${HIDE_CLASS} { display: none !important; }
  `);

  let mo = null;
  let lastHref = location.href;
  let scheduled = false;

  function normalizeHref(href) {
    if (!href) return null;
    try {
      // X often uses relative paths like "/someuser"
      const u = new URL(href, location.origin);
      // We only need "identity" at the profile path level.
      // Normalize: origin + pathname (trim trailing slash)
      const path = (u.pathname || "").replace(/\/+$/, "");
      return `${u.origin}${path}`;
    } catch {
      return null;
    }
  }

  function isStatusUrl() {
    return URL_RE.test(location.href);
  }

  function setHidden(el, hidden) {
    if (!el) return;
    if (hidden) el.classList.add(HIDE_CLASS);
    else el.classList.remove(HIDE_CLASS);
  }

  function evaluate() {
    scheduled = false;
    if (!isStatusUrl()) return;

    // Collect tweets in document order.
    const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    if (tweets.length === 0) return;

    const firstTweet = tweets[0];

    // OP link is taken from the first tweet's User-Name area
    const firstUserLink = firstTweet.querySelector('div[data-testid="User-Name"] a[href]');
    const opHref = normalizeHref(firstUserLink?.getAttribute("href"));

    // Always ensure the first tweet is visible
    setHidden(firstTweet, false);

    // If opHref isn't available yet (SPA still rendering), don't hide anything yet.
    if (!opHref) {
      for (let i = 1; i < tweets.length; i++) setHidden(tweets[i], false);
      return;
    }

    for (let i = 1; i < tweets.length; i++) {
      const t = tweets[i];

      // Condition 2: contains verified icon svg
      const hasVerifiedIcon = !!t.querySelector('svg[data-testid="icon-verified"]');

      if (!hasVerifiedIcon) {
        setHidden(t, false);
        continue;
      }

      // Condition 4: inside this tweet's User-Name div, it DOES NOT include a link equal to opHref
      const userNameDiv = t.querySelector('div[data-testid="User-Name"]');
      const hasOpLinkInsideUserName =
        !!userNameDiv &&
        Array.from(userNameDiv.querySelectorAll('a[href]'))
          .map(a => normalizeHref(a.getAttribute("href")))
          .some(h => h === opHref);

      // Hide iff:
      // - verified (cond2)
      // - not first tweet (cond3 already by i>=1)
      // - does NOT have OP link within its User-Name area (cond4)
      const shouldHide = !hasOpLinkInsideUserName;
      setHidden(t, shouldHide);
    }
  }

  function scheduleEvaluate() {
    if (scheduled) return;
    scheduled = true;
    // Micro-debounce to coalesce multiple DOM mutations
    setTimeout(evaluate, 0);
  }

  function disconnectObserver() {
    if (mo) {
      mo.disconnect();
      mo = null;
    }
  }

  function connectObserver() {
    if (mo) return;
    mo = new MutationObserver(() => scheduleEvaluate());
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  function unhideAll() {
    document.querySelectorAll(`article[data-testid="tweet"].${HIDE_CLASS}`)
      .forEach(el => el.classList.remove(HIDE_CLASS));
  }

  function onUrlPossiblyChanged() {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;

    if (isStatusUrl()) {
      connectObserver();
      scheduleEvaluate();
    } else {
      // Leaving a status page: stop and revert
      disconnectObserver();
      unhideAll();
    }
  }

  function hookHistory() {
    const _pushState = history.pushState;
    const _replaceState = history.replaceState;

    history.pushState = function (...args) {
      const ret = _pushState.apply(this, args);
      onUrlPossiblyChanged();
      return ret;
    };

    history.replaceState = function (...args) {
      const ret = _replaceState.apply(this, args);
      onUrlPossiblyChanged();
      return ret;
    };

    window.addEventListener("popstate", onUrlPossiblyChanged, true);
  }

  function bootstrap() {
    hookHistory();

    // Initial state
    if (isStatusUrl()) {
      connectObserver();
      scheduleEvaluate();
    }

    // Fallback polling (covers cases where SPA changes URL without history hooks firing as expected)
    setInterval(onUrlPossiblyChanged, 500);
  }

  // document-start safe: wait for minimal DOM
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
