// ==UserScript==
// @name         X status: hide verified replies (SPA safe)
// @namespace    https://example.invalid/
// @version      2.1.0
// @description  On https://x.com/*/status/* pages, hide verified-user tweets in the reply section. Ancestors (tweets the OP is replying to) and OP's own tweets stay visible.
// @match        https://x.com/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  "use strict";

  const URL_RE = /^https:\/\/x\.com\/([^/]+)\/status\/(\d+)/;
  const HIDE_CLASS = "tm-hide-verified-reply";

  GM_addStyle(`
    .${HIDE_CLASS} { display: none !important; }
  `);

  let mo = null;
  let lastHref = location.href;
  let scheduled = false;

  // Per-status-URL state
  let currentStatusKey = null;
  let ancestorIds = new Set();

  function normalizeHref(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      const path = (u.pathname || "").replace(/\/+$/, "");
      return `${u.origin}${path}`;
    } catch {
      return null;
    }
  }

  function parseStatusUrl() {
    const m = location.href.match(URL_RE);
    if (!m) return null;
    return { user: m[1], id: m[2] };
  }

  function setHidden(el, hidden) {
    if (!el) return;
    const cell = el.closest('[data-testid="cellInnerDiv"]') || el;
    if (hidden) {
      el.classList.add(HIDE_CLASS);
      cell.classList.add(HIDE_CLASS);
    } else {
      el.classList.remove(HIDE_CLASS);
      cell.classList.remove(HIDE_CLASS);
    }
  }

  function tweetUserHref(tweet) {
    const uDiv = tweet.querySelector('div[data-testid="User-Name"]');
    if (!uDiv) return null;
    const a = uDiv.querySelector('a[href^="/"]');
    return normalizeHref(a?.getAttribute("href"));
  }

  function tweetIsVerified(tweet) {
    const uDiv = tweet.querySelector('div[data-testid="User-Name"]');
    return !!uDiv?.querySelector('svg[data-testid="icon-verified"]');
  }

  function tweetStatusId(tweet) {
    for (const a of tweet.querySelectorAll('a[href*="/status/"]')) {
      const m = a.getAttribute("href").match(/^\/[^/]+\/status\/(\d+)$/);
      if (m) return m[1];
    }
    return null;
  }

  function evaluate() {
    scheduled = false;
    const info = parseStatusUrl();
    if (!info) return;

    const statusKey = `${info.user}/${info.id}`;
    if (statusKey !== currentStatusKey) {
      currentStatusKey = statusKey;
      ancestorIds = new Set();
    }

    const tweets = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]'),
    );
    if (tweets.length === 0) return;

    const opHref = normalizeHref("/" + info.user);
    const permalink = `/${info.user}/status/${info.id}`;

    // Locate the focal (main) tweet in the current DOM, if present.
    const mainIdx = tweets.findIndex((t) =>
      t.querySelector(`a[href="${permalink}"]`),
    );

    // If the focal tweet is in the DOM, memoize ancestor IDs.
    if (mainIdx !== -1) {
      for (let i = 0; i < mainIdx; i++) {
        const id = tweetStatusId(tweets[i]);
        if (id) ancestorIds.add(id);
      }
    }

    for (let i = 0; i < tweets.length; i++) {
      const t = tweets[i];
      const tid = tweetStatusId(t);

      // Main tweet — keep.
      if (tid && tid === info.id) {
        setHidden(t, false);
        continue;
      }

      // Known ancestor (OP is replying to it) — keep.
      if (tid && ancestorIds.has(tid)) {
        setHidden(t, false);
        continue;
      }

      // Currently above the main tweet — also an ancestor; memoize & keep.
      if (mainIdx !== -1 && i < mainIdx) {
        if (tid) ancestorIds.add(tid);
        setHidden(t, false);
        continue;
      }

      // OP's own tweets (self-thread replies) — keep.
      const userHref = tweetUserHref(t);
      if (userHref && userHref === opHref) {
        setHidden(t, false);
        continue;
      }

      setHidden(t, tweetIsVerified(t));
    }
  }

  function scheduleEvaluate() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(evaluate, 5);
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
    document
      .querySelectorAll(`.${HIDE_CLASS}`)
      .forEach((el) => el.classList.remove(HIDE_CLASS));
  }

  function isStatusUrl() {
    return URL_RE.test(location.href);
  }

  function onUrlPossiblyChanged() {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;

    if (isStatusUrl()) {
      connectObserver();
      scheduleEvaluate();
    } else {
      disconnectObserver();
      unhideAll();
      currentStatusKey = null;
      ancestorIds = new Set();
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

    if (isStatusUrl()) {
      connectObserver();
      scheduleEvaluate();
    }

    setInterval(onUrlPossiblyChanged, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
