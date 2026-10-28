/* =============================================================================
   XuperTV 4.34.4  ->  LG webOS 4 (Chromium 53) fidelity reconstruction
   -----------------------------------------------------------------------------
   All geometry comes from the decoded Android resources:
     res/layout/*.xml, res/values/{colors,dimens,styles}.xml, values-es/strings.xml
   Scale: design_width 1920 / design_width_in_dp 1280  =>  1dp = 1.5px
   Content that the APK loads from its backend (posters, channel logos, QR,
   tab icons/order, home logo) is represented with the original "no data"
   assets and flagged in the audit documents. VOD data may additionally come
   from a separately configured, authorized API; no APK endpoint, credential
   or DRM logic is reproduced here.
   ============================================================================= */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ utils */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }
  function $(id) { return document.getElementById(id); }
  function clear(n) { while (n.firstChild) { n.removeChild(n.firstChild); } }
  function abs(n, x, y, w, h) {
    n.style.position = 'absolute';
    n.style.left = x + 'px';
    n.style.top = y + 'px';
    if (w !== undefined) { n.style.width = w + 'px'; }
    if (h !== undefined) { n.style.height = h + 'px'; }
    return n;
  }
  function closest(node, sel) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.matches && node.matches(sel)) { return node; }
      node = node.parentNode;
    }
    return null;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function norm(s) {
    s = String(s).toLowerCase();
    if (s.normalize) {
      s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return s;
  }
  function each(list, fn) { for (var i = 0; i < list.length; i++) { fn(list[i], i); } }

  /* ------------------------------------------------------------- demo data */
  /* Server-driven in the real APK. These records only exercise the layouts. */
  var GENRES = ['Acción', 'Drama', 'Comedia', 'Suspenso', 'Aventura',
                'Animación', 'Familiar', 'Ciencia ficción'];

  var VOD = [];
  var CATEGORY_BY_PREFIX = {
    'Destacado': 'destacado', 'Película': 'pelicula', 'Serie': 'serie',
    'Gratis': 'gratis', 'Infantil': 'infantil', 'UHD': 'uhd', 'Extra': 'extra'
  };
  function addVod(prefix, count, base) {
    for (var i = 1; i <= count; i++) {
      var g1 = GENRES[(base + i) % GENRES.length];
      var g2 = GENRES[(base + i + 3) % GENRES.length];
      VOD.push({
        id: VOD.length + 1,
        title: prefix + ' demo ' + pad2(i),
        category: CATEGORY_BY_PREFIX[prefix] || '',
        score: (7.9 + ((base + i) % 16) / 10).toFixed(1),
        year: 2018 + ((base + i) % 7),
        duration: (1 + ((base + i) % 2)) + ' h ' + (10 + ((base * 7 + i * 5) % 45)) + ' min',
        genres: g1 === g2 ? [g1] : [g1, g2],
        director: 'Director demo ' + pad2(i),
        actors: 'Actor demo ' + pad2(i) + ', Actriz demo ' + pad2(i + 1),
        synopsis: 'Sinopsis de demostración para ' + prefix.toLowerCase() + ' demo ' + pad2(i) +
          '. Este texto sólo existe para comprobar el recorte a dos líneas, el interlineado y ' +
          'la sangría de la etiqueta "Sinopsis :" definidos en activity_voddetails.',
        kind: prefix.toLowerCase()
      });
    }
  }
  addVod('Destacado', 5, 1);
  addVod('Película', 7, 2);
  addVod('Serie', 7, 3);
  addVod('Gratis', 5, 4);
  addVod('Infantil', 8, 5);
  addVod('UHD', 4, 6);
  addVod('Extra', 4, 7);

  /* ------------------------------------------------------------- VOD API
     XMLHttpRequest is used deliberately: it works on Chromium 53, where
     fetch/async functions are not a safe webOS 4 baseline. */
  var vodApi = window.XUPERTV_API || {};
  /* Desktop harness override: ?service=http://127.0.0.1:8910 */
  var devServiceParam = /[?&]service=([^&]+)/.exec(window.location.search || '');
  if (devServiceParam) { vodApi.devServiceUrl = decodeURIComponent(devServiceParam[1]); }
  var vodApiState = { loading: false, source: 'demo', error: null };
  var portalState = { refreshing: false, lastSync: 0, roots: 0, error: null };
  var PORTAL_ROOTS = ['featured', 'movies', 'series', 'anime', 'kids', 'free'];

  function apiArray(payload) {
    if (Object.prototype.toString.call(payload) === '[object Array]') { return payload; }
    if (!payload) { return []; }
    var keys = ['items', 'movies', 'results', 'recommendList', 'movieList',
                'totalMovieList', 'programList', 'data'];
    for (var i = 0; i < keys.length; i++) {
      if (Object.prototype.toString.call(payload[keys[i]]) === '[object Array]') {
        return payload[keys[i]];
      }
      if (payload[keys[i]] && typeof payload[keys[i]] === 'object') {
        var nested = apiArray(payload[keys[i]]);
        if (nested.length) { return nested; }
      }
    }
    return [];
  }

  function apiError(payload) {
    if (!payload || typeof payload !== 'object') { return ''; }
    var code = payload.returnCode || payload.code || payload.errorCode || '';
    var message = payload.errorMessage || payload.message || payload.msg || '';
    if (!code && !message) { return ''; }
    return (code ? String(code) + ': ' : '') + (message ? String(message) : 'La API rechazó la petición');
  }

  function apiUrl(kind) {
    var direct = vodApi[kind + 'Url'];
    if (direct) { return String(direct); }
    var base = String(vodApi.baseUrl || '').replace(/\/$/, '');
    var path = String(vodApi[kind + 'Path'] || '');
    return base && path ? base + (path.charAt(0) === '/' ? path : '/' + path) : '';
  }

  function xuperSession() {
    var session = vodApi.session || {};
    return {
      userId: String(session.userId || ''),
      userToken: String(session.userToken || ''),
      portalCode: String(session.portalCode || ''),
      homePageCode: String(session.homePageCode || ''),
      version: String(session.version || '4.34.4')
    };
  }

  function hasXuperSession() {
    var session = xuperSession();
    return !!(session.userId && session.userToken && session.portalCode);
  }

  function xuperPayload(kind, value) {
    var session = xuperSession();
    if (kind === 'catalog') {
      return {
        userId: session.userId,
        userToken: session.userToken,
        portalCode: session.portalCode,
        homePageCode: session.homePageCode,
        version: session.version
      };
    }
    if (kind === 'search') {
      return {
        userToken: session.userToken,
        userId: session.userId,
        portalCode: session.portalCode,
        columnId: '',
        value: value || '',
        type: '',
        pageSize: 20,
        pageNum: 1,
        filter: ''
      };
    }
    return {
      userToken: session.userToken,
      userId: session.userId,
      portalCode: session.portalCode,
      programId: value
    };
  }

  function apiImage(value) {
    if (!value) { return ''; }
    value = String(value);
    if (/^https?:\/\//i.test(value) || value.indexOf('data:') === 0) { return value; }
    if (!vodApi.imageBaseUrl) { return value; }
    return String(vodApi.imageBaseUrl).replace(/\/$/, '') + '/' + value.replace(/^\//, '');
  }

  function apiText(value, fallback) {
    return value === undefined || value === null || value === '' ? fallback : String(value);
  }

  function isSeriesItem(item) {
    if (!item) { return false; }
    return item.type === 'teleplay' || item.type === 'series' || item.kind === 'serie' ||
           (item.category && item.category.indexOf('serie') !== -1) ||
           (item.episodes && item.episodes.length > 0) ||
           (item.seasons && item.seasons.length > 0) ||
           (item.volumeCount && parseInt(item.volumeCount, 10) > 1);
  }

  function normalizeVod(raw, index) {
    raw = raw || {};
    var genres = raw.genres || raw.genre || [];
    if (typeof genres === 'string') { genres = genres.split(','); }
    if (Object.prototype.toString.call(genres) !== '[object Array]') { genres = []; }
    var names = [];
    for (var i = 0; i < genres.length; i++) {
      names.push(typeof genres[i] === 'string' ? genres[i] : (genres[i].name || ''));
    }
    var runtime = raw.duration || raw.runtime || raw.runtimeMinutes || '';
    if (typeof runtime === 'number') { runtime = Math.floor(runtime / 60) + ' h ' + (runtime % 60) + ' min'; }
    var type = apiText(raw.type || raw.programType, '');
    var isSeries = type === 'teleplay' || type === 'series' || norm(apiText(raw.kind || '', '')) === 'serie' ||
                   norm(apiText(raw.category || '', '')).indexOf('serie') !== -1 ||
                   (raw.episodes && raw.episodes.length > 0) ||
                   (raw.seasons && raw.seasons.length > 0) ||
                   (raw.volumeCount && parseInt(raw.volumeCount, 10) > 1) ||
                   (raw.volumnCount && parseInt(raw.volumnCount, 10) > 1);
    return {
      id: apiText(raw.id || raw.vodId || raw.programId || raw.program_id || raw.tmdb_id, 'api-' + index),
      title: apiText(raw.title || raw.name || raw.programName || raw.programTitle || raw.original_title, 'Sin título'),
      category: norm(apiText(raw.category || raw.section || raw.collection || raw.homeSection, '')),
      score: apiText(raw.score || raw.vote_average || raw.rating || raw.movieRate || raw.programScore, '—'),
      year: apiText(raw.year || raw.release_year || raw.programYear || (raw.releaseDate || raw.releaseTime || raw.release_date || '').slice(0, 4), '—'),
      duration: apiText(runtime, '—'),
      genres: names.length ? names : ['Sin clasificar'],
      director: apiText(raw.director, '—'),
      actors: apiText(raw.actors || raw.actorDisplay || raw.cast, '—'),
      synopsis: apiText(raw.synopsis || raw.overview || raw.description || raw.programUpdateContent, 'Sin sinopsis disponible.'),
      kind: isSeries ? 'serie' : apiText(raw.kind || raw.media_type, 'película'),
      poster: apiImage(raw.posterUrl || raw.poster_url || raw.poster || raw.poster_path || raw.image || raw.imageUrl || raw.cover || raw.coverUrl || raw.programPoster || raw.programImage),
      landscape: apiImage(raw.landscapeUrl || raw.landscape_url || raw.landscape || raw.wideImage || raw.bannerImage),
      backdrop: apiImage(raw.backdropUrl || raw.backdrop_url || raw.backdrop || raw.backdrop_path),
      streamUrl: raw.streamUrl || raw.stream_url || '',
      /* Magis portal records (service / snapshot). */
      type: type || (isSeries ? 'teleplay' : 'movie'),
      row: apiText(raw.row, ''),
      alias: apiText(raw.alias, ''),
      country: apiText(raw.country || raw.originalCountry, ''),
      releaseDate: apiText(raw.releaseDate || raw.releaseTime, ''),
      tagline: apiText(raw.tagline || raw.viewPoint, ''),
      volumeCount: parseInt(raw.volumeCount || raw.volumnCount, 10) || 0,
      updateCount: parseInt(raw.updateCount, 10) || 0,
      episodes: raw.episodes || [],
      seasons: raw.seasons || [],
      moreAudio: raw.moreAudio !== undefined ? raw.moreAudio : 0,
      moreSubtitle: raw.moreSubtitle !== undefined ? raw.moreSubtitle : 0,
      _portal: raw.portal === true || raw._portal === true || (vodApi && vodApi.mode === 'portal' && String(raw.id || '').length > 10)
    };
  }

  function apiRequest(url, done, options) {
    options = options || {};
    var xhr = new XMLHttpRequest();
    var finished = false;
    var timeout = parseInt(vodApi.timeoutMs, 10) || 10000;
    function finish(error, payload) {
      if (finished) { return; }
      finished = true;
      done(error, payload);
    }
    xhr.open(options.method || 'GET', url, true);
    xhr.timeout = timeout;
    var headers = vodApi.headers || {};
    for (var name in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, name)) { xhr.setRequestHeader(name, headers[name]); }
    }
    if (options.body !== undefined && !headers['Content-Type'] && !headers['content-type']) {
      xhr.setRequestHeader('Content-Type', 'application/json;charset=utf-8');
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) { return; }
      if (xhr.status < 200 || xhr.status >= 300) { finish('HTTP ' + xhr.status); return; }
      try { finish(null, JSON.parse(xhr.responseText)); }
      catch (err) { finish('La API no devolvió JSON válido'); }
    };
    xhr.onerror = function () { finish('Error de red o CORS'); };
    xhr.ontimeout = function () { finish('Tiempo de espera agotado'); };
    try { xhr.send(options.body === undefined ? null : JSON.stringify(options.body)); }
    catch (err) { finish(err.message || 'No se pudo iniciar la petición'); }
  }

  function replaceVod(records, source, portal) {
    if (!records.length) { return false; }
    var previous = {};
    for (var p = 0; p < VOD.length; p++) { previous[String(VOD[p].id)] = VOD[p]; }
    VOD.splice(0, VOD.length);
    for (var i = 0; i < records.length; i++) {
      var item = normalizeVod(records[i], i + 1);
      if (portal && records[i].portal !== false) { item._portal = true; }
      var old = previous[String(item.id)];
      if (old) {
        /* Keep what the detail/player already learned about this title. */
        if (old.episodes) { item.episodes = old.episodes; }
        if (old.seasons) { item.seasons = old.seasons; }
        if (old._detailsLoaded) { item._detailsLoaded = true; }
        if (!item.streamUrl && old.streamUrl) { item.streamUrl = old.streamUrl; }
      }
      VOD.push(item);
    }
    if (state.detail) {
      var foundDetail = false;
      for (var d = 0; d < VOD.length; d++) {
        if (String(VOD[d].id) === String(state.detail.id)) {
          state.detail = VOD[d];
          foundDetail = true;
          break;
        }
      }
      if (!foundDetail) { state.detail = VOD[0]; }
    }
    vodApiState.source = source;
    vodApiState.error = null;
    refreshVodViews();
    return true;
  }

  /* A real catalog may not have every home section. Prefer the declared
     category, then fall back to positional demo slices so the reconstructed
     layouts always have content to show. */
  function vodFor(category, count, fallbackStart) {
    var out = [], i;
    if (category) {
      for (i = 0; i < VOD.length; i++) {
        var cats = norm(VOD[i].category || '').split(',');
        if (cats.indexOf(category) !== -1) { out.push(VOD[i]); }
      }
    }
    if (!out.length) { out = VOD.slice(fallbackStart, fallbackStart + count); }
    if (!out.length) { out = VOD.slice(0, count); }
    /* Fill short sections with other catalog entries so the sample never shows
       one poster repeated across a whole mosaic. A real backend normally sends
       enough items per section; this only affects the bundled demo catalog. */
    if (out.length < count && VOD.length) {
      var seen = {};
      for (i = 0; i < out.length; i++) { seen[String(out[i].id)] = true; }
      var cursor = 0;
      while (out.length < count && cursor < VOD.length * 2) {
        var cand = VOD[cursor % VOD.length];
        cursor++;
        if (!seen[String(cand.id)]) {
          out.push(cand);
          seen[String(cand.id)] = true;
        }
      }
    }
    return out;
  }

  function refreshVodViews() {
    if (homeBuilt) {
      var rail = $('home-tabs');
      var railWasExpanded = !!(rail && rail.classList.contains('is-expanded') && !rail.classList.contains('is-collapsed'));
      var focusWasTab = !!(state.focus && state.focus._tab !== undefined);
      var focusWasNotify = !!(state.focus && closest(state.focus, '#home-notify'));
      var hadContentFocus = !!(state.focus && closest(state.focus, '.home-page'));
      pages = [];
      tabEls = [];
      buildHome();
      selectTab(state.tab, false);
      if (state.screen === 'home') {
        if (focusWasTab && tabEls[state.tab]) { setFocus(tabEls[state.tab], true); }
        else if (focusWasNotify) {
          var n = firstIn($('home-notify'));
          if (n) { setFocus(n, true); }
        } else if (hadContentFocus) {
          var page = pages[TABS[state.tab].page];
          var f = page ? firstIn(page) : null;
          if (f) { setFocus(f, true); }
        }
        if (railWasExpanded && rail) {
          /* The reference keeps the full labels on the first paint even while
             the content holds focus; preserve that across a catalog refresh. */
          rail.classList.add('is-expanded');
          rail.classList.remove('is-collapsed');
          var railBg = document.querySelector('.home-sidebar-bg');
          if (railBg) { railBg.classList.add('is-on'); }
        }
      }
    }
    if (searchKeyboard) { buildSearch(); if (state.searchQuery) { runSearch(); } }
    if (state.detail) { buildDetail(state.detail); }
  }

  function bundledCatalog() {
    var data = window.XUPERTV_CATALOG;
    return data ? apiArray(data) : [];
  }

  /* ------------------------------------------------------ portal service
     The Magis portal answers no CORS preflight, so the page cannot call it.
     The bundled Node service speaks the encrypted protocol and returns plain
     JSON over Luna; devServiceUrl mirrors the same methods for desktop tests. */
  function hasLuna() {
    if (window.PalmServiceBridge && (!window.webOS || !window.webOS.service)) {
      window.webOS = window.webOS || {};
      window.webOS.service = {
        request: function (uri, opts) {
          opts = opts || {};
          var bridge = new window.PalmServiceBridge();
          bridge.onservicecallback = function (msg) {
            var res;
            try { res = JSON.parse(msg); } catch (e) { res = { returnValue: false, errorText: msg }; }
            if (res.returnValue === false) {
              if (opts.onFailure) { opts.onFailure(res); }
            } else {
              if (opts.onSuccess) { opts.onSuccess(res); }
            }
          };
        var fullUri = opts.method ? (uri.replace(/\/$/, '') + '/' + opts.method) : uri;
        bridge.call(fullUri, JSON.stringify(opts.parameters || {}));
        return bridge;
      }
    };
  }
  return !!(window.webOS && window.webOS.service && window.webOS.service.request);
}

function queryString(params) {
  var parts = [];
  for (var k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k)) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  return parts.join('&');
}

function portalServiceCall(method, params, done) {
  var serviceId = vodApi.serviceId || 'com.webosflux.xuptertv.fidelity.service';
  var settled = false;
  function finish(error, payload) {
    if (settled) { return; }
    settled = true;
    done(error, payload);
  }
  if (hasLuna()) {
    try {
      window.webOS.service.request('luna://' + serviceId, {
        method: method,
        parameters: params || {},
        timeout: parseInt(vodApi.timeoutMs, 10) || 20000,
        onSuccess: function (payload) { finish(null, payload); },
        onFailure: function (error) {
          finish((error && error.errorText) || 'Error del servicio XuperTV', null);
        }
      });
      return true;
    } catch (e) {
      if (!vodApi.devServiceUrl) {
        finish('Error comunicando con el servicio: ' + (e.message || e), null);
        return false;
      }
    }
  }
    if (vodApi.devServiceUrl && !hasLuna()) {
      apiRequest(String(vodApi.devServiceUrl).replace(/\/$/, '') + '/' + method + '?' + queryString(params || {}),
        function (error, payload) { finish(error, payload); }, null);
      return true;
    }
    finish('El servicio XuperTV no está disponible', null);
    return false;
  }

  function startServiceKeepAlive() {
    if (!hasLuna()) { return; }
    var serviceId = vodApi.serviceId || 'com.webosflux.xuptertv.fidelity.service';
    try {
      window.webOS.service.request('luna://' + serviceId, {
        method: 'keepAlive',
        parameters: { subscribe: true },
        resubscribe: true,
        onSuccess: function () {},
        onFailure: function () {}
      });
    } catch (eSub) { /* ignore */ }

    setInterval(function () {
      try {
        window.webOS.service.request('luna://' + serviceId, {
          method: 'heartbeat',
          parameters: {},
          onSuccess: function () {},
          onFailure: function () {}
        });
      } catch (eHb) { /* ignore */ }
    }, 15000);
  }

  function portalSnapshot() {
    var data = window.XUPERTV_PORTAL;
    return data ? apiArray(data) : [];
  }

  /* Open movies are kept only to exercise the detail -> player pipeline; they
     are not portal titles, so they never go through the resolver. */
  function openSamples() {
    var all = bundledCatalog();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].streamUrl) {
        var rec = {};
        for (var k in all[i]) {
          if (Object.prototype.hasOwnProperty.call(all[i], k)) { rec[k] = all[i][k]; }
        }
        rec.category = 'demo';
        rec.portal = false;
        out.push(rec);
      }
    }
    return out;
  }

  function applyPortalRefresh(roots) {
    var byId = {}, order = [], cats = {};
    function absorb(item) {
      if (!item || !item.id) { return; }
      var id = String(item.id);
      if (!byId[id]) { byId[id] = item; order.push(id); }
      else {
        var cur = byId[id];
        for (var k in item) {
          if (Object.prototype.hasOwnProperty.call(item, k) &&
              item[k] !== '' && item[k] !== '—' && item[k] !== null && item[k] !== undefined) {
            cur[k] = item[k];
          }
        }
      }
      var list = String(item.category || '').split(',');
      cats[id] = cats[id] || {};
      for (var c = 0; c < list.length; c++) { if (list[c]) { cats[id][list[c]] = true; } }
    }
    for (var r = 0; r < PORTAL_ROOTS.length; r++) {
      var list = roots[PORTAL_ROOTS[r]] || [];
      for (var i = 0; i < list.length; i++) { list[i].portal = true; absorb(list[i]); }
    }
    if (!order.length) {
      /* Refresh received no items (service offline or slow): preserve snapshot catalog! */
      return;
    }
    var records = [];
    for (var o = 0; o < order.length; o++) {
      var rec = byId[order[o]];
      rec.category = Object.keys(cats[order[o]]).join(',');
      records.push(rec);
    }
    var demo = openSamples();
    for (var d = 0; d < demo.length; d++) { records.push(demo[d]); }
    if (records.length) { replaceVod(records, 'portal', true); }
  }

  function refreshPortalCatalog() {
    if (portalState.refreshing) { return; }
    portalState.refreshing = true;
    portalState.error = null;
    var fresh = {};
    var index = 0;
    function next() {
      if (index >= PORTAL_ROOTS.length) {
        portalState.refreshing = false;
        portalState.lastSync = Date.now();
        applyPortalRefresh(fresh);
        return;
      }
      var root = PORTAL_ROOTS[index++];
      portalServiceCall('home', { root: root }, function (error, payload) {
        if (!error && payload && payload.returnValue !== false && payload.items && payload.items.length) {
          fresh[root] = payload.items;
          portalState.roots++;
        } else if (error) {
          portalState.error = error;
        }
        next();
      });
    }
    next();
  }

  function loadPortalCatalog() {
    var snap = portalSnapshot();
    if (snap.length) {
      replaceVod(snap, 'portal-snapshot', true);
    }
    if (vodApi.refresh === false) {
      if (!snap.length) { vodApiState.error = 'Sin snapshot del portal'; }
      return;
    }
    refreshPortalCatalog();
  }

  function useBundledCatalog(source, error) {
    var records = bundledCatalog();
    if (!replaceVod(records, source || 'bundled')) {
      vodApiState.error = error || 'No hay catálogo local ni remoto';
      return false;
    }
    if (error) { vodApiState.error = error; }
    return true;
  }

  function loadVodCatalog() {
    if (!vodApi.enabled) { return; }
    if (vodApi.mode === 'portal') { loadPortalCatalog(); return; }
    if (vodApi.mode === 'static') { useBundledCatalog('bundled', null); return; }
    var url = apiUrl('catalog');
    if (vodApi.mode === 'xuper' && !hasXuperSession()) {
      vodApiState.error = 'Falta la sesión XuperTV (userId, userToken y portalCode)';
      return;
    }
    if (!url) {
      if (vodApi.useBundledCatalog) { useBundledCatalog('bundled', null); }
      else { vodApiState.error = 'Falta baseUrl/catalogUrl del catálogo autorizado'; }
      return;
    }
    vodApiState.loading = true;
    apiRequest(url, function (error, payload) {
      vodApiState.loading = false;
      var responseError = apiError(payload);
      if (!error && !responseError && replaceVod(apiArray(payload), 'api')) { return; }
      var message = error || responseError || 'La API no devolvió películas';
      /* A remote endpoint that is offline must not leave the port empty. */
      if (!useBundledCatalog('bundled-fallback', message)) {
        vodApiState.error = message;
      }
    }, vodApi.mode === 'xuper' ? { method: 'POST', body: xuperPayload('catalog') } : null);
  }

  function mergeDetail(item, raw) {
    var full = normalizeVod(raw, item.id);
    /* Catalog values remain useful when a detail response omits a field. */
    for (var key in full) {
      if (Object.prototype.hasOwnProperty.call(full, key) && full[key] !== '—' && full[key] !== '' &&
          full[key] !== 'Sin sinopsis disponible.') {
        item[key] = full[key];
      }
    }
  }

  function loadVodDetail(item, done) {
    done = done || function () {};
    if (!item) { return done(null); }
    if (item._detailsLoaded) { return done(item); }
    if (item._detailLoading) {
      item._detailWait = item._detailWait || [];
      item._detailWait.push(done);
      return;
    }
    if (vodApi.mode === 'portal' && item._portal) {
      item._detailLoading = true;
      item._detailWait = [done];
      portalServiceCall('detail', { contentId: item.id }, function (error, payload) {
        item._detailLoading = false;
        if (!error && payload && payload.returnValue !== false && payload.item) {
          mergeDetail(item, payload.item);
          item.episodes = payload.episodes || [];
          item.seasons = payload.seasons || [];

          /* Ordenar temporadas ascendentemente por numero */
          if (item.seasons && item.seasons.length) {
            item.seasons.sort(function (a, b) {
              var na = parseInt(a.number, 10) || 0;
              var nb = parseInt(b.number, 10) || 0;
              return na - nb;
            });
          }

          /* Si no hay temporadas pero el titulo o alias tiene T/S, asegurar al menos una temporada */
          if ((!item.seasons || !item.seasons.length) && isSeriesItem(item)) {
            var sNum = 1;
            var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
            if (sm) { sNum = parseInt(sm[1], 10) || 1; }
            item.seasons = [{ id: item.id, number: sNum }];
          }

          /* Sincronizar indice de temporada activa con item.id */
          if (item.seasons && item.seasons.length) {
            var activeIdx = 0;
            for (var s = 0; s < item.seasons.length; s++) {
              if (item.seasons[s].id === item.id) {
                activeIdx = s;
                break;
              }
            }
            state.detailSeason = activeIdx;
          }

          /* Episodio por defecto si no hay uno seleccionado */
          if (item.episodes && item.episodes.length && !state.detailEpisode) {
            state.detailEpisode = item.episodes[0];
          }

          item._detailsLoaded = true;
        }
        var wait = item._detailWait || [];
        item._detailWait = [];
        for (var i = 0; i < wait.length; i++) { wait[i](item); }
        if (state.detail === item && state.screen === 'detail') {
          buildDetail(item);
          if (!playerVideo || !playerVideo.src || playerVideo.paused) {
            startPlayerVideo(item, state.detailEpisode);
          }
        }
      });
      return;
    }
    var endpoint = apiUrl('detail');
    if (!vodApi.enabled || !endpoint) { return done(item); }
    if (vodApi.mode === 'xuper' && !hasXuperSession()) { return done(item); }
    item._detailLoading = true;
    var url = endpoint.replace('{id}', encodeURIComponent(item.id));
    apiRequest(url, function (error, payload) {
      item._detailLoading = false;
      if (!error) {
        var records = apiArray(payload);
        var raw = records.length ? records[0] : (payload && (payload.item || payload.movie || payload));
        if (raw && typeof raw === 'object') {
          mergeDetail(item, raw);
          item._detailsLoaded = true;
          if (state.detail === item && state.screen === 'detail') {
            buildDetail(item);
            if (!playerVideo || !playerVideo.src || playerVideo.paused) {
              startPlayerVideo(item, state.detailEpisode);
            }
          }
        }
      }
      done(item);
    }, vodApi.mode === 'xuper' ? { method: 'POST', body: xuperPayload('detail', item.id) } : null);
  }

  var CHANNELS = [];
  (function () {
    var names = ['Canal demo 01', 'Canal demo 02', 'Canal demo 03', 'Canal demo 04',
                 'Canal demo 05', 'Canal demo 06', 'Canal demo 07', 'Canal demo 08',
                 'Canal demo 09', 'Canal demo 10', 'Canal demo 11', 'Canal demo 12'];
    for (var i = 0; i < names.length; i++) {
      CHANNELS.push({
        index: i + 1,
        name: names[i],
        now: 'Programa demo ' + pad2(i + 1),
        next: 'Programa demo ' + pad2(i + 2),
        time: '20:00 - 21:30',
        fav: i % 3 === 0,
        uhd: i === 2 || i === 6
      });
    }
  })();

  /* Tab order and labels observed on the running app (WSA, 1920x1080).
     The APK builds this list from its backend, so the icon artwork is not a
     drawable in the APK; these glyphs are reconstructions of the observed
     shapes (documented in DIFERENCIAS_PENDIENTES.md). */
  var TAB_ICONS = {
    tv: '<svg viewBox="0 0 33 33"><rect x="3.5" y="7" width="26" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M11 24.5v3h11v-3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    thumb: '<svg viewBox="0 0 33 33"><path d="M12 15.5V28H7.6A2.6 2.6 0 0 1 5 25.4v-7.3a2.6 2.6 0 0 1 2.6-2.6H12z" fill="currentColor"/><path d="M14 15.6l4.3-9.2a2.2 2.2 0 0 1 4 1.6V13h5.6a2.9 2.9 0 0 1 2.8 3.6l-2 9A3.4 3.4 0 0 1 25.4 28H14z" fill="currentColor"/></svg>',
    film: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16.5" cy="16.5" r="2.4" fill="currentColor"/><circle cx="16.5" cy="9.5" r="2.1" fill="currentColor"/><circle cx="16.5" cy="23.5" r="2.1" fill="currentColor"/><circle cx="9.5" cy="16.5" r="2.1" fill="currentColor"/><circle cx="23.5" cy="16.5" r="2.1" fill="currentColor"/></svg>',
    strip: '<svg viewBox="0 0 33 33"><rect x="4" y="7" width="25" height="19" rx="2" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M9 7v19M24 7v19" stroke="currentColor" stroke-width="1.8"/><rect x="5.6" y="9" width="2.4" height="2.6" fill="currentColor"/><rect x="5.6" y="15.2" width="2.4" height="2.6" fill="currentColor"/><rect x="5.6" y="21.4" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="9" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="15.2" width="2.4" height="2.6" fill="currentColor"/><rect x="25" y="21.4" width="2.4" height="2.6" fill="currentColor"/></svg>',
    kids: '<svg viewBox="0 0 33 33"><circle cx="8.6" cy="8.6" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="24.4" cy="8.6" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="16.5" cy="18" r="9.6" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="13" cy="17" r="1.5" fill="currentColor"/><circle cx="20" cy="17" r="1.5" fill="currentColor"/><ellipse cx="16.5" cy="21.6" rx="2.4" ry="1.7" fill="currentColor"/></svg>',
    anime: '<svg viewBox="0 0 33 33"><circle cx="8.5" cy="9" r="4.5" fill="currentColor"/><circle cx="24.5" cy="9" r="4.5" fill="currentColor"/><path d="M16.5 9c5.8 0 10.5 4.6 10.5 10.3 0 5.7-4.7 9.7-10.5 9.7S6 25 6 19.3C6 13.6 10.7 9 16.5 9z" fill="currentColor"/><circle cx="12.5" cy="18" r="1.6" fill="#0b0b0b"/><circle cx="20.5" cy="18" r="1.6" fill="#0b0b0b"/><ellipse cx="16.5" cy="23" rx="3" ry="2" fill="#0b0b0b"/></svg>',
    compass: '<svg viewBox="0 0 33 33"><circle cx="16.5" cy="16.5" r="11.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M22 11l-3.2 7.8L11 22l3.2-7.8z" fill="currentColor"/></svg>'
  };

  var TABS = [
    { label: 'TV', page: 0, icon: 'tv' },
    { label: 'DESTACADOS', page: 1, icon: 'thumb' },
    { label: 'PELICULA', page: 2, icon: 'film' },
    { label: 'SERIES', page: 3, icon: 'strip' },
    { label: 'KIDS', page: 4, icon: 'kids' },
    { label: 'ANIME', page: 5, icon: 'anime' },
    { label: 'EXPLORAR', page: 6, icon: 'compass' }
  ];

  var SETTINGS_ITEMS = [
    { id: 'playback', label: 'Configuración global de reproducción' },
    { id: 'cr', label: 'Contenido adulto' },
    { id: 'parent', label: 'Configuraciones del Control Parental' },
    { id: 'feedback', label: 'Ayuda y Feedback' },
    { id: 'upgrade', label: 'Actualización' },
    { id: 'about', label: 'Sobre nosotros' },
    { id: 'account', label: 'Account' },
    { id: 'purchase', label: 'Purchase' }
  ];

  /* ---------------------------------------------------------------- state */
  var state = {
    screen: 'welcome',
    tab: 0,
    channel: 0,
    focus: null,
    detail: null,
    detailReturn: null,
    detailRange: 0,
    detailSeason: 0,
    playerReturn: null,
    playerMode: 'live',
    playerItem: null,
    playerEpisode: null,
    streamError: '',
    streamMode: 'normal',
    channelsOpen: false,
    infobar: true,
    infoTimer: null,
    searchQuery: '',
    searchNumeric: false,
    searchSeq: 0,
    searchFocus: null,
    playback: {
      screen: 0,
      audio: 0,
      subLang: 0,
      size: 0,
      style: 0,
      subtitle: true
    },
    crOn: false,
    favs: {}
  };

  var homeBuilt = false;
  var pagesEl, pages = [], tabEls = [], notifyEl;
  var liveRows = [], liveInfoText, liveMain, liveFocus, liveList;
  var detailLeft, detailPlayer, detailButtons, detailBottom;
  var searchKeyboard, searchHot, searchResults, searchEmpty, searchHotGrid,
      searchResultGrid, searchInput, searchKeys = [];
  var settingsMenu, settingsRight, settingsPanels = {}, settingsItems = [];
  var playerStage, playerInfo, playerChannels, playerVideo, playerFrame, playerStatus, playerChannelRows = [];
  var playerVodInfo, vodInfobarPoster, vodInfobarTitle, vodTimeCurrent, vodTimeTotal, vodSeekProgress, vodSeekBuffered, vodSeekThumb, playerOsdIcon;
  var welcomeTimer = null;

  /* ------------------------------------------------------------ focus core */
  function isVisible(node) {
    if (!node || !node.getBoundingClientRect) { return false; }
    if (node.offsetParent === null) { return false; }
    var r = node.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { return false; }
    if (dialogPlaySettingsOpen) {
      return !!closest(node, '#dialog-playsettings');
    }
    if (playSettingViewOpen) {
      return !!closest(node, '#player-playsetting-view');
    }
    var page = closest(node, '.home-page');
    if (page && !page.classList.contains('is-current')) { return false; }
    var panel = closest(node, '.settings-panel');
    if (panel && !panel.classList.contains('is-active')) { return false; }
    var hot = closest(node, '.search-hot');
    if (hot && hot.classList.contains('is-hidden')) { return false; }
    var res = closest(node, '.search-results');
    if (res && !res.classList.contains('is-active')) { return false; }
    var pc = closest(node, '.player-channels');
    if (pc && !pc.classList.contains('is-active')) { return false; }
    var ib = closest(node, '.player-infobar');
    if (ib && !ib.classList.contains('is-active')) { return false; }
    return true;
  }

  function focusables() {
    var nodes = document.querySelectorAll('.focusable');
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) { out.push(nodes[i]); }
    }
    return out;
  }

  function reveal(node) {
    var box = closest(node, '.scrollable');
    while (box) {
      var er = node.getBoundingClientRect();
      var br = box.getBoundingClientRect();
      if (er.top < br.top) {
        box.scrollTop -= (br.top - er.top) + 12;
      } else if (er.bottom > br.bottom) {
        box.scrollTop += (er.bottom - br.bottom) + 12;
      }
      if (box.scrollWidth > box.clientWidth + 1) {
        if (er.left < br.left) {
          box.scrollLeft -= (br.left - er.left) + 12;
        } else if (er.right > br.right) {
          box.scrollLeft += (er.right - br.right) + 12;
        }
      }
      box = closest(box.parentNode, '.scrollable');
    }
  }

  function setFocus(node, silent) {
    if (!node) { return; }
    if (state.focus === node) {
      if (!silent) { reveal(node); }
      return;
    }
    if (state.focus) { state.focus.classList.remove('is-focused'); }
    state.focus = node;
    node.classList.add('is-focused');
    if (node._onFocus) { node._onFocus(); }
    /* The tab rail expands while it holds focus and collapses to icons as soon
       as the content takes focus (observed on the running app). */
    var rail = $('home-tabs');
    if (rail && state.screen === 'home') {
      var inRail = closest(node, '.home-tabs');
      rail.classList.toggle('is-expanded', !!inRail);
      rail.classList.toggle('is-collapsed', !inRail);
      var railBg = document.querySelector('.home-sidebar-bg');
      if (railBg) { railBg.classList.toggle('is-on', !!inRail); }
    }
    if (!silent) { reveal(node); }
  }

  function firstIn(container) {
    var nodes = container.querySelectorAll('.focusable');
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) { return nodes[i]; }
    }
    return null;
  }

  function moveFocus(dir) {
    if (!state.focus) {
      var f = focusables();
      if (f.length) { setFocus(f[0]); }
      return;
    }
    if (state.focus._onMove && state.focus._onMove(dir)) { return; }

    var inPage = state.screen === 'home' && closest(state.focus, '.home-page');

    var list = focusables();
    var fr = state.focus.getBoundingClientRect();
    var fx = fr.left + fr.width / 2;
    var fy = fr.top + fr.height / 2;
    var best = null;
    var bestScore = 1e9;

    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === state.focus) { continue; }
      /* Don't let sidebar tabs intercept left navigation while inside page content */
      if (inPage && closest(c, '.home-tabs')) { continue; }

      var r = c.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var dx = cx - fx;
      var dy = cy - fy;
      var primary, secondary, overlap;

      if (dir === 'left') {
        if (dx > -4) { continue; }
        primary = Math.max(0, fr.left - r.right);
        secondary = Math.abs(dy);
        overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
      } else if (dir === 'right') {
        if (dx < 4) { continue; }
        primary = Math.max(0, r.left - fr.right);
        secondary = Math.abs(dy);
        overlap = (r.bottom > fr.top + 2 && r.top < fr.bottom - 2);
      } else if (dir === 'up') {
        if (dy > -4) { continue; }
        primary = Math.max(0, fr.top - r.bottom);
        secondary = Math.abs(dx);
        overlap = (r.right > fr.left + 2 && r.left < fr.right - 2);
      } else {
        if (dy < 4) { continue; }
        primary = Math.max(0, r.top - fr.bottom);
        secondary = Math.abs(dx);
        overlap = (r.right > fr.left + 2 && r.left < fr.right - 2);
      }
      var score = primary + secondary * 2 + (overlap ? 0 : 320);
      if (score < bestScore) { bestScore = score; best = c; }
    }

    if (best) {
      setFocus(best);
      return;
    }

    /* Leftmost limit reached in page content: now focus sidebar tab */
    if (dir === 'left' && inPage) {
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
    }
  }

  /* ---------------------------------------------------------------- screen */
  function showScreen(name) {
    var screens = document.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.remove('is-active');
    }
    var target = $('screen-' + name);
    if (target) { target.classList.add('is-active'); }
    state.screen = name;
    if (name !== 'player' && name !== 'detail') {
      var scrPlayer = $('screen-player');
      if (scrPlayer) {
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      }
      stopPlayerVideo();
    }
  }

  var lastBackTime = 0;
  function back() {
    var now = Date.now();
    if (now - lastBackTime < 250) { return; }
    lastBackTime = now;
    if (state.screen === 'player') {
      if (dialogPlaySettingsOpen) {
        closePlaySettingsDialog();
        return;
      }
      if (playSettingViewOpen) {
        closePlaySettingView();
        return;
      }
      if (state.channelsOpen) {
        closeChannelPanel();
      } else if (state.infobar) {
        hideInfobar();
      } else if (state.vodInfobarVisible) {
        hideVodInfobar();
      } else {
        restorePlayerReturn();
      }
      return;
    }
    if (state.screen === 'detail') {
      if (typeof closeSeasonPopup === 'function' && seasonPopup) {
        closeSeasonPopup();
        var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
        if (sBtn) { setFocus(sBtn); }
        return;
      }
      var scr = $('screen-detail');
      if (scr && scr.classList.contains('is-synopsis-open')) {
        toggleSynopsis();
        return;
      }
      stopPlayerVideo();
      var scrPlayer = $('screen-player');
      if (scrPlayer) {
        scrPlayer.classList.remove('is-mini');
        scrPlayer.classList.remove('is-active');
      }
      var ret = state.detailReturn;
      if (ret && ret.screen === 'search') {
        showScreen('search');
        setFocus(ret.focus);
      } else {
        showScreen('home');
        selectTab(state.tab, false);
        if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
        else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      }
      return;
    }
    if (state.screen === 'search') {
      clearSearchState();
      showScreen('home');
      selectTab(state.tab, false);
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
    if (state.screen === 'settings') {
      showScreen('home');
      selectTab(state.tab, false);
      if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      return;
    }
    if (state.screen === 'home') {
      if (state.tab !== 0) {
        selectTab(0, true);
        if (tabEls[0]) { setFocus(tabEls[0]); }
        return;
      }
      if (window.webOSTV && window.webOSTV.platformBack) {
        window.webOSTV.platformBack();
      } else if (window.PalmSystem && window.PalmSystem.platformBack) {
        window.PalmSystem.platformBack();
      }
    }
  }

  function activate() {
    if (!state.focus) { return; }
    if (state.focus._activate) { state.focus._activate(); }
  }

  function handleKey(e) {
    var k = e.keyCode || e.which;
    var key = e.key || '';
    var handled = true;

    /* Back buttons */
    var isBack = (k === 461 || k === 27 || k === 8 || key === 'Back' || key === 'GoBack' || key === 'Escape');
    if (isBack) {
      if (dialogPlaySettingsOpen) {
        closePlaySettingsDialog();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      if (playSettingViewOpen) {
        closePlaySettingView();
        if (e.preventDefault) { e.preventDefault(); }
        if (e.stopPropagation) { e.stopPropagation(); }
        return;
      }
      back();
      if (e.preventDefault) { e.preventDefault(); }
      if (e.stopPropagation) { e.stopPropagation(); }
      return;
    }

    /* Media Play / Pause / Seek keys on webOS & Android TV remotes */
    var isPlay = (k === 415 || key === 'MediaPlay' || key === 'Play');
    var isPause = (k === 19 || key === 'MediaPause' || key === 'Pause');
    var isPlayPause = (k === 10252 || key === 'MediaPlayPause');
    var isFwd = (k === 417 || key === 'MediaFastForward' || key === 'FastForward');
    var isRwd = (k === 412 || key === 'MediaRewind' || key === 'Rewind');
    var isStop = (k === 413 || key === 'MediaStop' || key === 'Stop');

    if (state.screen === 'player') {
      if (isPlay) {
        if (playerVideo && playerVideo.paused) {
          try { playerVideo.play(); } catch (ePlay) {}
          showOsdIcon('none');
          showInfobar();
        }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isPause) {
        if (playerVideo && !playerVideo.paused) {
          try { playerVideo.pause(); } catch (ePause) {}
          showOsdIcon('pause');
          showInfobar();
        }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isPlayPause) {
        togglePlayerPlayPause();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isFwd) {
        playerSeek(15);
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isRwd) {
        playerSeek(-15);
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (isStop) {
        back();
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
    }

    /* Menu / ContextMenu button to open in-player settings */
    var isMenu = (k === 457 || k === 93 || k === 467 || key === 'Menu' || key === 'ContextMenu');
    if (state.screen === 'player' && state.playerMode === 'vod' && isMenu) {
      if (dialogPlaySettingsOpen) {
        closePlaySettingsDialog();
      } else if (playSettingViewOpen) {
        closePlaySettingView();
      } else {
        openPlaySettingView();
      }
      if (e.preventDefault) { e.preventDefault(); }
      return;
    }

    if (state.screen === 'player' && (k === 37 || k === 38 || k === 39 || k === 40)) {
      if (dialogPlaySettingsOpen) {
        if (k === 37) { moveFocus('left'); }
        else if (k === 38) { moveFocus('up'); }
        else if (k === 39) { moveFocus('right'); }
        else if (k === 40) { moveFocus('down'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (playSettingViewOpen) {
        schedulePlaySettingHide();
        if (k === 37) { moveFocus('left'); }
        else if (k === 38) { moveFocus('up'); }
        else if (k === 39) { moveFocus('right'); }
        else if (k === 40) { moveFocus('down'); }
        if (e.preventDefault) { e.preventDefault(); }
        return;
      }
      if (state.playerMode === 'vod') {
        if (k === 37) { playerSeek(-10); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 39) { playerSeek(10); if (e.preventDefault) { e.preventDefault(); } return; }
        if (k === 40) {
          openPlaySettingView();
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
        if (k === 38) {
          if (state.infobar) { hideInfobar(); } else { showInfobar(); }
          if (e.preventDefault) { e.preventDefault(); }
          return;
        }
      } else {
        if (state.infobar) { scheduleInfoHide(); } else { showInfobar(); }
      }
    }

    if (k === 37) { moveFocus('left'); }
    else if (k === 38) { moveFocus('up'); }
    else if (k === 39) { moveFocus('right'); }
    else if (k === 40) { moveFocus('down'); }
    else if (k === 13 || k === 32) {
      if (dialogPlaySettingsOpen) {
        activate();
      } else if (playSettingViewOpen) {
        schedulePlaySettingHide();
        activate();
      } else if (state.screen === 'player' && state.streamError && playerVideo && playerVideo.src) {
        var retry = playerVideo.play();
        if (retry && retry.catch) { retry.catch(function () {}); }
        state.streamError = '';
        setPlayerStatus('');
      } else if (state.screen === 'player' && state.playerMode === 'vod') {
        togglePlayerPlayPause();
      } else {
        activate();
      }
    }
    else { handled = false; }
    if (handled && e.preventDefault) { e.preventDefault(); }
  }

  /* ================================================================ WELCOME */
  function startWelcome() {
    var img = $('welcome-loading-img');
    var frame = 1;
    welcomeTimer = setInterval(function () {
      frame++;
      if (frame > 16) { finishWelcome(); return; }
      img.src = 'assets/original/welcome/img_welcome_loading' + frame + '.png';
    }, 250);
  }

  function finishWelcome() {
    if (welcomeTimer) { clearInterval(welcomeTimer); welcomeTimer = null; }
    if (!homeBuilt) { buildHome(); }
    showScreen('home');
    selectTab(0, false);
    setFocus(liveFocus);
    /* The first launch shows the full tab labels even though the video holds
       focus; the rail collapses on the first focus change. */
    var rail = $('home-tabs');
    if (rail) { rail.classList.add('is-expanded'); rail.classList.remove('is-collapsed'); }
    var railBg = document.querySelector('.home-sidebar-bg');
    if (railBg) { railBg.classList.add('is-on'); }
  }

  /* =================================================================== HOME */
  var pageDefs = [buildLivePage, buildFeaturedPage, buildMoviesPage, buildSeriesPage,
                  buildKidsPage, buildAnimePage, buildExplorePage];
  var pagesBuilt = {};

  function ensurePageBuilt(idx) {
    if (pagesBuilt[idx] || !pages[idx] || !pageDefs[idx]) { return; }
    pagesBuilt[idx] = true;
    pageDefs[idx](pages[idx]);
  }

  function buildHome() {
    homeBuilt = true;
    pagesEl = $('home-pages');
    notifyEl = $('home-notify');
    clear(pagesEl);
    pages = [];
    pagesBuilt = {};

    /* Create placeholder wrappers for each tab, but build DOM only on demand */
    for (var i = 0; i < pageDefs.length; i++) {
      var page = el('div', 'home-page scrollable');
      if (i === 0) { page.classList.add('is-current'); }
      pagesEl.appendChild(page);
      pages.push(page);
    }

    var initialTab = (TABS[state.tab] && TABS[state.tab].page >= 0) ? TABS[state.tab].page : 0;
    ensurePageBuilt(initialTab);

    buildTabs();
    buildNotify();
  }

  function buildTabs() {
    var host = $('home-tabs');
    clear(host);
    host.classList.add('scrollable');
    host.classList.add('is-expanded');
    tabEls = [];
    for (var i = 0; i < TABS.length; i++) {
      var item = el('div', 'tab-item focusable');
      item.appendChild(el('div', 'tab-pill'));
      var icon = el('div', 'tab-icon');
      icon.innerHTML = TAB_ICONS[TABS[i].icon] || '';
      item.appendChild(icon);
      var title = el('div', 'tab-title', TABS[i].label);
      item.appendChild(title);
      item._tab = i;
      item._activate = (function (idx) {
        return function () { selectTab(idx, true); };
      })(i);
      item._onMove = (function (idx) {
        return function (dir) {
          if (dir === 'right') {
            if (TABS[idx].page < 0) { selectTab(idx, true); }
            else {
              var page = pages[TABS[idx].page];
              var f = firstIn(page);
              if (f) { setFocus(f); }
            }
            return true;
          }
          return false;
        };
      })(i);
      host.appendChild(item);
      tabEls.push(item);
    }
  }

  function buildNotify() {
    clear(notifyEl);
    /* Notification bar observed on the running app: five circular buttons
       (search, filter, history, profile, message), a divider, the Wi-Fi
       indicator and the 12-hour clock. No text labels are drawn. */
    var defs = [
      { cls: 'search', icon: 'assets/original/home/icon_notify_search.png', small: true },
      { cls: 'filter', icon: 'assets/original/search/icon_category_filter_n.png', small: true },
      { cls: 'rec', icon: 'assets/original/home/icon_notify_records.png', small: false },
      { cls: 'personal', icon: 'assets/original/home/icon_notify_personal.png', small: true },
      { cls: 'msg', icon: 'assets/original/home/icon_notify_message.png', small: false }
    ];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      var item = el('div', 'notify-item focusable ' + d.cls + (d.small ? ' is-small' : ''));
      var nn = el('div', 'n-normal');
      nn.style.backgroundImage = 'url(' + d.icon + ')';
      item.appendChild(nn);
      if (d.cls === 'personal') {
        item._activate = function () { openSettings(); };
      } else if (d.cls === 'search') {
        item._activate = function () { openSearch(); };
      } else {
        item._activate = function () { /* destination not reconstructed */ };
      }
      notifyEl.appendChild(item);
    }
    var div = el('div', 'notify-divider');
    notifyEl.appendChild(div);
    var wifi = el('div', 'notify-wifi');
    wifi.innerHTML = '<svg viewBox="0 0 30 22"><path d="M15 19.5a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2z" fill="currentColor"/><path d="M8.4 12.2a9.6 9.6 0 0 1 13.2 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M4.2 7.6a15.6 15.6 0 0 1 21.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    notifyEl.appendChild(wifi);
    var time = el('div', 'notify-time');
    time.id = 'notify-time';
    notifyEl.appendChild(time);
    updateClock();
    setInterval(updateClock, 30000);
  }

  function updateClock() {
    var t = $('notify-time');
    if (!t) { return; }
    var d = new Date();
    var h = d.getHours();
    var ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) { h = 12; }
    var m = d.getMinutes();
    t.textContent = h + ':' + pad2(m) + ' ' + ap;
  }

  function selectTab(index, focusContent) {
    var def = TABS[index];
    if (def.page < 0) {
      openSettings();
      return;
    }
    var prevPage = TABS[state.tab] ? TABS[state.tab].page : def.page;
    state.tab = index;
    for (var i = 0; i < tabEls.length; i++) {
      tabEls[i].classList.toggle('is-selected', i === index);
    }
    if (def.page >= 0) {
      ensurePageBuilt(def.page);
    }
    for (var p = 0; p < pages.length; p++) {
      pages[p].classList.remove('is-entering', 'from-left', 'from-right');
      pages[p].classList.toggle('is-current', p === def.page);
    }
    /* Same slide direction as the ViewPager; the page itself is the only
       visible layer, which keeps its raster sharp on webOS. */
    if (def.page !== prevPage && pages[def.page]) {
      var pg = pages[def.page];
      pg.classList.add('is-entering', def.page > prevPage ? 'from-right' : 'from-left');
      setTimeout(function () {
        pg.classList.remove('is-entering', 'from-left', 'from-right');
      }, 320);
    }
    if (focusContent) {
      var f = firstIn(pages[def.page]);
      if (f) { setFocus(f); }
    }
  }

  /* --------------------------------------------------------------- posters */
  function makePoster(item, x, y, w, h, opts) {
    opts = opts || {};
    var p = el('div', 'poster focusable' + (opts.gold ? ' gold' : '') + (opts.type3 ? ' type3' : ''));
    abs(p, x, y, w, h);
    if (item.poster) {
      /* Keep the original no-data bitmap underneath: if the remote poster
         fails, removing the <img> reveals the authentic placeholder. */
      var pimg = el('img', 'p-img');
      pimg.src = item.poster;
      pimg.onerror = function () { this.style.display = 'none'; };
      p.appendChild(pimg);
    }
    /* sel_poster_nohalo items (free, search, related) draw their own title,
       so the PosterView title/shadow children stay hidden. */
    if (!opts.gold) {
      p.appendChild(el('div', 'p-shade'));
      p.appendChild(el('div', 'p-title', item.title));
    }
    p._item = item;
    p._activate = function () { openDetail(item); };
    return p;
  }

  function addPosters(page, areaLeft, areaTop, list, items) {
    var area = el('div', 'poster-area');
    abs(area, areaLeft, areaTop, 1830, 940.5);
    var source = (items && items.length) ? items : VOD;
    if (!source.length) { page.appendChild(area); return area; }
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      area.appendChild(makePoster(source[i % source.length], d.x, d.y, d.w, d.h, d.opts));
    }
    page.appendChild(area);
    return area;
  }

  /* ------------------------------------------------------------- home live */
  function buildLivePage(page) {
    liveMain = el('div', 'live-main');
    liveMain.appendChild(el('div', 'live-frame'));
    liveMain.appendChild(el('div', 'live-logo'));
    page.appendChild(liveMain);

    var info = el('div', 'live-info');
    liveInfoText = el('div', 'live-channel');
    /* mTvChannel is layout_toLeftOf mIvFullScreen (alignParentRight), so the
       channel name is right-aligned, not left-aligned. */
    liveInfoText.style.right = '112.5px';
    info.appendChild(liveInfoText);
    var full = el('div', 'live-fullscreen focusable');
    full._activate = function () { openPlayer('live'); };
    info.appendChild(full);
    liveMain.appendChild(info);

    var up = el('div', 'live-arrow-up');
    var down = el('div', 'live-arrow-down');
    page.appendChild(up);
    page.appendChild(down);

    liveList = el('div', 'live-list scrollable');
    page.appendChild(liveList);
    renderLiveRows(false);

    liveFocus = el('div', 'live-focus focusable');
    liveFocus._onMove = function (dir) {
      if (dir === 'up') {
        if (state.channel > 0) { setChannel(state.channel - 1); return true; }
        return false;
      }
      if (dir === 'down') {
        if (state.channel < CHANNELS.length - 1) { setChannel(state.channel + 1); return true; }
        return false;
      }
      if (dir === 'right') {
        var row = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
        if (row) { setFocus(row); }
        return true;
      }
      return false;
    };
    liveFocus._activate = function () { openPlayer('live'); };
    page.appendChild(liveFocus);
  }

  function renderLiveRows(favOnly) {
    clear(liveList);
    liveRows = [];
    for (var i = 0; i < CHANNELS.length; i++) {
      if (favOnly && !CHANNELS[i].fav) { continue; }
      var row = el('div', 'live-row focusable');
      row._channel = i;
      var icon = el('div', 'row-icon');
      var play = el('div', 'row-play');
      var name = el('div', 'row-name', CHANNELS[i].name);
      row.appendChild(icon);
      row.appendChild(play);
      row.appendChild(name);
      if (i === state.channel) { row.classList.add('is-current'); }
      row._activate = (function (idx) {
        return function () { setChannel(idx); openPlayer('live'); };
      })(i);
      row._onMove = function (dir) {
        if (dir === 'left') { setFocus(liveFocus); return true; }
        return false;
      };
      liveList.appendChild(row);
      liveRows.push(row);
    }
    liveInfoText.textContent = CHANNELS[state.channel].name;
    scrollLiveList();
  }

  function scrollLiveList() {
    if (!liveRows.length) { return; }
    var visible = liveRows.filter(function (r) { return r._channel === state.channel; })[0];
    if (!visible) { return; }
    var idx = liveRows.indexOf(visible);
    var top = idx * 120;
    var max = Math.max(0, liveList.scrollHeight - liveList.clientHeight);
    var target = liveList.scrollTop;
    if (top < target) { target = top; }
    if (top + 100.5 > target + liveList.clientHeight) {
      target = top + 100.5 - liveList.clientHeight;
    }
    liveList.scrollTop = Math.max(0, Math.min(max, target));
  }

  function setChannel(index) {
    if (index < 0) { index = 0; }
    if (index > CHANNELS.length - 1) { index = CHANNELS.length - 1; }
    state.channel = index;
    for (var i = 0; i < liveRows.length; i++) {
      liveRows[i].classList.toggle('is-current', liveRows[i]._channel === index);
    }
    liveInfoText.textContent = CHANNELS[index].name;
    scrollLiveList();
    if (state.screen === 'player') { updatePlayerChannel(); }
  }

  /* ---------------------------------------------------------- home posters */
  /* Bento mosaic measured on the running app (WSA, 1920x1080):
       mRecommend01 831x534 @ 192,212   mRecommend02 831x534 @ 1029,212
       mRecommend03..06 413x222 @ y 752, x 192/609/1028/1446
       pagination dots around 843,723 (screen) -> page coords subtract 173.5.
     The page grid is identical for DESTACADOS, PELICULA, SERIES and ANIME. */
  var BENTO = {
    bigW: 831, bigH: 534, bigY: 38.5,
    smallW: 413, smallH: 222, smallY: 578.5,
    bigX: [192, 1029],
    smallX: [192, 609, 1028, 1446]
  };

  function makeBento(item, x, y, w, h, opts) {
    opts = opts || {};
    var t = el('div', 'bento focusable');
    abs(t, x, y, w, h);
    var art = item ? (item.landscape || item.poster) : '';
    if (art) {
      var img = el('img', 'bento-img');
      img.src = art;
      img.onerror = function () { this.style.display = 'none'; };
      t.appendChild(img);
    }
    if (opts.shade) { t.appendChild(el('div', 'bento-shade')); }
    if (opts.title && item) { t.appendChild(el('div', 'bento-title', item.title)); }
    if (opts.badge) { t.appendChild(el('div', 'bento-badge', opts.badge)); }
    t._item = item;
    if (item) { t._activate = function () { openDetail(item); }; }
    return t;
  }

  function bentoDots(x, y, count, active) {
    var d = el('div', 'bento-dots');
    abs(d, x, y, 21 + Math.max(0, count - 1) * 40, 11);
    for (var i = 0; i < count; i++) {
      d.appendChild(el('span', 'bento-dot' + (i === active ? ' is-active' : '')));
    }
    return d;
  }

  function bentoPage(page, items, opts) {
    opts = opts || {};
    var source = items.length ? items : VOD;
    if (!source.length) { return; }
    var i;
    for (i = 0; i < 2; i++) {
      page.appendChild(makeBento(source[i % source.length], BENTO.bigX[i], BENTO.bigY,
                                 BENTO.bigW, BENTO.bigH,
                                 { shade: opts.shade !== false, title: opts.titles }));
    }
    for (i = 0; i < 4; i++) {
      page.appendChild(makeBento(source[(i + 2) % source.length], BENTO.smallX[i], BENTO.smallY,
                                 BENTO.smallW, BENTO.smallH, {}));
    }
    if (opts.dots) { page.appendChild(bentoDots(848, 535.5, opts.dots, 0)); }
  }

  /* DESTACADOS / PELICULA: the observed 831x534 crops already contain the
     real title bar and pagination dots drawn by the APK, so the port must not
     paint a second copy over them. Portal artwork is plain 16:9 art, so the
     title and dots have to be drawn. */
  function allVodFor(category) {
    var out = [], i;
    if (category) {
      for (i = 0; i < VOD.length; i++) {
        var cats = norm(VOD[i].category || '').split(',');
        if (cats.indexOf(category) !== -1 || (VOD[i].kind && norm(VOD[i].kind).indexOf(category) !== -1)) {
          out.push(VOD[i]);
        }
      }
    }
    return out.length ? out : VOD;
  }

  function appendCatalogGrid(page, items, startY, titleText) {
    if (!items || !items.length) { return; }
    var y = startY || 860;
    var sub = el('div', 'kids-subtitle', titleText || 'Catálogo');
    abs(sub, 192, y, 1249, 40);
    page.appendChild(sub);
    y += 50;

    var colW = 276;
    var colH = 390;
    var maxCols = 6;
    var limit = Math.min(items.length, 60);
    for (var k = 0; k < limit; k++) {
      var col = k % maxCols;
      var row = Math.floor(k / maxCols);
      var px = 192 + col * colW;
      var py = y + row * colH;
      page.appendChild(makePoster(items[k], px, py, 250, 360, { gold: true }));
    }
  }

  function buildFeaturedPage(page) {
    var all = allVodFor('destacado');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 4 : 0, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Títulos destacados');
    }
  }

  function buildMoviesPage(page) {
    var all = allVodFor('pelicula');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 4 : 0, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Más películas');
    }
  }

  function buildSeriesPage(page) {
    var all = allVodFor('serie');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Más series');
    }
  }

  function buildAnimePage(page) {
    var all = allVodFor('anime');
    var items = all.slice(0, 6);
    var real = !!(items[0] && items[0]._portal);
    bentoPage(page, items, { titles: real, dots: real ? 3 : 2, shade: real });
    var rest = all.slice(6);
    if (rest.length) {
      appendCatalogGrid(page, rest, 860, 'Anime y animación');
    }
  }

  /* KIDS: hero 831x534 + 2x2 grid 413x222 on the right, a subtitle line and a
     horizontal poster row (7 columns, last one clipped by the screen edge). */
  function buildKidsPage(page) {
    var source = vodFor('infantil', 12, 0);
    if (!source.length) { source = VOD; }
    var real = !!(source[0] && source[0]._portal);
    page.appendChild(makeBento(source[0], 192, 38.5, 831, 534, { shade: true, title: real }));
    var cells = [
      [1029, 38.5], [1446, 38.5], [1029, 269.5], [1446, 269.5]
    ];
    for (var i = 0; i < cells.length; i++) {
      page.appendChild(makeBento(source[(i + 1) % source.length], cells[i][0], cells[i][1],
                                 413, 222, {}));
    }
    page.appendChild(bentoDots(833, 468.5, 4, 0));
    if (source[0]) {
      var sub = el('div', 'kids-subtitle', source[0].tagline || source[0].title);
      abs(sub, 192, 526.5, 1249, 40);
      page.appendChild(sub);
    }
    var row = el('div', 'poster-row');
    abs(row, 192, 578.5, 1920, 310);
    for (var k = 0; k < 7; k++) {
      var it = source[k % source.length];
      if (!it) { break; }
      row.appendChild(makePoster(it, k * 266, 0, 266, 310, { gold: true }));
    }
    page.appendChild(row);
  }

  /* EXPLORAR: hero 1249x703 + three stacked 413x226 tiles on the right,
     provider row label and logo strip underneath. */
  function buildExplorePage(page) {
    var source = VOD.length ? VOD : [];
    page.appendChild(makeBento(source[0], 192, 38.5, 1249, 703, { shade: true }));
    for (var i = 0; i < 3; i++) {
      page.appendChild(makeBento(source[(i + 1) % source.length], 1446, 38.5 + i * 231,
                                 413, 226, { badge: i === 2 ? 'Adult' : '' }));
    }
    page.appendChild(el('div', 'explore-row-title', 'Netflix'));
    var strip = el('div', 'explore-strip');
    abs(strip, 192, 811.5, 1920, 130);
    for (var k = 0; k < 8; k++) {
      var cell = el('div', 'explore-logo');
      abs(cell, k * 272, 0, 260, 120);
      strip.appendChild(cell);
    }
    page.appendChild(strip);
  }

  /* ============================================================ VOD DETAIL */
  function openDetail(item) {
    state.detail = item;
    state.detailReturn = { screen: state.screen, focus: state.focus };
    state.detailRange = 0;
    state.detailSeason = 0;
    state.detailEpisode = null;

    if (item.seasons && item.seasons.length) {
      for (var s = 0; s < item.seasons.length; s++) {
        if (item.seasons[s].id === item.id) {
          state.detailSeason = s;
          break;
        }
      }
    }
    if (item.episodes && item.episodes.length) {
      state.detailEpisode = item.episodes[0];
    }

    buildDetail(item);
    showScreen('detail');

    /* Mostrar reproductor en recuadro mini */
    if (!playerStage) { buildPlayer(); }
    var scrPlayer = $('screen-player');
    if (scrPlayer) {
      scrPlayer.classList.add('is-mini');
      scrPlayer.classList.add('is-active');
    }

    var f = detailButtons ? detailButtons.querySelector('.focusable') : null;
    if (f) { setFocus(f); }

    if (item._detailsLoaded) {
      startPlayerVideo(item, state.detailEpisode);
    } else {
      setPlayerStatus('Preparando la reproducción…');
      loadVodDetail(item, function (loaded) {
        if (loaded && state.screen === 'detail' && state.detail === loaded) {
          startPlayerVideo(loaded, state.detailEpisode);
        }
      });
    }
  }

  function toggleSynopsis() {
    var screen = $('screen-detail');
    if (!screen) { return; }
    var open = !screen.classList.contains('is-synopsis-open');
    screen.classList.toggle('is-synopsis-open', open);
    var more = document.querySelector('.detail-more');
    if (more) { more.textContent = open ? 'Menos' : 'Más'; }
  }

  function buildDetail(item) {
    detailLeft = $('detail-left');
    detailPlayer = $('detail-player');
    detailButtons = $('detail-buttons');
    detailBottom = $('detail-bottom');
    clear(detailLeft); clear(detailButtons); clear(detailBottom);

    /* left column: 806px at 80/50 */
    var tw = el('div', 'detail-titlewrap');
    tw.appendChild(el('div', 'detail-title', item.title));
    tw.appendChild(el('div', 'detail-score', item.score));
    detailLeft.appendChild(tw);

    var metaText;
    if (item.country || item.releaseDate || item.tagline) {
      /* mTextTimeType: "country | release date | viewpoint" (reference). */
      var bits = [];
      if (item.country) { bits.push(item.country); }
      if (item.releaseDate) { bits.push(item.releaseDate); }
      if (item.tagline) { bits.push(item.tagline); }
      metaText = bits.join(' | ');
    } else {
      var parts = [];
      if (item.year && item.year !== '—') { parts.push(item.year); }
      if (item.duration && item.duration !== '—') { parts.push(item.duration); }
      parts.push('HD');
      metaText = parts.join('  ·  ');
    }
    detailLeft.appendChild(el('div', 'detail-meta', metaText));

    /* mTextUpdate: gold "T10 - E73", series only. The season comes from the
       alias ("... S10") or the season list; the count is the episode total. */
    if (isSeriesItem(item)) {
      var seasonNo = 0;
      var sm = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
      if (sm) { seasonNo = parseInt(sm[1], 10) || 0; }
      if (!seasonNo && item.seasons && item.seasons.length) {
        var curSeason = item.seasons[state.detailSeason] || item.seasons[0];
        seasonNo = (curSeason && curSeason.number) || 1;
      }
      if (!seasonNo) { seasonNo = 1; }
      var epTotal = item.updateCount || item.volumeCount || (item.episodes ? item.episodes.length : 0);
      if (epTotal) {
        detailLeft.appendChild(el('div', 'detail-update', 'T' + seasonNo + ' - E' + epTotal));
      }
    }

    var genres = el('div', 'detail-genres');
    genres.appendChild(el('span', 'label', 'Género : '));
    for (var g = 0; g < item.genres.length; g++) {
      var chip = el('div', 'chip focusable', item.genres[g]);
      chip._activate = function () { /* genre filter screen not reconstructed */ };
      genres.appendChild(chip);
    }
    detailLeft.appendChild(genres);

    var dir = el('div', 'detail-row');
    dir.appendChild(document.createTextNode('Director : '));
    var dirV = el('span', 'val focusable', item.director);
    dirV._activate = function () { /* person page not reconstructed */ };
    dir.appendChild(dirV);
    detailLeft.appendChild(dir);

    var act = el('div', 'detail-row');
    act.appendChild(document.createTextNode('Actors : '));
    var actV = el('span', 'val focusable', item.actors);
    actV._activate = function () { /* person page not reconstructed */ };
    act.appendChild(actV);
    detailLeft.appendChild(act);

    var syn = el('div', 'detail-synopsis');
    syn.appendChild(el('span', 'label', 'Sinopsis : '));
    syn.appendChild(el('div', 'text', item.synopsis));
    /* mTextIntroduction + tvMore: the APK expands the 2-line preview in place.
       Here the expanded block overlays the button row (documented). */
    var more = el('div', 'detail-more focusable', 'Más');
    more._activate = toggleSynopsis;
    syn.appendChild(more);
    detailLeft.appendChild(syn);

    /* player window 765x430 at right 80 / top 50. */
    clear(detailPlayer);
    detailPlayer.classList.add('focusable');
    detailPlayer._activate = function () { expandToFullscreen(item, state.detailEpisode); };
    detailPlayer._onMove = function () { return false; };

    /* buttons 276x68, gap 30 */
    var btnDefs = [
      { icon: 'icon_detail_fullscreen.png', label: 'Pantalla completa' },
      { icon: 'icon_detail_subtitle_audio.png', label: 'Idioma' },
      { icon: 'icon_detail_quality.png', label: 'Resolución' },
      { icon: 'icon_detail_favorite.png', label: 'Favorito' }
    ];
    if (isSeriesItem(item)) {
      btnDefs.push({ icon: 'icon_detail_subscribe.png', label: 'Notificaciones' });
    }
    for (var b = 0; b < btnDefs.length; b++) {
      var btn = el('div', 'detail-btn focusable');
      var ico = el('img');
      ico.src = 'assets/original/vod/' + btnDefs[b].icon;
      ico.alt = '';
      btn.appendChild(ico);
      btn.appendChild(el('span', null, btnDefs[b].label));
      btn._kind = b;
      btn._activate = (function (kind, it) {
        return function () {
          if (kind === 0) { expandToFullscreen(it, state.detailEpisode); }
          else if (kind === 3) {
            state.favs[it.id] = !state.favs[it.id];
          } else if (kind === 4) {
            var img = this.querySelector('img');
            var on = img.src.indexOf('subscribed') === -1;
            img.src = 'assets/original/vod/icon_detail_' + (on ? 'subscribed' : 'subscribe') + '.png';
          }
        };
      })(b, item);
      detailButtons.appendChild(btn);
    }
    var modeBtn = el('div', 'detail-btn focusable');
    var modeIcon = el('img');
    modeIcon.src = 'assets/original/vod/icon_detail_quality.png';
    modeIcon.alt = '';
    modeBtn.appendChild(modeIcon);
    var modeLabel = el('span', null, state.streamMode === 'smooth' ? 'Modo fluido: Sí' : 'Modo fluido: No');
    modeBtn.appendChild(modeLabel);
    modeBtn._activate = function () {
      state.streamMode = state.streamMode === 'smooth' ? 'normal' : 'smooth';
      modeLabel.textContent = state.streamMode === 'smooth' ? 'Modo fluido: Sí' : 'Modo fluido: No';
    };
    detailButtons.appendChild(modeBtn);

    renderDetailBottom(item);
  }

  /* Episode ranges are chunks of 20 ("1-20", "21-40", ...) as observed. */
  function detailRanges(count) {
    var out = [];
    for (var s = 0; s < count; s += 20) {
      out.push({ start: s, end: Math.min(count, s + 20) });
    }
    return out;
  }

  function detailSeasonLabel(item) {
    var n = 0;
    if (item.seasons && item.seasons.length > 0) {
      var cur = item.seasons[state.detailSeason] || item.seasons[0];
      n = cur && cur.number ? cur.number : state.detailSeason + 1;
    }
    if (!n) {
      var m = /S(\d+)/i.exec(item.alias || '') || /T(\d+)/i.exec(item.title || '');
      if (m) { n = parseInt(m[1], 10) || 0; }
    }
    return 'Temporada ' + (n || 1);
  }

  function selectDetailRange(index, item) {
    state.detailRange = index;
    buildDetail(item);
    var f = detailBottom.querySelector('.detail-range.is-selected');
    if (f) { setFocus(f); }
  }

  var seasonPopup = null;
  function closeSeasonPopup() {
    if (seasonPopup && seasonPopup.parentNode) {
      seasonPopup.parentNode.removeChild(seasonPopup);
      seasonPopup = null;
    }
    var arrow = detailBottom ? detailBottom.querySelector('.season-arrow') : null;
    if (arrow) { arrow.classList.remove('is-open'); }
  }

  function toggleSeasonPopup(anchorBtn, item) {
    if (seasonPopup) {
      closeSeasonPopup();
      return;
    }
    if (!item.seasons || item.seasons.length < 2) { return; }

    var arrow = anchorBtn.querySelector('.season-arrow');
    if (arrow) { arrow.classList.add('is-open'); }

    seasonPopup = el('div', 'season-popup');
    abs(seasonPopup, 80, 100, 280, Math.min(320, item.seasons.length * 54));

    for (var s = 0; s < item.seasons.length; s++) {
      (function (sIndex) {
        var sData = item.seasons[sIndex];
        var isSelected = sIndex === state.detailSeason;
        var pItem = el('div', 'season-popup-item focusable' + (isSelected ? ' is-selected' : ''));
        var sText = 'Temporada ' + (sData.number || (sIndex + 1));
        pItem.appendChild(el('span', 'season-item-text', sText));

        var check = el('img', 'season-item-check');
        check.src = 'assets/original/vod/icon_nation_selected.png';
        check.alt = '';
        pItem.appendChild(check);

        pItem._activate = function () {
          closeSeasonPopup();
          if (state.detailSeason !== sIndex) {
            state.detailSeason = sIndex;
            state.detailRange = 0;
            state.detailEpisode = null;
            var targetSeason = item.seasons[sIndex];
            if (targetSeason && targetSeason.id) {
              setPlayerStatus('Cargando temporada…');
              portalServiceCall('detail', { contentId: targetSeason.id }, function (err, payload) {
                if (!err && payload && payload.returnValue !== false) {
                  if (payload.item) { mergeDetail(item, payload.item); }
                  item.episodes = payload.episodes || [];
                  state.detailEpisode = item.episodes[0] || null;
                }
                buildDetail(item);
                if (state.detailEpisode) {
                  startPlayerVideo(item, state.detailEpisode);
                }
                var sBtn = detailBottom ? detailBottom.querySelector('.detail-season') : null;
                if (sBtn) { setFocus(sBtn); }
              });
            }
          } else {
            var sBtn2 = detailBottom ? detailBottom.querySelector('.detail-season') : null;
            if (sBtn2) { setFocus(sBtn2); }
          }
        };

        seasonPopup.appendChild(pItem);
      })(s);
    }

    detailBottom.appendChild(seasonPopup);
    var focusedChild = seasonPopup.children[state.detailSeason] || seasonPopup.children[0];
    if (focusedChild) { setFocus(focusedChild); }
  }

  function renderDetailBottom(item) {
    var episodes = (isSeriesItem(item) && item.episodes) ? item.episodes : [];
    var hasEpisodes = episodes.length > 0;
    var ranges = detailRanges(episodes.length);
    if (state.detailRange >= ranges.length) { state.detailRange = 0; }

    /* Season dropdown button (flChoose / llSeanson) */
    if (isSeriesItem(item)) {
      var seasonBtn = el('div', 'detail-season focusable');
      abs(seasonBtn, 80, 42, 280, 53);
      seasonBtn.appendChild(el('span', 'season-text', detailSeasonLabel(item)));
      var arrow = el('img', 'season-arrow');
      arrow.src = 'assets/original/vod/ic_down_icon.png';
      arrow.alt = '▼';
      seasonBtn.appendChild(arrow);
      seasonBtn._activate = function () {
        if (!item.seasons || item.seasons.length < 2) { return; }
        toggleSeasonPopup(seasonBtn, item);
      };
      detailBottom.appendChild(seasonBtn);
    }

    /* Range tabs (1-20, 21-40...) */
    if (hasEpisodes && episodes.length > 20) {
      var rangeRow = el('div', 'detail-ranges');
      abs(rangeRow, 398, 51, 1522, 46);
      for (var i = 0; i < ranges.length; i++) {
        (function (idx) {
          var tab = el('div', 'detail-range focusable' + (idx === state.detailRange ? ' is-selected' : ''),
                       (ranges[idx].start + 1) + '-' + ranges[idx].end);
          abs(tab, idx * 160, 0, 150, 46);
          tab._activate = function () { selectDetailRange(idx, item); };
          rangeRow.appendChild(tab);
        })(i);
      }
      detailBottom.appendChild(rangeRow);
    }

    /* Episode grid */
    if (hasEpisodes) {
      var current = ranges[state.detailRange] || { start: 0, end: episodes.length };
      var row = el('div', 'detail-episodes scrollable');
      abs(row, 80, 149, 1840, 65);
      for (var e = current.start; e < current.end; e++) {
        (function (ep, index) {
          var isPlaying = state.detailEpisode && (state.detailEpisode.id === ep.id || state.detailEpisode === ep);
          var tile = el('div', 'detail-episode focusable' + (isPlaying ? ' is-playing' : ''));
          abs(tile, index * 160, 0, 150, 65);
          var numText = (ep.number !== undefined && ep.number !== null) ? String(ep.number) : String(e + 1);
          tile.appendChild(el('span', 'ep-num', numText));
          tile._activate = function () {
            state.detailEpisode = ep;
            startPlayerVideo(item, ep);
            renderDetailBottom(item);
          };
          row.appendChild(tile);
        })(episodes[e], e - current.start);
      }
      detailBottom.appendChild(row);
    }

    /* mTextRelated + mGridRelated. The series layout pushes them below the
       episode selector, so the poster row is clipped by the screen edge. */
    var relatedTop = hasEpisodes ? 240 : 25;
    var gridTop = hasEpisodes ? 290 : 91;
    var heading = el('div', 'detail-related', 'Quizás te guste');
    abs(heading, 80, relatedTop, 400, 44);
    detailBottom.appendChild(heading);

    var grid = el('div', 'detail-grid scrollable');
    abs(grid, 80, gridTop, 1750, hasEpisodes ? 180 : 380);
    var seed = parseInt(item.id, 10);
    if (isNaN(seed)) {
      seed = 0;
      for (var s = 0; s < VOD.length; s++) { if (VOD[s] === item) { seed = s; break; } }
    }
    var start = (seed * 3) % Math.max(1, VOD.length - 6);
    for (var r = 0; r < 8; r++) {
      var rel = VOD[(start + r) % VOD.length];
      if (!rel) { continue; }
      var cell = el('div', 'cell');
      cell.appendChild(makePoster(rel, 0, 0, 210, 308, { gold: true }));
      cell.appendChild(el('div', 'd-name', rel.title));
      grid.appendChild(cell);
    }
    detailBottom.appendChild(grid);
  }

  /* ================================================================ SEARCH */
  function hotSearches() {
    var all = bundledCatalog();
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var cat = String((all[i] && all[i].category) || '').toLowerCase();
      if (cat.indexOf('busqueda') !== -1) { out.push(normalizeVod(all[i], i + 1)); }
    }
    return out;
  }

  function buildSearch() {
    searchKeyboard = $('search-keyboard');
    searchHot = $('search-hot');
    searchResults = $('search-results');
    searchEmpty = $('search-empty');
    searchHotGrid = $('search-hot-grid');
    searchResultGrid = $('search-result-grid');
    clear(searchKeyboard); clear(searchHotGrid); clear(searchResultGrid);

    /* --- keyboard panel (layout_search_keybord_full_uni) --- */
    searchInput = el('div', 'kb-edit focusable');
    searchInput._activate = function () { /* edit field */ };
    searchKeyboard.appendChild(searchInput);

    var actions = el('div', 'kb-actions');
    var actionDefs = [
      { cls: 'switch', w: 100.5 },
      { cls: 'clear', w: 100.5 },
      { cls: 'del', w: 100.5 },
      { cls: 'go', w: 120 }
    ];
    for (var a = 0; a < actionDefs.length; a++) {
      var act = el('div', 'kb-action focusable ' + actionDefs[a].cls);
      act.style.width = actionDefs[a].w + 'px';
      if (actionDefs[a].cls === 'go') {
        act.textContent = 'Busca';
      } else {
        act.appendChild(el('div', 'ico'));
      }
      act._kind = actionDefs[a].cls;
      act._activate = (function (kind) {
        return function () {
          if (kind === 'switch') { toggleSearchNumeric(); }
          else if (kind === 'clear') { setSearchQuery(''); }
          else if (kind === 'del') { setSearchQuery(state.searchQuery.slice(0, -1)); }
          else { runSearch(); }
        };
      })(actionDefs[a].cls);
      actions.appendChild(act);
    }
    searchKeyboard.appendChild(actions);

    searchKeys = [];
    var rows = [
      ['A', 'Á', 'B', 'C', 'D', 'E', 'É'],
      ['F', 'G', 'H', 'I', 'Í', 'J', 'K'],
      ['L', 'M', 'N', 'Ñ', 'O', 'Ó', 'P'],
      ['Q', 'R', 'S', 'T', 'U', 'Ú', 'Ü'],
      ['V', 'W', 'X', 'Y', 'Z', ' ']
    ];
    for (var r = 0; r < rows.length; r++) {
      var row = el('div', 'kb-row');
      row.style.top = (264 + r * 88.5) + 'px';
      for (var c = 0; c < rows[r].length; c++) {
        var key = el('div', 'kb-key focusable' + (rows[r][c] === ' ' ? ' space' : ''),
          rows[r][c] === ' ' ? '' : rows[r][c]);
        key._char = rows[r][c];
        key._activate = (function (ch) {
          return function () { setSearchQuery(state.searchQuery + ch); };
        })(rows[r][c]);
        row.appendChild(key);
        searchKeys.push(key);
      }
      searchKeyboard.appendChild(row);
    }

    var feedback = el('div', 'kb-feedback focusable', 'Feedback');
    feedback._activate = function () { /* feedback form not reconstructed */ };
    searchKeyboard.appendChild(feedback);

    /* --- hot search grid (observed "Búsqueda popular", 10 portrait cells) --- */
    var hotItems = hotSearches();
    if (!hotItems.length) { hotItems = vodFor('busqueda', 10, 0); }
    for (var h = 0; h < hotItems.length; h++) {
      searchHotGrid.appendChild(makeSearchCell(hotItems[h], h));
    }

    searchResults.classList.remove('is-active');
    searchEmpty.classList.remove('is-active');
    searchHot.classList.remove('is-hidden');
    updateSearchInput();
  }

  function makeSearchCell(item, index) {
    var cell = el('div', 'search-cell');
    abs(cell, (index % 5) * 246, Math.floor(index / 5) * 437, 246, 437);
    cell.appendChild(makePoster(item, 0, 0, 222, 329, { gold: true }));
    cell.appendChild(el('div', 's-name', item.title));
    return cell;
  }

  function openSearch() {
    if (!searchKeyboard) { buildSearch(); }
    showScreen('search');
    setFocus(searchInput);
  }

  function updateSearchInput() {
    if (!searchInput) { return; }
    if (state.searchQuery) {
      searchInput.textContent = state.searchQuery;
      searchInput.classList.remove('is-placeholder');
    } else {
      searchInput.textContent = 'Buscar películas, series, directores y actores.';
      searchInput.classList.add('is-placeholder');
    }
  }

  function setSearchQuery(q) {
    state.searchQuery = q;
    updateSearchInput();
    runSearch();
  }

  function clearSearchState() {
    if (state.searchTimer) { clearTimeout(state.searchTimer); state.searchTimer = null; }
    state.searchQuery = '';
    updateSearchInput();
    if (searchResultGrid) { clear(searchResultGrid); }
    if (searchResults) { searchResults.classList.remove('is-active'); }
    if (searchEmpty) { searchEmpty.classList.remove('is-active'); }
    if (searchHot) { searchHot.classList.remove('is-hidden'); }
  }

  function runSearch() {
    var rawQ = state.searchQuery || '';
    var q = norm(rawQ.trim());
    if (!q) {
      clearSearchState();
      return;
    }
    /* Instant local matches (0ms response) */
    var localMatches = [];
    for (var i = 0; i < VOD.length; i++) {
      var tNorm = norm(VOD[i].title || '');
      var aNorm = VOD[i].alias ? norm(VOD[i].alias) : '';
      if (tNorm.indexOf(q) !== -1 || (aNorm && aNorm.indexOf(q) !== -1)) {
        localMatches.push(VOD[i]);
      }
    }
    renderSearchResults(localMatches);

    /* Debounced remote portal search (350ms) */
    if (state.searchTimer) { clearTimeout(state.searchTimer); }
    if (vodApi.mode === 'portal' && q.length >= 2) {
      var seq = ++state.searchSeq;
      state.searchTimer = setTimeout(function () {
        portalServiceCall('search', { value: rawQ.trim() }, function (error, payload) {
          if (seq !== state.searchSeq) { return; }
          if (error || !payload || payload.returnValue === false || !payload.items || !payload.items.length) {
            /* Keep existing local matches, never clear on empty remote response */
            return;
          }
          var merged = localMatches.slice();
          var seen = {};
          for (var m = 0; m < merged.length; m++) { seen[String(merged[m].id)] = true; }
          for (var p = 0; p < payload.items.length; p++) {
            var item = normalizeVod(payload.items[p], merged.length + 1);
            if (!seen[String(item.id)]) {
              seen[String(item.id)] = true;
              merged.push(item);
            }
          }
          renderSearchResults(merged);
        });
      }, 350);
    }
  }

  function renderSearchResults(matches) {
    searchHot.classList.add('is-hidden');
    searchResults.classList.add('is-active');
    clear(searchResultGrid);
    if (matches.length === 0) {
      searchEmpty.classList.add('is-active');
      return;
    }
    searchEmpty.classList.remove('is-active');
    for (var m = 0; m < Math.min(matches.length, 10); m++) {
      searchResultGrid.appendChild(makeSearchCell(normalizeVod(matches[m], m + 1), m));
    }
    if (state.screen === 'search' && closest(state.focus, '.search-hot')) {
      var f = firstIn(searchResultGrid);
      if (f) { setFocus(f); }
    }
  }

  function toggleSearchNumeric() {
    state.searchNumeric = !state.searchNumeric;
    var sw = searchKeyboard.querySelector('.kb-action.switch .ico');
    if (sw) {
      sw.style.backgroundImage = 'url(assets/original/search/' +
        (state.searchNumeric ? 'ic_vod_search_abc.png' : 'ic_vod_search_123.png') + ')';
    }
    var rows = searchKeyboard.querySelectorAll('.kb-row:not(.kb-row-num)');
    if (!state.searchNumeric) {
      for (var i = 0; i < rows.length; i++) { rows[i].classList.remove('hidden'); }
      searchKeys.forEach(function (k) { k.classList.remove('hidden'); });
      var old = searchKeyboard.querySelectorAll('.kb-row-num');
      for (var o = 0; o < old.length; o++) { old[o].classList.add('hidden'); }
      return;
    }
    for (var r = 0; r < rows.length; r++) { rows[r].classList.add('hidden'); }
    if (!searchKeyboard.querySelector('.kb-row-num')) {
      var digits = [['1', '2', '3', '4', '5', '6', '7'], ['8', '9', '0', ' ']];
      for (var d = 0; d < digits.length; d++) {
        var row = el('div', 'kb-row kb-row-num');
        row.style.top = (264 + d * 88.5) + 'px';
        for (var c = 0; c < digits[d].length; c++) {
          var key = el('div', 'kb-key focusable' + (digits[d][c] === ' ' ? ' space' : ''),
            digits[d][c] === ' ' ? '' : digits[d][c]);
          key._activate = (function (ch) {
            return function () { setSearchQuery(state.searchQuery + ch); };
          })(digits[d][c]);
          row.appendChild(key);
        }
        searchKeyboard.appendChild(row);
      }
    }
    var numRows = searchKeyboard.querySelectorAll('.kb-row-num');
    for (var n = 0; n < numRows.length; n++) { numRows[n].classList.remove('hidden'); }
  }

  /* ============================================================== SETTINGS */
  function buildSettings() {
    settingsMenu = $('settings-menu');
    settingsRight = $('settings-right');
    clear(settingsMenu); clear(settingsRight);

    settingsItems = [];
    for (var i = 0; i < SETTINGS_ITEMS.length; i++) {
      var item = el('div', 'settings-item focusable', SETTINGS_ITEMS[i].label);
      item._index = i;
      item._activate = (function (idx) {
        return function () { showSettingsPanel(idx, true); };
      })(i);
      item._onMove = function (dir) {
        if (dir === 'right') {
          var f = firstIn(settingsRight.querySelector('.settings-panel.is-active'));
          if (f) { setFocus(f); }
          return true;
        }
        return false;
      };
      settingsMenu.appendChild(item);
      settingsItems.push(item);
    }

    settingsPanels = {};
    settingsPanels.playback = buildPlaybackPanel();
    settingsPanels.cr = buildCrPanel();
    settingsPanels.parent = buildParentPanel();
    settingsPanels.feedback = buildFeedbackPanel();
    settingsPanels.upgrade = buildUpgradePanel();
    settingsPanels.about = buildAboutPanel();
    settingsPanels.account = buildPendingPanel('Account',
      'Panel de cuenta no reconstruido en esta pasada. El layout original depende del estado de sesión y de recursos servidos.');
    settingsPanels.purchase = buildPendingPanel('Purchase',
      'Panel de compras no reconstruido en esta pasada. El layout original depende del estado de sesión y de recursos servidos.');

    for (var k in settingsPanels) {
      if (settingsPanels.hasOwnProperty(k)) { settingsRight.appendChild(settingsPanels[k]); }
    }
  }

  function openSettings() {
    if (!settingsMenu) { buildSettings(); }
    showScreen('settings');
    showSettingsPanel(0, false);
    setFocus(settingsItems[0]);
  }

  function showSettingsPanel(index, focus) {
    var ids = ['playback', 'cr', 'parent', 'feedback', 'upgrade', 'about', 'account', 'purchase'];
    for (var i = 0; i < settingsItems.length; i++) {
      settingsItems[i].classList.toggle('is-selected', i === index);
    }
    for (var k in settingsPanels) {
      if (settingsPanels.hasOwnProperty(k)) {
        settingsPanels[k].classList.toggle('is-active', k === ids[index]);
      }
    }
    if (focus) {
      var f = firstIn(settingsPanels[ids[index]]);
      /* Panels such as "Sobre nosotros" have no focusable control. In that
         case keep the focus on the selected menu entry instead of leaving a
         different, unrelated entry highlighted. */
      setFocus(f || settingsItems[index]);
    }
  }

  function panelBase(title) {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title', title));
    return p;
  }

  function buildPlaybackPanel() {
    var p = panelBase('Configuración global de reproducción');
    p.appendChild(el('div', 'sp-hr'));

    addOptionRow(p, 227, 'Formato de pantalla', ['Pantalla completa', 'Normal', '16:9', '4:3'],
      'screen', state.playback.screen);
    addOptionRow(p, 374, 'Audio', ['Español', 'Portugués', 'Inglés'],
      'audio', state.playback.audio);

    p.appendChild(abs(el('div', 'sp-hr'), 0, 536, 1498, 1));
    p.appendChild(el('div', 'sp-subtitle-h', 'Subtitulos'));
    var sw = el('div', 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off'));
    sw._activate = function () {
      state.playback.subtitle = !state.playback.subtitle;
      sw.className = 'sp-switch focusable ' + (state.playback.subtitle ? 'on' : 'off');
      setFocus(sw);
    };
    p.appendChild(sw);

    addOptionRow(p, 682, 'Idioma', ['Español', 'Portugués', 'Inglés'],
      'subLang', state.playback.subLang);
    addOptionRow(p, 803, 'Tamaño', ['Normal', 'Grande', 'Pequeño'],
      'size', state.playback.size);
    addStyleRow(p, 924);
    return p;
  }

  function addOptionRow(panel, top, label, options, group, selected) {
    var row = el('div', 'pb-row');
    row.style.top = top + 'px';
    row.appendChild(el('div', 'pb-label', label));
    for (var i = 0; i < options.length; i++) {
      var opt = el('div', 'pb-opt focusable' + (i === selected ? ' is-checked' : ''));
      opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
      opt.appendChild(el('div', 'radio'));
      opt.appendChild(el('span', null, options[i]));
      opt._group = group;
      opt._index = i;
      opt._activate = function () {
        state.playback[this._group] = this._index;
        var opts = panel.querySelectorAll('.pb-opt');
        for (var o = 0; o < opts.length; o++) {
          if (opts[o]._group === this._group) {
            opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
          }
        }
      };
      row.appendChild(opt);
    }
    panel.appendChild(row);
  }

  function addStyleRow(panel, top) {
    var row = el('div', 'pb-row');
    row.style.top = top + 'px';
    row.appendChild(el('div', 'pb-label', 'Estilo'));
    var colors = ['#ffffff', '#f6e33f', '#ffffff'];
    for (var i = 0; i < 3; i++) {
      var opt = el('div', 'pb-opt focusable' + (i === state.playback.style ? ' is-checked' : ''));
      opt.style.marginLeft = (i === 0 ? 0 : 28) + 'px';
      opt.appendChild(el('div', 'radio'));
      var aa = el('span', null, 'Aa');
      aa.style.color = colors[i];
      if (i === 2) {
        aa.style.background = '#000000';
        aa.style.display = 'inline-block';
        aa.style.width = '94px';
        aa.style.height = '50px';
        aa.style.lineHeight = '50px';
        aa.style.fontSize = '28px';
      }
      opt.appendChild(aa);
      opt._group = 'style';
      opt._index = i;
      opt._activate = function () {
        state.playback.style = this._index;
        var opts = panel.querySelectorAll('.pb-opt');
        for (var o = 0; o < opts.length; o++) {
          if (opts[o]._group === 'style') {
            opts[o].classList.toggle('is-checked', opts[o]._index === this._index);
          }
        }
      };
      row.appendChild(opt);
    }
    panel.appendChild(row);
  }

  function buildCrPanel() {
    var p = el('div', 'settings-panel');
    var head = el('div', 'cr-head');
    head.appendChild(el('span', 't', 'Contenido adulto'));
    var sw = el('div', 'sw focusable ' + (state.crOn ? 'on' : 'off'));
    sw._activate = function () {
      state.crOn = !state.crOn;
      sw.className = 'sw focusable ' + (state.crOn ? 'on' : 'off');
      setFocus(sw);
    };
    head.appendChild(sw);
    p.appendChild(head);

    p.appendChild(el('div', 'cr-tip', '(LIVE-18+，Explorar-Adult)'));
    var btn = el('div', 'cr-btn focusable', 'Cambiar contraseña de control parental');
    btn._activate = function () { /* password dialog not reconstructed */ };
    p.appendChild(btn);
    p.appendChild(el('div', 'cr-warn', 'Establecer contraseña para activar contenidos para adultos'));
    return p;
  }

  function buildParentPanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'pl-title', 'Configuraciones del Control Parental'));
    p.appendChild(el('div', 'pl-tip', 'Ingrese la contraseña de cuatro dígitos e ingrese viendo el programa de bloqueo.'));
    p.appendChild(el('div', 'pl-label', 'Contraseña inicial:'));
    var boxes = el('div', 'pl-boxes');
    for (var i = 0; i < 4; i++) {
      var b = el('div', 'pl-box focusable');
      b._activate = function () { /* numeric capture not reconstructed */ };
      boxes.appendChild(b);
      if (i < 3) { boxes.appendChild(el('div', 'pl-sep')); }
    }
    p.appendChild(boxes);
    p.appendChild(el('div', 'pl-note', ''));
    var ok = el('div', 'pl-ok focusable', 'OK');
    ok._activate = function () { /* password validation not reconstructed */ };
    p.appendChild(ok);
    return p;
  }

  function buildFeedbackPanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'fb-title', 'Ayuda y Feedback'));
    p.appendChild(el('div', 'fb-hr'));
    p.appendChild(el('div', 'fb-contact',
      'Si tiene alguna duda, puede ponerse en contacto con nosotros a través de los siguientes medios:'));
    p.appendChild(el('div', 'fb-qr-note', 'Escanee el código QR para enviar sugerencias o comentarios.'));
    var qr = el('div', 'fb-qr');
    p.appendChild(qr);
    var help = el('div', 'fb-help focusable', 'Ayuda');
    help._activate = function () { /* help center not reconstructed */ };
    p.appendChild(help);
    return p;
  }

  function buildUpgradePanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title plain', 'Settings'));
    p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));

    var cache = el('div', 'sp-card');
    abs(cache, 30, 198, 1360, 461);
    cache.appendChild(el('h3', null, 'Limpiar cache'));
    var rows = [
      { y: 139, label: 'Historia' },
      { y: 246, label: 'Cache de foto' },
      { y: 353, label: 'Limpiar todos' }
    ];
    for (var i = 0; i < rows.length; i++) {
      var row = el('div', 'sp-clear-row');
      row.style.top = rows[i].y + 'px';
      row.appendChild(el('span', 'lbl', rows[i].label));
      var btn = el('div', 'btn focusable', 'Limpiar');
      btn._activate = function () { /* cache clearing not implemented */ };
      row.appendChild(btn);
      cache.appendChild(row);
    }
    p.appendChild(cache);

    var upd = el('div', 'sp-card');
    abs(upd, 30, 689, 1360, 291);
    upd.appendChild(el('h3', null, 'Actualización'));
    var ver = el('div', 'sp-version', 'v4.34.4');
    upd.appendChild(ver);
    p.appendChild(upd);
    return p;
  }

  function buildAboutPanel() {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title plain', 'Sobre nosotros'));
    p.appendChild(abs(el('div', 'sp-hr soft'), 0, 165, 1498, 1));
    p.appendChild(el('div', 'sp-about-body',
      'Xuper TV se dedica a ofrecer a los usuarios una amplia variedad de recursos de alta calidad. ' +
      'Aquí encontrarás miles de películas, series, animes y canales en vivo, todo reunido en un solo lugar. ' +
      'Brindamos una experiencia estable, diversa y siempre actualizada, además de contenidos gratuitos para disfrutar.'));
    var mail = el('div', 'sp-about-mail');
    var ico = el('img');
    ico.src = 'assets/original/settings/vod_email_icon.png';
    ico.alt = '';
    mail.appendChild(ico);
    mail.appendChild(el('span', null, 'escuchamos-tv@outlook.com'));
    p.appendChild(mail);
    return p;
  }

  function buildPendingPanel(title, text) {
    var p = el('div', 'settings-panel');
    p.appendChild(el('div', 'sp-title', title));
    p.appendChild(el('div', 'sp-hr'));
    p.appendChild(el('div', 'sp-pending', text));
    return p;
  }

  /* ================================================================ PLAYER */
  /* The player controller hides itself after a few seconds without input.
     The constant is not exposed in the decoded resources; 5000 ms is used
     until it can be measured on the running app (WSA/Android TV). */
  var INFO_HIDE_MS = 5000;
  var osdHideTimer = null;

  function formatTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }

  function durationToSeconds(value) {
    if (typeof value === 'number' && isFinite(value) && value > 0) { return value; }
    if (typeof value !== 'string') { return 0; }
    var parts = value.trim().split(':');
    if (!parts.length || parts.length > 3) { return 0; }
    var total = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = Number(parts[i]);
      if (!isFinite(n) || n < 0) { return 0; }
      total = total * 60 + n;
    }
    return total > 0 ? total : 0;
  }

  function updateVodProgress(current, duration) {
    if (!vodTimeCurrent || !vodTimeTotal || !vodSeekProgress) { return; }
    var knownDuration = durationToSeconds(duration) || durationToSeconds(state.playerItem && state.playerItem.duration);
    if (!knownDuration) {
      vodTimeTotal.textContent = '--:--:--';
      vodTimeCurrent.textContent = formatTime(current || 0);
      return;
    }
    duration = knownDuration;
    vodTimeCurrent.textContent = formatTime(current);
    vodTimeTotal.textContent = formatTime(duration);
    var pct = Math.min(100, Math.max(0, (current / duration) * 100));
    vodSeekProgress.style.width = pct + '%';
    if (vodSeekThumb) {
      vodSeekThumb.style.left = pct + '%';
    }
    if (playerVideo && playerVideo.buffered && playerVideo.buffered.length > 0) {
      try {
        var bufEnd = playerVideo.buffered.end(playerVideo.buffered.length - 1);
        var bufPct = Math.min(100, Math.max(0, (bufEnd / duration) * 100));
        if (vodSeekBuffered) { vodSeekBuffered.style.width = bufPct + '%'; }
      } catch (eB) { /* ignore */ }
    }
  }

  function showOsdIcon(type) {
    if (!playerOsdIcon) { playerOsdIcon = $('player-osd-icon'); }
    if (!playerOsdIcon) { return; }
    if (osdHideTimer) { clearTimeout(osdHideTimer); osdHideTimer = null; }
    if (type === 'pause') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_pause.png)';
      playerOsdIcon.classList.add('is-active');
    } else if (type === 'forward') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_forward.png)';
      playerOsdIcon.classList.add('is-active');
      osdHideTimer = setTimeout(function () {
        playerOsdIcon.classList.remove('is-active');
      }, 900);
    } else if (type === 'backward') {
      playerOsdIcon.style.backgroundImage = 'url(assets/original/common/icon_status_backward.png)';
      playerOsdIcon.classList.add('is-active');
      osdHideTimer = setTimeout(function () {
        playerOsdIcon.classList.remove('is-active');
      }, 900);
    } else {
      playerOsdIcon.classList.remove('is-active');
    }
  }

  function playerSeek(delta) {
    if (!playerVideo) { return; }
    var dur = playerVideo.duration;
    if (isNaN(dur) || dur <= 0) {
      dur = 86400;
    }
    var cur = playerVideo.currentTime || 0;
    var target = Math.max(0, Math.min(dur, cur + delta));
    try {
      playerVideo.currentTime = target;
    } catch (eSk) { /* ignore */ }
    updateVodProgress(target, playerVideo.duration);
    showInfobar();
    showOsdIcon(delta > 0 ? 'forward' : 'backward');
  }

  function togglePlayerPlayPause() {
    if (!playerVideo) { return; }
    if (playerVideo.paused) {
      try {
        var p = playerVideo.play();
        if (p && p.catch) { p.catch(function () {}); }
      } catch (eP) {}
      showOsdIcon('none');
      showInfobar();
    } else {
      try {
        playerVideo.pause();
      } catch (eP2) {}
      showOsdIcon('pause');
      showInfobar();
    }
  }

  function scheduleInfoHide() {
    if (state.infoTimer) { clearTimeout(state.infoTimer); }
    state.infoTimer = setTimeout(function () {
      state.infoTimer = null;
      if (state.screen !== 'player' || state.channelsOpen) { return; }
      hideInfobar();
    }, INFO_HIDE_MS);
  }

  function showInfobar() {
    state.infobar = true;
    if (state.playerMode === 'vod') {
      if (playerVodInfo) { playerVodInfo.classList.add('is-active'); }
      if (playerInfo) { playerInfo.classList.remove('is-active'); }
    } else {
      if (playerInfo) { playerInfo.classList.add('is-active'); }
      if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
    }
    scheduleInfoHide();
  }

  function hideInfobar() {
    if (state.infoTimer) { clearTimeout(state.infoTimer); state.infoTimer = null; }
    state.infobar = false;
    if (playerInfo) { playerInfo.classList.remove('is-active'); }
    if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
  }

  function showVodInfobar() {
    showInfobar();
  }

  function hideVodInfobar() {
    hideInfobar();
  }

  /* --- PlaySettingView (Bottom Drawer) & SelectSubTitleAndAudioDialog Controller --- */
  var playSettingView = null;
  var dialogPlaySettings = null;
  var psvSecSelection = null;
  var psvSeasonsRow = null;
  var psvGroupsRow = null;
  var psvEpisodesRow = null;
  var psvBtnConfig = null;
  var psvBtnP1 = null;
  var psvBtnP2 = null;
  var psvAspectRow = null;

  var dpsAudioOptions = null;
  var dpsSubSwitch = null;
  var dpsRowLang = null;
  var dpsRowSize = null;
  var dpsRowStyle = null;
  var dpsLangOptions = null;
  var dpsSizeOptions = null;
  var dpsStyleOptions = null;
  var dpsBtnExit = null;
  var playerSubtitles = null;

  var playSettingViewOpen = false;
  var dialogPlaySettingsOpen = false;
  var playSettingTimer = null;
  var currentEpGroupIndex = 0;
  var vodCurrentAudioTrack = 0;
  var vodCurrentSubtitle = null;
  var vodSubActive = false;
  var vodSubSize = 'normal';
  var vodSubStyle = 'white';
  var playerCurrentAspect = 'contain';
  var activeSubtitleCues = [];

  function parseTimestamp(s) {
    if (!s) return 0;
    var p = s.replace(',', '.').split(':');
    if (p.length === 3) {
      return (parseFloat(p[0]) * 3600) + (parseFloat(p[1]) * 60) + parseFloat(p[2]);
    }
    return 0;
  }

  function parseSRT(data) {
    var cues = [];
    if (!data) return cues;
    var blocks = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].trim().split('\n');
      if (lines.length >= 2) {
        var timeLine = (lines[0].indexOf('-->') !== -1) ? lines[0] : lines[1];
        var textLines = (lines[0].indexOf('-->') !== -1) ? lines.slice(1) : lines.slice(2);
        if (timeLine && timeLine.indexOf('-->') !== -1) {
          var m = timeLine.split('-->');
          var start = parseTimestamp(m[0].trim());
          var end = parseTimestamp(m[1].trim());
          var txt = textLines.join('<br>').replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '').trim();
          if (txt) cues.push({ start: start, end: end, text: txt });
        }
      }
    }
    return cues;
  }

  function loadSubtitleTrack(sub) {
    if (!sub || !sub.url) {
      activeSubtitleCues = [];
      if (playerSubtitles) playerSubtitles.innerHTML = '';
      return;
    }
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', sub.url, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          activeSubtitleCues = parseSRT(xhr.responseText);
        }
      };
      xhr.send();
    } catch (eSub) { /* ignore */ }
  }

  function applySubtitleStyles() {
    if (!playerSubtitles) return;
    playerSubtitles.classList.remove('size-small', 'size-normal', 'size-big');
    playerSubtitles.classList.add('size-' + vodSubSize);
    playerSubtitles.classList.remove('color-white', 'color-yellow', 'color-black');
    playerSubtitles.classList.add('color-' + vodSubStyle);
  }

  function updateSubtitleDisplay(currentSec) {
    if (!playerSubtitles) return;
    if (!vodSubActive || !activeSubtitleCues || !activeSubtitleCues.length) {
      if (playerSubtitles.innerHTML !== '') playerSubtitles.innerHTML = '';
      return;
    }
    var cue = null;
    for (var i = 0; i < activeSubtitleCues.length; i++) {
      if (currentSec >= activeSubtitleCues[i].start && currentSec <= activeSubtitleCues[i].end) {
        cue = activeSubtitleCues[i];
        break;
      }
    }
    if (cue) {
      var html = '<span class="player-subtitles-text">' + cue.text + '</span>';
      if (playerSubtitles.innerHTML !== html) {
        playerSubtitles.innerHTML = html;
      }
    } else {
      if (playerSubtitles.innerHTML !== '') {
        playerSubtitles.innerHTML = '';
      }
    }
  }

  function schedulePlaySettingHide() {
    if (playSettingTimer) { clearTimeout(playSettingTimer); }
    playSettingTimer = setTimeout(function () {
      closePlaySettingView();
    }, 8000);
  }

  function openPlaySettingView() {
    if (!playSettingView) { buildPlayer(); }
    if (!playSettingView) return;
    playSettingViewOpen = true;
    dialogPlaySettingsOpen = false;
    hideInfobar();

    renderPlaySettingView();
    playSettingView.classList.add('is-active');
    if (playerSubtitles) { playerSubtitles.classList.add('shift-up'); }

    schedulePlaySettingHide();

    /* Initial focus: episode if series, else Configuración button */
    var item = state.playerItem;
    if (isSeriesItem(item) && psvEpisodesRow) {
      var curEpBtn = psvEpisodesRow.querySelector('.is-current') || psvEpisodesRow.querySelector('.focusable');
      if (curEpBtn) { setFocus(curEpBtn); return; }
    }
    if (psvBtnConfig) { setFocus(psvBtnConfig); }
  }

  function closePlaySettingView() {
    if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
    playSettingViewOpen = false;
    if (playSettingView) { playSettingView.classList.remove('is-active'); }
    if (playerSubtitles) { playerSubtitles.classList.remove('shift-up'); }
    if (state.screen === 'player' && !dialogPlaySettingsOpen) {
      setFocus(playerStage);
    }
  }

  function renderPlaySettingView() {
    renderPlaySettingSelection();
    renderPlaySettingPlayerOptions();
    renderPlaySettingAspectOptions();
  }

  function renderPlaySettingSelection() {
    if (!psvSecSelection) return;
    var item = state.playerItem;
    if (!item || !isSeriesItem(item)) {
      psvSecSelection.style.display = 'none';
      return;
    }
    psvSecSelection.style.display = 'block';

    if ((!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
      loadVodDetail(item, function () {
        renderPlaySettingSelection();
      });
      return;
    }

    clear(psvSeasonsRow);
    clear(psvGroupsRow);
    clear(psvEpisodesRow);

    var episodes = item.episodes || [];
    var seasons = item.seasons || [];

    if (seasons.length > 1) {
      psvSeasonsRow.style.display = 'flex';
      for (var s = 0; s < seasons.length; s++) {
        (function (seasonIdx) {
          var sea = seasons[seasonIdx];
          var seaBtn = el('button', 'psv-season-btn focusable');
          seaBtn.textContent = 'Temporada ' + (sea.number || (seasonIdx + 1));
          if (state.detailSeason === seasonIdx) seaBtn.classList.add('is-selected');
          seaBtn._activate = function () {
            state.detailSeason = seasonIdx;
            if (sea.id && sea.id !== item.id) {
              item._portal = true;
              item.id = sea.id;
              item._detailsLoaded = false;
              loadVodDetail(item, function () {
                renderPlaySettingSelection();
              });
            } else {
              renderPlaySettingSelection();
            }
          };
          psvSeasonsRow.appendChild(seaBtn);
        })(s);
      }
    } else {
      psvSeasonsRow.style.display = 'none';
    }

    var groupSize = 20;
    var totalGroups = Math.ceil(episodes.length / groupSize);
    if (totalGroups > 1) {
      psvGroupsRow.style.display = 'flex';
      for (var g = 0; g < totalGroups; g++) {
        (function (grpIdx) {
          var grpBtn = el('button', 'psv-group-btn focusable');
          var startNum = (grpIdx * groupSize) + 1;
          var endNum = Math.min(episodes.length, (grpIdx + 1) * groupSize);
          grpBtn.textContent = startNum + '-' + endNum;
          if (currentEpGroupIndex === grpIdx) grpBtn.classList.add('is-selected');
          grpBtn._activate = function () {
            currentEpGroupIndex = grpIdx;
            renderPlaySettingEpisodes(episodes, grpIdx, groupSize);
            schedulePlaySettingHide();
          };
          psvGroupsRow.appendChild(grpBtn);
        })(g);
      }
    } else {
      psvGroupsRow.style.display = 'none';
    }

    renderPlaySettingEpisodes(episodes, currentEpGroupIndex, groupSize);
  }

  function renderPlaySettingEpisodes(episodes, grpIdx, groupSize) {
    if (!psvEpisodesRow) return;
    clear(psvEpisodesRow);
    var start = grpIdx * groupSize;
    var end = Math.min(episodes.length, start + groupSize);
    var item = state.playerItem;

    for (var i = start; i < end; i++) {
      (function (ep, idx) {
        var epBtn = el('button', 'psv-ep-btn focusable');
        var epNum = ep.number || ep.seriesNumber || (idx + 1);
        epBtn.textContent = epNum;
        if (state.playerEpisode && (state.playerEpisode.id === ep.id || state.playerEpisode.number === ep.number)) {
          epBtn.classList.add('is-current');
        }
        epBtn._activate = function () {
          closePlaySettingView();
          startPlayerVideo(item, ep);
        };
        psvEpisodesRow.appendChild(epBtn);
      })(episodes[i], i);
    }
  }

  function renderPlaySettingPlayerOptions() {
    /* 'normal' is the default direct path; only 'relay'/'smooth' means FFmpeg. */
    var isRelay = (state.streamMode === 'relay' || state.streamMode === 'smooth');
    if (psvBtnP1) {
      psvBtnP1.classList.toggle('is-selected', isRelay);
      var chk1 = psvBtnP1.querySelector('.psv-check');
      if (chk1) chk1.style.display = isRelay ? 'inline' : 'none';
    }
    if (psvBtnP2) {
      psvBtnP2.classList.toggle('is-selected', !isRelay);
      var chk2 = psvBtnP2.querySelector('.psv-check');
      if (chk2) chk2.style.display = !isRelay ? 'inline' : 'none';
    }
  }

  function renderPlaySettingAspectOptions() {
    if (!psvAspectRow) return;
    var btns = psvAspectRow.querySelectorAll('.psv-btn');
    for (var i = 0; i < btns.length; i++) {
      var asp = btns[i].getAttribute('data-aspect');
      var isSel = (asp === playerCurrentAspect);
      btns[i].classList.toggle('is-selected', isSel);
      var chk = btns[i].querySelector('.psv-check');
      if (chk) chk.style.display = isSel ? 'inline' : 'none';
    }
  }

  function setPlayerAspect(aspect) {
    playerCurrentAspect = aspect || 'contain';
    if (playerVideo) {
      playerVideo.classList.remove('aspect-cover', 'aspect-contain', 'aspect-16-9', 'aspect-4-3');
      playerVideo.classList.add('aspect-' + playerCurrentAspect);
    }
    renderPlaySettingAspectOptions();
  }

  function openPlaySettingsDialog() {
    if (!dialogPlaySettings) { buildPlayer(); }
    if (!dialogPlaySettings) return;
    if (playSettingTimer) { clearTimeout(playSettingTimer); playSettingTimer = null; }
    dialogPlaySettingsOpen = true;

    renderDialogAudio();
    renderDialogSubtitle();
    applySubtitleStyles();

    dialogPlaySettings.classList.add('is-active');

    /* Focus first audio pill or switch */
    var firstFocus = (dpsAudioOptions && dpsAudioOptions.querySelector('.focusable')) || dpsSubSwitch || dpsBtnExit;
    if (firstFocus) { setFocus(firstFocus); }
  }

  function closePlaySettingsDialog() {
    dialogPlaySettingsOpen = false;
    if (dialogPlaySettings) { dialogPlaySettings.classList.remove('is-active'); }
    if (playSettingViewOpen) {
      if (psvBtnConfig) { setFocus(psvBtnConfig); }
      schedulePlaySettingHide();
    } else {
      if (state.screen === 'player') { setFocus(playerStage); }
    }
  }

  function renderDialogAudio() {
    if (!dpsAudioOptions) return;
    clear(dpsAudioOptions);
    var item = state.playerItem;
    var tracks = [];
    var raw = (item && item.streamAudioInfo) || '';
    if (raw) {
      var parts = raw.split(/[,\/]/);
      for (var i = 0; i < parts.length; i++) {
        var code = parts[i].trim();
        tracks.push({ index: i, label: formatAudioLang(code) });
      }
    }
    if (!tracks.length) {
      tracks.push({ index: 0, label: 'Español' });
      if (item && item.moreAudio) {
        tracks.push({ index: 1, label: 'Inglés' });
      }
    }
    for (var t = 0; t < tracks.length; t++) {
      (function (track) {
        var btn = el('button', 'dps-btn focusable');
        btn.textContent = track.label;
        if (vodCurrentAudioTrack === track.index) {
          btn.classList.add('is-selected');
        }
        btn._activate = function () {
          switchAudioTrack(track.index);
          renderDialogAudio();
        };
        dpsAudioOptions.appendChild(btn);
      })(tracks[t]);
    }
  }

  function renderDialogSubtitle() {
    if (dpsSubSwitch) {
      dpsSubSwitch.classList.toggle('is-on', vodSubActive);
      var dotText = dpsSubSwitch.querySelector('.dps-switch-text');
      if (dotText) dotText.textContent = vodSubActive ? 'ON' : 'OFF';
    }

    if (dpsRowLang) dpsRowLang.classList.toggle('is-visible', vodSubActive);
    if (dpsRowSize) dpsRowSize.classList.toggle('is-visible', vodSubActive);
    if (dpsRowStyle) dpsRowStyle.classList.toggle('is-visible', vodSubActive);

    if (!vodSubActive) return;

    /* Render languages */
    if (dpsLangOptions) {
      clear(dpsLangOptions);
      var item = state.playerItem;
      var list = (item && item.subtitles) || [];
      if (!list.length) {
        list = [{ url: '', lang: 'Español' }];
      }
      for (var s = 0; s < list.length; s++) {
        (function (sub) {
          var btn = el('button', 'dps-btn focusable');
          btn.textContent = formatAudioLang(sub.lang || sub.language || 'Sub');
          if (vodCurrentSubtitle && (vodCurrentSubtitle.url === sub.url || (!sub.url && s === 0))) {
            btn.classList.add('is-selected');
          }
          btn._activate = function () {
            vodCurrentSubtitle = sub;
            loadSubtitleTrack(sub);
            renderDialogSubtitle();
          };
          dpsLangOptions.appendChild(btn);
        })(list[s]);
      }
    }

    /* Size buttons */
    if (dpsSizeOptions) {
      var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
      for (var si = 0; si < sBtns.length; si++) {
        var sz = sBtns[si].getAttribute('data-size');
        sBtns[si].classList.toggle('is-selected', sz === vodSubSize);
      }
    }

    /* Style buttons */
    if (dpsStyleOptions) {
      var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
      for (var sti = 0; sti < stBtns.length; sti++) {
        var st = stBtns[sti].getAttribute('data-style');
        stBtns[sti].classList.toggle('is-selected', st === vodSubStyle);
      }
    }
  }

  function formatAudioLang(code) {
    var c = (code || '').toLowerCase().trim();
    if (/spa|esp|castellano|latino/.test(c)) return 'Español';
    if (/eng|ing|en/.test(c)) return 'Inglés';
    if (/jpn|jap|ja/.test(c)) return 'Japonés';
    if (/kor|cor|ko/.test(c)) return 'Coreano';
    if (/por|pt/.test(c)) return 'Portugués';
    if (/fra|fr|franc/.test(c)) return 'Francés';
    if (/ita|it/.test(c)) return 'Italiano';
    if (/deu|ger|de/.test(c)) return 'Alemán';
    if (/chi|zho|zh/.test(c)) return 'Chino';
    return c ? (c.charAt(0).toUpperCase() + c.slice(1)) : 'Pista';
  }

  function switchAudioTrack(trackIndex) {
    vodCurrentAudioTrack = trackIndex;
    if (relayBaseUrl) {
      var curSec = relayStartOffset + (playerVideo ? (playerVideo.currentTime || 0) : 0);
      var newUrl = relayBaseUrl + '?start=' + Math.floor(curSec) + '&a=' + trackIndex;
      playUrl(newUrl);
    }
  }

  function restartCurrentPlayback() {
    if (!playerVideo) return;
    var curSec = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : (playerVideo.currentTime || 0);
    var item = state.playerItem;
    stopPlayerVideo();
    setPlayerStatus('Cambiando reproductor…');
    resolvePlayerStream(item, function (url) {
      if (url) {
        if (relayBaseUrl && curSec > 0) {
          playUrl(relayBaseUrl + '?start=' + Math.floor(curSec) + (vodCurrentAudioTrack ? '&a=' + vodCurrentAudioTrack : ''));
        } else {
          playUrl(url);
          if (curSec > 0) {
            try { playerVideo.currentTime = curSec; } catch (e) {}
          }
        }
      } else if (!state.streamError) {
        setPlayerStatus('Sin fuente de reproducción');
      }
    });
  }

  function buildPlayer() {
    playerStage = $('player-stage');
    playerInfo = $('player-infobar');
    playerVodInfo = $('player-vod-infobar');
    playerChannels = $('player-channels');
    playerVideo = $('player-video');
    playerStatus = $('player-status');
    playerOsdIcon = $('player-osd-icon');
    playerFrame = playerStage ? playerStage.querySelector('.player-frame') : null;

    vodInfobarPoster = $('vod-infobar-poster');
    vodInfobarTitle = $('vod-infobar-title');
    vodTimeCurrent = $('vod-time-current');
    vodTimeTotal = $('vod-time-total');
    vodSeekProgress = $('vod-seek-progress');
    vodSeekBuffered = $('vod-seek-buffered');
    vodSeekThumb = $('vod-seek-thumb');

    /* PlaySettingView elements */
    playSettingView = $('player-playsetting-view');
    psvSecSelection = $('psv-sec-selection');
    psvSeasonsRow = $('psv-seasons-row');
    psvGroupsRow = $('psv-groups-row');
    psvEpisodesRow = $('psv-episodes-row');
    psvBtnConfig = $('psv-btn-config');
    psvBtnP1 = $('psv-btn-p1');
    psvBtnP2 = $('psv-btn-p2');
    psvAspectRow = $('psv-aspect-row');

    if (psvBtnConfig) {
      psvBtnConfig._activate = function () {
        openPlaySettingsDialog();
      };
    }
    if (psvBtnP1) {
      psvBtnP1._activate = function () {
        if (state.streamMode !== 'relay') {
          state.streamMode = 'relay';
          renderPlaySettingPlayerOptions();
          restartCurrentPlayback();
        }
      };
    }
    if (psvBtnP2) {
      psvBtnP2._activate = function () {
        if (state.streamMode !== 'direct') {
          state.streamMode = 'direct';
          renderPlaySettingPlayerOptions();
          restartCurrentPlayback();
        }
      };
    }
    if (psvAspectRow) {
      var aBtns = psvAspectRow.querySelectorAll('.psv-btn');
      for (var ai = 0; ai < aBtns.length; ai++) {
        (function (b) {
          b._activate = function () {
            var asp = b.getAttribute('data-aspect');
            setPlayerAspect(asp);
          };
        })(aBtns[ai]);
      }
    }

    /* Modal Dialog elements */
    dialogPlaySettings = $('dialog-playsettings');
    dpsAudioOptions = $('dps-audio-options');
    dpsSubSwitch = $('dps-sub-switch');
    dpsRowLang = $('dps-row-lang');
    dpsRowSize = $('dps-row-size');
    dpsRowStyle = $('dps-row-style');
    dpsLangOptions = $('dps-lang-options');
    dpsSizeOptions = $('dps-size-options');
    dpsStyleOptions = $('dps-style-options');
    dpsBtnExit = $('dps-btn-exit');
    playerSubtitles = $('player-subtitles');

    if (dpsSubSwitch) {
      dpsSubSwitch._activate = function () {
        vodSubActive = !vodSubActive;
        if (!vodSubActive) {
          loadSubtitleTrack(null);
        } else {
          var subs = (state.playerItem && state.playerItem.subtitles) || [];
          if (!vodCurrentSubtitle && subs.length) {
            vodCurrentSubtitle = subs[0];
          }
          if (vodCurrentSubtitle) {
            loadSubtitleTrack(vodCurrentSubtitle);
          }
        }
        renderDialogSubtitle();
      };
    }

    if (dpsSizeOptions) {
      var sBtns = dpsSizeOptions.querySelectorAll('.dps-btn');
      for (var si = 0; si < sBtns.length; si++) {
        (function (b) {
          b._activate = function () {
            vodSubSize = b.getAttribute('data-size') || 'normal';
            applySubtitleStyles();
            renderDialogSubtitle();
          };
        })(sBtns[si]);
      }
    }

    if (dpsStyleOptions) {
      var stBtns = dpsStyleOptions.querySelectorAll('.dps-btn');
      for (var sti = 0; sti < stBtns.length; sti++) {
        (function (b) {
          b._activate = function () {
            vodSubStyle = b.getAttribute('data-style') || 'white';
            applySubtitleStyles();
            renderDialogSubtitle();
          };
        })(stBtns[sti]);
      }
    }

    if (dpsBtnExit) {
      dpsBtnExit._activate = function () {
        closePlaySettingsDialog();
      };
    }

    applySubtitleStyles();
    setPlayerAspect(playerCurrentAspect);

    clear(playerInfo); clear(playerChannels);

    playerStage.classList.add('focusable');
    playerStage._onMove = function (dir) {
      if (state.playerMode === 'vod') {
        if (dir === 'left') { playerSeek(-10); return true; }
        if (dir === 'right') { playerSeek(10); return true; }
        if (dir === 'down') {
          openPlaySettingView();
          return true;
        }
        if (dir === 'up') {
          if (state.infobar) { hideInfobar(); } else { showInfobar(); }
          return true;
        }
        return false;
      }
      if (dir === 'left') { openChannelPanel(); return true; }
      if (dir === 'right') { closeChannelPanel(); return true; }
      if (dir === 'up') { setChannel(state.channel - 1); return true; }
      if (dir === 'down') { setChannel(state.channel + 1); return true; }
      return false;
    };
    playerStage._activate = function () {
      if (state.playerMode === 'vod') {
        togglePlayerPlayPause();
        return;
      }
      if (state.infobar) { hideInfobar(); }
      else { showInfobar(); }
    };

    /* --- infobar (layout_live_infobar, 160dp = 240px) --- */
    playerInfo.appendChild(el('div', 'pi-logo'));
    playerInfo.appendChild(el('div', 'pi-index'));
    var nameRow = el('div', 'pi-namerow');
    var nm = el('div', 'pi-name');
    nameRow.appendChild(nm);
    var uhd = el('div', 'pi-uhd');
    uhd.style.left = '20px';
    nameRow.appendChild(uhd);
    playerInfo.appendChild(nameRow);
    playerInfo.appendChild(el('div', 'pi-date'));
    playerInfo.appendChild(el('div', 'pi-range'));
    playerInfo.appendChild(el('div', 'pi-now'));
    playerInfo.appendChild(el('div', 'pi-next'));
    var seek = el('div', 'pi-seek');
    seek.appendChild(el('div', 'bar'));
    playerInfo.appendChild(seek);
    playerInfo.appendChild(el('div', 'pi-menu', 'info'));
    playerInfo.appendChild(el('div', 'pi-quality', 'HD'));
    playerInfo.appendChild(el('div', 'pi-scale', 'Normal'));
    playerInfo.appendChild(el('div', 'pi-func', 'Selecion de función'));

    var actions = el('div', 'pi-actions');
    var actDefs = [
      { label: 'Pip', right: 446, w: 67, hidden: true },
      { label: 'HD', right: 389, w: 67 },
      { label: 'Anterior', right: 333, w: 67 },
      { label: 'Formato', right: 249, w: 120 },
      { label: 'Favorito', right: 219, w: 67 },
      { label: 'Reproductor 1', right: 151, w: 90 },
      { label: 'Bloquear', right: 107, w: 67 },
      { label: 'Feedback', right: 50, w: 67 }
    ];
    for (var i = 0; i < actDefs.length; i++) {
      var d = actDefs[i];
      if (d.hidden) { continue; }
      var b = el('div', 'pi-act focusable', d.label);
      b.style.width = (d.w * 1.5) + 'px';
      b.style.left = (1920 - d.right * 1.5 - d.w * 1.5) + 'px';
      b._kind = d.label;
      b._activate = (function (label) {
        return function () {
          if (label === 'Anterior') { setChannel(state.channel - 1); }
          else if (label === 'Formato') {
            var sc = playerInfo.querySelector('.pi-scale');
            sc.textContent = sc.textContent === 'Normal' ? '16:9' : (sc.textContent === '16:9' ? '4:3' : 'Normal');
            layoutInfoTexts();
          } else if (label === 'Favorito') {
            var ch = CHANNELS[state.channel];
            ch.fav = !ch.fav;
          }
        };
      })(d.label);
      actions.appendChild(b);
    }
    playerInfo.appendChild(actions);

    /* --- channel panel (frag_live_channel) --- */
    playerChannels.appendChild(el('div', 'pc-title', 'Lista de canales'));
    playerChannels.appendChild(el('div', 'pc-div'));
    var list = el('div', 'pc-list scrollable');
    playerChannels.appendChild(list);
    playerChannelRows = [];
    for (var c = 0; c < CHANNELS.length; c++) {
      var row = el('div', 'pc-row focusable');
      row._channel = c;
      var ic = el('div', 'ic');
      var num = el('div', 'num', pad2(CHANNELS[c].index));
      var nm2 = el('div', 'nm', CHANNELS[c].name);
      var epg = el('div', 'epg', CHANNELS[c].now);
      row.appendChild(ic); row.appendChild(num); row.appendChild(nm2); row.appendChild(epg);
      row._activate = (function (idx) {
        return function () {
          setChannel(idx);
          closeChannelPanel();
          setFocus(playerStage);
        };
      })(c);
      row._onMove = function (dir) {
        if (dir === 'right') { setFocus(playerStage); return true; }
        return false;
      };
      list.appendChild(row);
      playerChannelRows.push(row);
    }
    var menu = el('div', 'pc-menu');
    menu.appendChild(el('div', 'ic'));
    menu.appendChild(el('div', 'l1', 'Presione largamente [OK] o [Menu]'));
    menu.appendChild(el('div', 'l2', '(Filtrar, Fav, Anterior, Bloquear)'));
    playerChannels.appendChild(menu);
  }

  var lastProxyOrigin = '';
  var lastPlayingUrl = '';
  /* Generation counter: incremented every time we start a new stream.
     Async resolve callbacks check this before calling playUrl() so that
     stale responses from previously-selected items are silently dropped. */
  var resolveSeq = 0;
  var relayBaseUrl = '';
  var relayStartOffset = 0;

  /* Accumulated seek delta + timer for debouncing rapid seek keypresses.
     webOS Starfish fires a full setPreload/dispatchBufferingStart cycle
     for every currentTime assignment, so we batch rapid presses. */
  var seekPending = 0;
  var seekTimer = null;
  /* Fragmented-MP4 seeks restart the native video pipeline on webOS 4.  Do
     not start a second one until that pipeline has acknowledged the first. */
  var relaySeekInFlight = false;
  var relaySeekWatchdog = null;
  function releaseRelaySeek() {
    relaySeekInFlight = false;
    if (relaySeekWatchdog) { clearTimeout(relaySeekWatchdog); relaySeekWatchdog = null; }
  }
  function flushSeek() {
    seekTimer = null;
    if (!playerVideo || !seekPending) { seekPending = 0; return; }
    if (relayBaseUrl) {
      if (relaySeekInFlight) { seekPending = 0; return; }
      relaySeekInFlight = true;
      var curSec = relayStartOffset + (playerVideo.currentTime || 0);
      var target = Math.max(0, curSec + seekPending);
      seekPending = 0;
      var totalDur = (state.playerItem && state.playerItem.duration) || playerVideo.duration || 0;
      if (totalDur > 0 && target > totalDur - 2) { target = Math.max(0, totalDur - 2); }
      relayStartOffset = Math.floor(target);
      var seekUrl = relayBaseUrl + '?start=' + relayStartOffset;
      /* A failed upstream request must not leave controls locked forever. */
      relaySeekWatchdog = setTimeout(releaseRelaySeek, 12000);
      playUrl(seekUrl);
      return;
    }
    var t = (playerVideo.currentTime || 0) + seekPending;
    seekPending = 0;
    var dur = playerVideo.duration || 0;
    if (t < 0) { t = 0; }
    if (dur > 0 && t > dur - 1) { t = dur - 1; }
    try { playerVideo.currentTime = t; } catch (eSeek) { /* ignore */ }
  }
  function playerSeek(delta) {
    if (!playerVideo) { return; }
    seekPending += delta;
    if (seekTimer) { clearTimeout(seekTimer); }
    seekTimer = setTimeout(flushSeek, 800);
    /* OSD feedback while seeking */
    showOsdIcon(delta > 0 ? 'fwd' : 'rew');
    setTimeout(function () { showOsdIcon('none'); }, 600);
  }

  function stopPlayerVideo() {
    state.streamError = '';
    setPlayerStatus('');
    showOsdIcon('none');
    closePlaySettingsDialog();
    closePlaySettingView();
    vodSubActive = false;
    activeSubtitleCues = [];
    vodCurrentSubtitle = null;
    if (playerSubtitles) { playerSubtitles.innerHTML = ''; }
    /* Cancel any pending seek */
    if (seekTimer) { clearTimeout(seekTimer); seekTimer = null; seekPending = 0; }
    releaseRelaySeek();
    relayBaseUrl = '';
    relayStartOffset = 0;
    /* Increment generation so any in-flight resolve() callback is ignored */
    resolveSeq++;
    var proxyToAbort = lastProxyOrigin;
    if (!proxyToAbort && lastPlayingUrl && lastPlayingUrl.indexOf('127.0.0.1') !== -1) {
      var m = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(lastPlayingUrl);
      if (m) { proxyToAbort = m[1]; }
    }
    if (proxyToAbort) {
      try {
        var abortXhr = new XMLHttpRequest();
        abortXhr.open('GET', proxyToAbort + '/media/abort', true);
        abortXhr.send();
      } catch (eAbort) { /* ignore */ }
    }
    try {
      portalServiceCall('abortMedia', {}, function () {});
    } catch (eSvc) { /* ignore */ }
    lastPlayingUrl = '';
    lastProxyOrigin = '';
    if (!playerVideo) { return; }
    try { playerVideo.pause(); } catch (e) { /* ignore */ }
    playerVideo.removeAttribute('src');
    while (playerVideo.firstChild) {
      playerVideo.removeChild(playerVideo.firstChild);
    }
    /* NOTE: do NOT call playerVideo.load() here.
       A bare load() with no <source> briefly creates a WebMediaPlayerUMS
       pipeline in Starfish (AID=N) that gets destroyed milliseconds later
       when the real load() arrives, wasting one ACB slot and ~70ms. */
    playerVideo.classList.remove('is-active');
    if (playerFrame) { playerFrame.style.display = 'block'; }
  }

  function setPlayerStatus(text) {
    if (!playerStatus) { playerStatus = $('player-status'); }
    if (!playerStatus) { return; }
    if (text) {
      playerStatus.textContent = text;
      playerStatus.classList.add('is-active');
    } else {
      playerStatus.textContent = '';
      playerStatus.classList.remove('is-active');
    }
  }

  function playUrl(url) {
    if (!playerVideo || !url) { return; }
    stopPlayerVideo();
    lastPlayingUrl = url;
    var mOrigin = /^(http:\/\/127\.0\.0\.1:\d+)/.exec(url);
    if (mOrigin) { lastProxyOrigin = mOrigin[1]; }
    if (url.indexOf(':8787/s/') !== -1) {
      relayBaseUrl = url.split('?')[0];
      var mStart = /[?&]start=(\d+)/.exec(url);
      relayStartOffset = mStart ? parseInt(mStart[1], 10) : 0;
    } else {
      relayBaseUrl = '';
      relayStartOffset = 0;
    }
    setPlayerStatus('Conectando con el vídeo…');
    state.streamError = '';

    /* The markup defaults to auto too, but set it again because Starfish can
       retain the previous resource's preload mode after source replacement. */
    try { playerVideo.preload = 'auto'; } catch (ePreload) { /* ignore */ }

    playerVideo.onerror = function () {
      releaseRelaySeek();
      var code = playerVideo.error && playerVideo.error.code;
      state.streamError = 'No se pudo abrir el stream (código ' + (code || 'error') + ')';
      playerVideo.classList.remove('is-active');
      if (playerFrame) { playerFrame.style.display = 'block'; }
      setPlayerStatus(state.streamError);
    };
    function clearStatus() {
      setPlayerStatus('');
    }
    playerVideo.onloadeddata = clearStatus;
    playerVideo.oncanplay = function () { releaseRelaySeek(); clearStatus(); };
    playerVideo.onloadedmetadata = function () {
      clearStatus();
      if (state.playerMode === 'vod') {
        var totalDur = (state.playerItem && state.playerItem.duration) || playerVideo.duration;
        updateVodProgress(relayStartOffset, totalDur);
      }
    };
    playerVideo.onplaying = clearStatus;
    playerVideo.ontimeupdate = function () {
      if (playerVideo.currentTime > 0) { clearStatus(); }
      if (state.playerMode === 'vod') {
        var cur = relayBaseUrl ? (relayStartOffset + (playerVideo.currentTime || 0)) : playerVideo.currentTime;
        var totalDur = (state.playerItem && state.playerItem.duration) || playerVideo.duration;
        updateVodProgress(cur, totalDur);
        updateSubtitleDisplay(cur);
      }
    };
    playerVideo.onpause = function () {
      if (state.playerMode === 'vod') {
        showOsdIcon('pause');
      }
    };
    playerVideo.onplay = function () {
      if (state.playerMode === 'vod') {
        showOsdIcon('none');
      }
    };
    playerVideo.onwaiting = function () {
      if (!state.streamError) { setPlayerStatus('Cargando vídeo…'); }
    };
    playerVideo.onstalled = function () {
      if (!state.streamError) { setPlayerStatus('Conectando…'); }
    };

    var rawMime = (state.playerItem && state.playerItem.streamMime) || '';
    var isHls = (url.indexOf('.m3u8') !== -1) || (rawMime.indexOf('mpegurl') !== -1) || !!(state.playerItem && state.playerItem.isHls);
    var mime = isHls ? 'application/vnd.apple.mpegurl' : ((url.indexOf('.mp4') !== -1 || rawMime.indexOf('mp4') !== -1) ? 'video/mp4' : 'video/mp2t');

    var options = {
      mediaTransportType: isHls ? 'HLS' : 'URI',
      option: {
        transmission: {
          playTime: { start: 0 }
        }
      }
    };
    var mediaOption = encodeURI(JSON.stringify(options));
    var typeStr = mime + ';mediaOption=' + mediaOption;

    while (playerVideo.firstChild) {
      playerVideo.removeChild(playerVideo.firstChild);
    }
    playerVideo.removeAttribute('src');
    try { playerVideo.mediaOption = options; } catch (eOpt) {}

    var srcNode = document.createElement('source');
    srcNode.src = url;
    srcNode.type = typeStr;
    playerVideo.appendChild(srcNode);

    playerVideo.classList.add('is-active');
    if (playerFrame) { playerFrame.style.display = 'none'; }
    try {
      playerVideo.load();
      var p = playerVideo.play();
      if (p && p.catch) {
        p.catch(function () {
          if (playerVideo.error) { return; }
          state.streamError = 'Pulsa OK para iniciar la reproducción';
          setPlayerStatus(state.streamError);
        });
      }
    } catch (e2) {
      state.streamError = 'Pulsa OK para iniciar la reproducción';
      setPlayerStatus(state.streamError);
    }
  }

  /* Portal titles need a license + CDN auth that <video> cannot send: the
     service resolves them and exposes a loopback proxy URL.
     We capture the current resolveSeq at call time; if it changes before
     the async response arrives (user navigated away), we discard the result. */
  function resolvePlayerStream(item, done) {
    var mySeq = resolveSeq;
    function resolveNow() {
      var params = { contentId: item.id };
      params.playbackMode = state.streamMode;
      if (isSeriesItem(item)) {
        var ep = state.playerEpisode;
        if (ep && ep.id) {
          params.contentId = ep.id;
          params.seriesContentId = item.id;
        } else {
          if (!item.episodes || !item.episodes.length) { return done(''); }
          state.playerEpisode = item.episodes[0];
          params.contentId = item.episodes[0].id;
          params.seriesContentId = item.id;
        }
      }
      portalServiceCall('resolve', params, function (error, payload) {
        /* Stale response: user already navigated to something else */
        if (mySeq !== resolveSeq) { return; }
        if (error || !payload || payload.returnValue === false) {
          state.streamError = 'No se pudo resolver el título' + (error ? ': ' + error : '');
          setPlayerStatus(state.streamError);
          return done('');
        }
        item.streamMime = payload.mime || '';
        item.streamCodec = payload.codec || '';
        item.duration = payload.duration || item.duration || 0;
        item.subtitles = payload.subtitles || [];
        item.streamAudioInfo = payload.audio || '';
        item.isHls = !!payload.isHls;
        /* Read-only local diagnostics for the webOS inspector.  Do not place
           the stream URL, licence or headers here. */
        try {
          window.__xuperStreamInfo = {
            selectedTrack: payload.selectedTrack || {},
            availableTracks: payload.availableTracks || []
          };
        } catch (eDiag) { /* ignore */ }
        done(payload.proxyPath || payload.url || '');
      });
    }
    if (isSeriesItem(item) && !state.playerEpisode && (!item.episodes || !item.episodes.length) && !item._detailsLoaded) {
      setPlayerStatus('Cargando capítulos…');
      loadVodDetail(item, function () {
        if (mySeq !== resolveSeq) { return; }
        resolveNow();
      });
      return;
    }
    resolveNow();
  }

  function startPlayerVideo(item, episode) {
    if (!playerVideo) { return; }
    if (episode) { state.playerEpisode = episode; }
    if (item) { state.playerItem = item; }
    stopPlayerVideo();
    var it = item || state.playerItem;
    if (!it) { return; }
    if (it._portal) {
      setPlayerStatus('Preparando la reproducción…');
      resolvePlayerStream(it, function (url) {
        if (url) { playUrl(url); }
        else if (!state.streamError) { setPlayerStatus('Sin fuente de reproducción'); }
      });
      return;
    }
    if (!it.streamUrl) { return; }
    playUrl(it.streamUrl);
  }

  function expandToFullscreen(item, episode) {
    if (!playerStage) { buildPlayer(); }
    state.playerMode = 'vod';
    if (item) { state.playerItem = item; }
    if (episode) { state.playerEpisode = episode; }
    state.playerReturn = { screen: 'detail', focus: state.focus };

    var scrPlayer = $('screen-player');
    var scrDetail = $('screen-detail');
    if (scrPlayer) {
      scrPlayer.classList.remove('is-mini');
      scrPlayer.classList.add('is-active');
    }
    if (scrDetail) {
      scrDetail.classList.remove('is-active');
    }
    state.screen = 'player';
    playerStage.classList.add('is-vod');
    updatePlayer();
    setFocus(playerStage);
    showVodInfobar();

    if (!playerVideo || !playerVideo.src || playerVideo.paused) {
      startPlayerVideo(state.playerItem, state.playerEpisode);
    }
  }

  function openPlayer(mode, item, episode) {
    if (mode === 'vod' && state.screen === 'detail') {
      expandToFullscreen(item, episode);
      return;
    }
    if (!playerStage) { buildPlayer(); }
    state.playerMode = mode;
    state.playerItem = item || null;
    state.playerEpisode = episode || null;
    state.playerReturn = { screen: state.screen, focus: state.focus };
    state.channelsOpen = false;
    playerInfo.classList.remove('is-active');
    playerChannels.classList.remove('is-active');
    playerStage.classList.toggle('is-vod', mode === 'vod');
    updatePlayer();
    showScreen('player');
    setFocus(playerStage);
    updatePlayer();                 /* re-measure now that the screen is visible */
    if (mode === 'vod') {
      showVodInfobar();
      startPlayerVideo(state.playerItem, state.playerEpisode);
    } else {
      showInfobar();
      stopPlayerVideo();
    }
  }

  function updatePlayerChannel() {
    if (!playerStage) { return; }
    updatePlayer();
  }

  function updatePlayer() {
    var live = state.playerMode === 'live';
    var ch = CHANNELS[state.channel];
    var idx = playerInfo.querySelector('.pi-index');
    var name = playerInfo.querySelector('.pi-name');
    var date = playerInfo.querySelector('.pi-date');
    var range = playerInfo.querySelector('.pi-range');
    var now = playerInfo.querySelector('.pi-now');
    var next = playerInfo.querySelector('.pi-next');
    var uhd = playerInfo.querySelector('.pi-uhd');
    var logo = playerInfo.querySelector('.pi-logo');

    if (live) {
      if (playerVodInfo) { playerVodInfo.classList.remove('is-active'); }
      if (playerInfo) { playerInfo.style.display = ''; }
      idx.style.display = 'block';
      idx.textContent = pad2(ch.index);
      name.textContent = ch.name;
      nameRowPosition();
      date.textContent = 'Hoy';
      range.textContent = ch.time;
      now.style.display = 'block';
      now.textContent = ch.now;
      next.style.display = 'block';
      next.textContent = 'Siguiente: ' + ch.next;
      uhd.style.display = ch.uhd ? 'block' : 'none';
      logo.style.display = 'block';
    } else {
      if (playerInfo) { playerInfo.classList.remove('is-active'); playerInfo.style.display = 'none'; }
      var item = state.playerItem || VOD[0];
      if (vodInfobarTitle) {
        if (isSeriesItem(item) && state.playerEpisode) {
          var epTitle = state.playerEpisode.title || state.playerEpisode.name;
          var epNum = state.playerEpisode.number || state.playerEpisode.seriesNumber;
          var epLabel = epTitle || (epNum ? ('Capítulo ' + epNum) : '');
          vodInfobarTitle.textContent = epLabel ? (item.title + ' - ' + epLabel) : item.title;
        } else {
          vodInfobarTitle.textContent = item.title;
        }
      }
      if (vodInfobarPoster) {
        vodInfobarPoster.src = item.poster || item.cover || 'assets/original/common/bg_placehoder_vertical.png';
      }
      updateVodProgress(playerVideo ? playerVideo.currentTime : 0, playerVideo ? playerVideo.duration : 0);
    }
    for (var i = 0; i < playerChannelRows.length; i++) {
      playerChannelRows[i].classList.toggle('is-current', playerChannelRows[i]._channel === state.channel);
    }
    layoutInfoTexts();
  }

  function nameRowPosition() {
    var row = playerInfo.querySelector('.pi-namerow');
    if (!row) { return; }
    var idx = playerInfo.querySelector('.pi-index');
    var nm = row.querySelector('.pi-name');
    var uhd = row.querySelector('.pi-uhd');
    var idxW = idx && idx.style.display !== 'none' ? idx.offsetWidth : 0;
    var base = idxW ? (idxW + 30) : 0;          /* layout_toRightOf index + 20dp */

    row.style.position = 'absolute';
    row.style.left = (367.5 + base) + 'px';
    row.style.top = '13.5px';
    row.style.height = '58px';
    row.style.display = 'block';

    nm.style.position = 'absolute';
    nm.style.left = '0px';
    nm.style.top = '8px';                       /* alignBottom with mTextChannelIndex */
    nm.style.height = '50px';
    nm.style.lineHeight = '50px';

    if (uhd) {
      uhd.style.left = (nm.offsetWidth + 30) + 'px';   /* 20dp */
      uhd.style.top = '18.5px';                        /* alignTop name + 7dp */
    }
  }

  function layoutInfoTexts() {
    var q = playerInfo.querySelector('.pi-quality');
    var s = playerInfo.querySelector('.pi-scale');
    var f = playerInfo.querySelector('.pi-func');
    if (!q || !s || !f) { return; }
    q.style.left = '517.5px';                   /* 345dp */
    s.style.left = (q.offsetLeft + q.offsetWidth + 30) + 'px';   /* 20dp */
    f.style.left = (s.offsetLeft + s.offsetWidth + 30) + 'px';   /* 20dp */
  }

  function openChannelPanel() {
    if (state.playerMode !== 'live') { return; }
    state.channelsOpen = true;
    playerChannels.classList.add('is-active');
    var row = playerChannelRows[state.channel];
    if (row) {
      setFocus(row);
      var list = row.parentNode;
      var top = state.channel * 111;
      if (top < list.scrollTop || top + 109.5 > list.scrollTop + list.clientHeight) {
        list.scrollTop = Math.max(0, top - 120);
      }
    }
  }

  function closeChannelPanel() {
    state.channelsOpen = false;
    playerChannels.classList.remove('is-active');
    if (state.screen === 'player') { setFocus(playerStage); }
  }

  function restorePlayerReturn() {
    hideInfobar();
    hideVodInfobar();
    var ret = state.playerReturn;
    if (ret && ret.screen === 'detail') {
      var scrPlayer = $('screen-player');
      var scrDetail = $('screen-detail');
      if (scrPlayer) {
        scrPlayer.classList.add('is-mini');
        scrPlayer.classList.add('is-active');
      }
      if (scrDetail) {
        scrDetail.classList.add('is-active');
      }
      state.screen = 'detail';
      if (ret.focus && isVisible(ret.focus)) {
        setFocus(ret.focus);
      } else {
        var firstBtn = detailButtons ? detailButtons.querySelector('.focusable') : null;
        if (firstBtn) { setFocus(firstBtn); }
      }
    } else {
      stopPlayerVideo();
      var scrP = $('screen-player');
      if (scrP) {
        scrP.classList.remove('is-mini');
        scrP.classList.remove('is-active');
      }
      if (ret && ret.screen === 'search') {
        showScreen('search');
        setFocus(ret.focus);
      } else {
        showScreen('home');
        selectTab(state.tab, false);
        if (ret && ret.focus && isVisible(ret.focus)) { setFocus(ret.focus); }
        else if (tabEls[state.tab]) { setFocus(tabEls[state.tab]); }
      }
    }
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    document.addEventListener('keydown', handleKey, false);
    document.addEventListener('keyup', function (e) {
      var code = e.keyCode || e.which;
      if (code === 461 || e.key === 'Back' || e.key === 'GoBack') {
        handleKey(e);
      }
    }, false);
    window.addEventListener('popstate', function () {
      back();
    }, false);
    document.addEventListener('click', function (e) {
      var f = closest(e.target, '.focusable');
      if (!f) { return; }
      setFocus(f, true);
      if (f._activate) { f._activate(); }
    });
    buildSearch();
    startWelcome();
    loadVodCatalog();
    startServiceKeepAlive();

    window.__xuper = {
      version: '4.34.4',
      state: state,
      vod: VOD,
      channels: CHANNELS,
      api: vodApiState,
      portal: portalState,
      service: portalServiceCall,
      refreshPortal: refreshPortalCatalog,
      reloadVod: loadVodCatalog,
      skipWelcome: finishWelcome,
      show: function (name) {
        if (name === 'home') { finishWelcome(); }
        else if (name === 'detail') { openDetail(VOD[0]); }
        else if (name === 'search') { openSearch(); }
        else if (name === 'settings') { openSettings(); }
        else if (name === 'player') { openPlayer('live'); }
        else { showScreen(name); }
      },
      selectTab: function (i) { finishWelcome(); selectTab(i, true); },
      openDetail: function (i) { openDetail(VOD[i] || VOD[0]); },
      openSearch: openSearch,
      openSettings: openSettings,
      openPlayer: function (mode, i) { openPlayer(mode || 'live', VOD[i] || null); },
      focus: function (sel) {
        var n = typeof sel === 'string' ? document.querySelector(sel) : sel;
        if (n) { setFocus(n); }
      },
      key: function (code) { handleKey({ keyCode: code, preventDefault: function () {} }); },
      search: function (q) { openSearch(); setSearchQuery(q); },
      settingsPanel: function (i) { openSettings(); showSettingsPanel(i, true); }
    };

    applyQuery();
  }

  /* Deep-link support for the visual comparison harness, e.g.
     index.html?screen=home&tab=2   index.html?screen=detail&vod=3
     index.html?screen=search&q=demo index.html?screen=settings&panel=1
     index.html?screen=player&ch=2&channels=1                            */
  function applyQuery() {
    var raw = String(location.search || '').replace(/^\?/, '');
    if (!raw) { return; }
    var map = {};
    var parts = raw.split('&');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      var kv = parts[i].split('=');
      map[decodeURIComponent(kv[0])] = decodeURIComponent(kv.slice(1).join('=') || '');
    }
    if (map.ch !== undefined) {
      var ch = parseInt(map.ch, 10) || 0;
      state.channel = Math.max(0, Math.min(CHANNELS.length - 1, ch));
    }
    var screen = map.screen || 'home';
    if (screen === 'welcome') { return; }

    finishWelcome();
    if (map.tab !== undefined) {
      selectTab(parseInt(map.tab, 10) || 0, true);
    } else {
      selectTab(0, false);
      setFocus(liveFocus);
    }

    if (screen === 'detail') {
      openDetail(VOD[parseInt(map.vod, 10) || 0]);
    } else if (screen === 'search') {
      openSearch();
      if (map.q) { setSearchQuery(map.q); }
    } else if (screen === 'settings') {
      openSettings();
      if (map.panel !== undefined) { showSettingsPanel(parseInt(map.panel, 10) || 0, true); }
    } else if (screen === 'player') {
      openPlayer(map.mode === 'vod' ? 'vod' : 'live', VOD[parseInt(map.vod, 10) || 0]);
      if (map.channels === '1') { openChannelPanel(); }
    }

    if (map.focus) {
      var n = document.querySelector(map.focus);
      if (n) { setFocus(n); }
    }
  }

  function purgeMemoryCache() {
    stopPlayerVideo();
    clearSearchState();
  }

  window.addEventListener('beforeunload', purgeMemoryCache);
  window.addEventListener('unload', purgeMemoryCache);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      purgeMemoryCache();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
