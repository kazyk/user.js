// ==UserScript==
// @name         Auto Block Button Click
// @namespace    http://tampermonkey.net/
// @version      2026-02-08
// @description  try to take over the world!
// @author       You
// @match        https://x.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    new MutationObserver(() => {
        const button = document.querySelector('button[data-testid="confirmationSheetConfirm"]')
        if (button) {
            if (button.innerText === 'Block') {
                button.click()
            }
        }
    }).observe(document.body, {childList: true, subtree: true})
})();