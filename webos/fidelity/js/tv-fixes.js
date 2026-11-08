/* XuperTV on-TV fixes for the 2.2.62 build.
   This file is loaded after js/app.js and only touches display/navigation:
   - Back keyup guard (the app handled keydown and keyup, returning twice).
   - Visible "Inicio" button on Settings, Search and Detail.
   Playback code is not touched. */
(function () {
  'use strict';

  function isPlatformBack(e) {
    var k = e.keyCode || e.which;
    return k === 461 || e.key === 'Back' || e.key === 'GoBack';
  }

  var backKeyDownPending = false;

  /* The app listens for Back on document (bubble).  Capturing the keyup on
     window lets us swallow only the keyup that belongs to a keydown the app
     already handled.  Keyup-only remotes never set the flag, so they keep
     working. */
  window.addEventListener('keydown', function (e) {
    if (isPlatformBack(e)) { backKeyDownPending = true; }
  }, true);

  window.addEventListener('keyup', function (e) {
    if (!isPlatformBack(e)) { return; }
    if (backKeyDownPending) {
      backKeyDownPending = false;
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopImmediatePropagation) { e.stopImmediatePropagation(); }
      if (e.stopPropagation) { e.stopPropagation(); }
    }
  }, true);

  function goHome() {
    try {
      if (window.__xuper && typeof window.__xuper.show === 'function') {
        window.__xuper.show('home');
      } else {
        var screens = document.querySelectorAll('.screen');
        for (var i = 0; i < screens.length; i++) {
          screens[i].classList.remove('is-active');
        }
        var home = document.getElementById('screen-home');
        if (home) { home.classList.add('is-active'); }
      }
    } catch (eHome) { /* keep the remote usable even if home fails */ }

    setTimeout(function () {
      var tab = document.querySelector('.tab-item.is-selected') ||
                document.querySelector('.tab-item');
      if (!tab) { return; }
      if (window.__xuper && typeof window.__xuper.focus === 'function') {
        window.__xuper.focus(tab);
      }
    }, 0);
  }

  function focusTarget(target) {
    if (!target) { return false; }
    if (window.__xuper && typeof window.__xuper.focus === 'function') {
      window.__xuper.focus(target);
    } else {
      target.classList.add('is-focused');
    }
    return true;
  }

  function downTarget(screenId) {
    if (screenId === 'screen-settings') {
      return document.querySelector('.settings-item.is-selected') ||
             document.querySelector('.settings-item');
    }
    if (screenId === 'screen-search') {
      return document.querySelector('.kb-edit') ||
             document.querySelector('#search-hot-grid .focusable') ||
             document.querySelector('#search-result-grid .focusable');
    }
    if (screenId === 'screen-detail') {
      return document.querySelector('.detail-player') ||
             document.querySelector('.detail-btn');
    }
    return null;
  }

  function addHomeButton(screenId, id, cls) {
    var screen = document.getElementById(screenId);
    if (!screen || document.getElementById(id)) { return; }
    var btn = document.createElement('div');
    btn.id = id;
    btn.className = 'app-home-btn ' + cls + ' focusable';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Volver al inicio de la aplicación');
    btn.textContent = 'Inicio';
    btn._activate = goHome;
    btn._onMove = function (dir) {
      if (dir !== 'down') { return false; }
      return focusTarget(downTarget(screenId));
    };
    screen.appendChild(btn);
  }

  function init() {
    addHomeButton('screen-settings', 'settings-app-home', 'app-home-btn-settings');
    addHomeButton('screen-search', 'search-app-home', 'app-home-btn-search');
    addHomeButton('screen-detail', 'detail-app-home', 'app-home-btn-detail');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }
})();
