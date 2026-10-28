/*
 * XuperTV webOS service: portal catalog + playback resolver.
 *
 * Why a service: the Magis portal sends no Access-Control-Allow-Origin and
 * rejects OPTIONS, so a packaged web app cannot POST to it directly. Node
 * services are not bound by the page's CORS rules, so the encrypted protocol
 * runs here and the app receives plain JSON through Luna.
 */
'use strict';

var Service = require('webos-service');
var pkg = require('./package.json');
var magis = require('./magis');
var proxy = require('./proxy');
var relay = require('./ffmpeg-relay');

var service = new Service(pkg.name);

/* Intercept process.exit so idle timers in webos-service do not kill the proxy */
try {
  process.exit = function (code) {
    console.log('[xuper-service] blocked process.exit(' + code + ') to keep streaming alive');
  };
} catch (eExit) { /* ignore */ }

/* Prolong idleTimeout to 24h and create a persistent activity */
if (service.activityManager) {
  try {
    service.activityManager.idleTimeout = 86400;
    service.activityManager.create('keepAlive', function (act) {
      console.log('[xuper-service] persistent activity created');
    });
  } catch (eAct) {
    console.log('[xuper-service] activityManager init note: ' + (eAct && eAct.message));
  }
}

function fail(message, err, code) {
  message.respond({
    returnValue: false,
    errorText: (err && err.message) || err || 'error',
    errorCode: code || (err && err.portalCode) || 1
  });
}

function respond(message, err, payload) {
  if (err) { return fail(message, err); }
  var out = payload || {};
  out.returnValue = true;
  message.respond(out);
}

service.register('ping', function (message) {
  message.respond({
    returnValue: true,
    service: pkg.name,
    version: pkg.version,
    portalHosts: magis.constants.ROOT_CODES ? 'magis' : 'none',
    proxyPort: proxy.port(),
    relayAvailable: relay.available(),
    ffmpegPath: relay.path(),
    relayPort: relay.port()
  });
});

/* keepAlive subscription keeps the Luna bus connection alive so the service never terminates */
service.register('keepAlive', function (message) {
  message.respond({
    returnValue: true,
    subscribed: !!message.isSubscription
  });
});

/* heartbeat method for periodic pings */
service.register('heartbeat', function (message) {
  message.respond({
    returnValue: true,
    alive: true,
    proxyPort: proxy.port(),
    timestamp: Date.now()
  });
});

/* home({root}) -> { items:[...] } for one portal root */
service.register('home', function (message) {
  var root = (message.payload && message.payload.root) || 'movies';
  magis.home(root, function (err, data) { respond(message, err, data); });
});

/* search({value}) -> { items:[...], total } */
service.register('search', function (message) {
  var value = (message.payload && message.payload.value) || '';
  magis.search(value, function (err, data) { respond(message, err, data); });
});

/* detail({contentId}) -> { item, episodes, seasons } */
service.register('detail', function (message) {
  var id = message.payload && message.payload.contentId;
  magis.detail(id, function (err, data) { respond(message, err, data); });
});

/* resolve({contentId, seriesContentId}) -> { url, proxyPath, headers, ... } */
service.register('resolve', function (message) {
  var payload = message.payload || {};
  magis.resolve(payload.contentId, payload.seriesContentId, function (err, stream) {
    if (err) { return fail(message, err); }

    var isHevc = (stream.codec === 'HEVC' || stream.codec === 'H265' || stream.codec === 'H.265');
    /* 1.4.2 renamed the UI modes to direct/relay; accept both spellings so an
       older app build and the current one both reach the relay. */
    var useSmoothMode = payload.playbackMode === 'smooth' || payload.playbackMode === 'relay';
    /* webOS 4 handles AVC/H.264 transport streams natively.  Keep those on
       the light direct proxy so they retain native seeking; remux only the
       HEVC streams whose native TS path visibly judders on this TV. */
    if (relay.available() && isHevc && useSmoothMode) {
      var relayUrl = relay.register(stream, { hevc: isHevc, audio: 0 });
      console.log('[xuper-service] routing stream via ffmpeg relay: ' + relayUrl);
      stream.proxyPath = relayUrl;
      stream.mime = 'video/mp4';
      stream.isRelay = true;
      stream.isHls = false;
      return respond(message, null, stream);
    }

    proxy.start(function (perr, port) {
      if (perr) { return fail(message, perr); }
      var token = proxy.add(stream.url, stream.headers, stream.duration);
      var extension = stream.mime === 'video/mp4' ? 'mp4' : 'ts';
      /* The on-device HLS indexer is intentionally disabled: indexing long
         VOD files in the webOS 4 service can retain enough memory to make the
         system restart other foreground apps.  Direct ranged playback keeps
         the service's memory bounded. */
      stream.proxyPath = proxy.baseUrl() + '/media/' + token + '/stream.' + extension;
      stream.isHls = false;
      respond(message, null, stream);
    });
  });
});

/* abortMedia(): immediately kills all upstream sockets and buffers in proxy & relay */
service.register('abortMedia', function (message) {
  try { relay.stop(); } catch (eRelay) { /* ignore */ }
  try {
    proxy.killActiveStreams();
  } catch (eKill) { /* ignore */ }
  message.respond({ returnValue: true });
});

/* prewarm(): start the anonymous session so the first home call is fast */
service.register('prewarm', function (message) {
  magis.ensureSession(function (err) {
    if (err) { return fail(message, err); }
    message.respond({ returnValue: true, sn: magis.session.sn, userId: magis.session.userId });
  });
});

console.log('[xuper-service] started ' + pkg.name + ' v' + pkg.version);
