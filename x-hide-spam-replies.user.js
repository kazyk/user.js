// ==UserScript==
// @name         X status: hide verified replies (SPA safe)
// @namespace    https://example.invalid/
// @version      2.6.1
// @description  On https://x.com/*/status/* pages, hide verified-user tweets below the "Show replies" divider. Also hide replies that quote the reply author themselves, or that quote a verified account other than the OP. Tweets above the first "Show replies" and tweets sitting directly above an OP tweet stay visible.
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

  // An article that embeds a quoted tweet contains a second
  // data-testid="UserAvatar-Container-<username>" (the first one is the reply
  // author's avatar). The quoted tweet's own User-Name has no <a> — the
  // surrounding role="link" wrapper handles navigation — so the username has
  // to come from the avatar testid suffix. The verified flag is read from
  // the second User-Name div, which sits next to that avatar.
  function quotedTweetInfo(tweet) {
    const avatars = tweet.querySelectorAll(
      '[data-testid^="UserAvatar-Container-"]',
    );
    if (avatars.length < 2) return null;
    const m = (avatars[1].getAttribute("data-testid") || "").match(
      /^UserAvatar-Container-(.+)$/,
    );
    if (!m) return null;
    const userNames = tweet.querySelectorAll('div[data-testid="User-Name"]');
    const innerName = userNames[1] || null;
    return {
      userHref: normalizeHref("/" + m[1]),
      verified: !!innerName?.querySelector('svg[data-testid="icon-verified"]'),
    };
  }

  function isBefore(a, b) {
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  // Returns the first "Show replies" / "Show more replies" divider cell in
  // DOM order. There may be several such buttons on the page (e.g. for
  // nested sub-threads further down), so match explicitly by button text
  // and take the top-most one as the conversation boundary.
  function findShowRepliesBoundary() {
    const SHOW_REPLIES_RE = /^show(\s+more)?\s+replies$/i;
    for (const cell of document.querySelectorAll(
      '[data-testid="cellInnerDiv"]',
    )) {
      if (cell.querySelector('article[data-testid="tweet"]')) continue;
      for (const btn of cell.querySelectorAll("button")) {
        const text = (btn.textContent || "").trim();
        if (SHOW_REPLIES_RE.test(text) || /返信を表示/.test(text)) {
          return cell;
        }
      }
    }
    return null;
  }

  function evaluate() {
    scheduled = false;
    const info = parseStatusUrl();
    if (!info) return;

    currentStatusKey = `${info.user}/${info.id}`;

    const tweets = Array.from(
      document.querySelectorAll('article[data-testid="tweet"]'),
    );
    if (tweets.length === 0) return;

    const opHref = normalizeHref("/" + info.user);

    // Tweets whose NEXT neighbour in the DOM is an OP tweet. These sit
    // directly above an OP tweet ("OP のツイートの一つ上のツイート").
    const aboveOpIdx = new Set();
    for (let i = 1; i < tweets.length; i++) {
      const userHref = tweetUserHref(tweets[i]);
      if (userHref && userHref === opHref) aboveOpIdx.add(i - 1);
    }

    const showRepliesCell = findShowRepliesBoundary();

    for (let i = 0; i < tweets.length; i++) {
      const t = tweets[i];

      // Above the first "Show replies" divider — keep.
      if (showRepliesCell && isBefore(t, showRepliesCell)) {
        setHidden(t, false);
        continue;
      }

      // Directly above an OP tweet — keep.
      if (aboveOpIdx.has(i)) {
        setHidden(t, false);
        continue;
      }

      // OP's own tweet — keep.
      const userHref = tweetUserHref(t);
      if (userHref && userHref === opHref) {
        setHidden(t, false);
        continue;
      }

      const quote = quotedTweetInfo(t);
      if (quote && quote.userHref) {
        // Reply author quotes themselves.
        if (userHref && quote.userHref === userHref) {
          setHidden(t, true);
          continue;
        }
        // Reply quotes a verified non-OP account.
        if (quote.verified && quote.userHref !== opHref) {
          setHidden(t, true);
          continue;
        }
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
