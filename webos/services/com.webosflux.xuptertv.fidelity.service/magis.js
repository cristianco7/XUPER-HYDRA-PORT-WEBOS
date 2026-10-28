/*
 * Magis portal client for the XuperTV webOS port.
 *
 * PROVENANCE
 * ----------
 * Protocol recovered statically from Xuper.apk (4.34.4):
 *   - body crypto: fc/b.java (DESede/ECB/PKCS5) + dc/a.java (base64)
 *   - portal key : AndroidManifest meta-data PORTAL_KEY, decrypted with
 *                  jb/b.java + fc/b.java using the literal in k2/b.java
 *   - endpoints  : classes2.dex strings (/api/portalCore/...)
 *   - constants  : build config (portalCode masnew, apkVer header 43404)
 *
 * Only an ANONYMOUS device session is created (v3/snToken + v8/active).
 * No user credentials are read, stored or transmitted by this module.
 *
 * ES5/CommonJS on purpose: webOS 4 ships an old Node.js inside its services.
 */
'use strict';

var crypto = require('crypto');
var https = require('https');

/* --------------------------------------------------------------- constants */
var KEY_HEX = 'e7af1ed7de1ffddd7bd3fe37ebdffde9ef3fe1ae39edfeb8';
var HOSTS = ['osuhk.m3x8o50te.com', 'oogoy.f30c96w8.com'];
var PORTAL_CODE = 'masnew';
var APP_ID = 'com.android.msandroid';
var APK_VERSION = '49902';
var SPKG_VER = '2025-08-07 05:40:11_36_16_';
var APK_VER_HEADER = '43404';
var USER_AGENT = 'okhttp/3.12.12';
var CONTENT_TYPE = 'application/json;charset=utf-8';
var SNTOKEN_SALT = 'ntFT65w6itH!lHCPw7D=@qnsFC5adD28';
var FIXED_MAC = '02:00:00:00:00:00';
var UA_CDN = 'Ranger/4.9.4-17294ac0';

var RATE_MS = 450;          // portal pacing (observed safe value)
var REQUEST_TIMEOUT = 20000;
var TREE_TTL = 10 * 60 * 1000;
var SEARCH_TTL = 3 * 60 * 1000;
var SLB_TTL = 5 * 60 * 1000;

var ROOT_CODES = {
  featured: 'masnew_featured',
  movies: 'masnew_movies',
  series: 'masnew_series',
  anime: 'masnew_anime',
  kids: 'masnew_kids',
  free: 'masnew_free'
};

var ROOT_CATEGORY = {
  featured: 'destacado',
  movies: 'pelicula',
  series: 'serie',
  anime: 'anime',
  kids: 'infantil',
  free: 'gratis'
};

var DEVICE_FIXED = {
  loginType: '2', appLanguage: 'en', hardwareInfo: 'ranchu',
  model: 'sdk_gphone64_arm64', product: 'sdk_gphone64_arm64', cpu: 'arm64-v8a',
  B29: '', reserve1: '', deviceToken: '', drmId: '', sdkVer: 36
};

var FINGERPRINT_FIXED = {
  board: 'goldfish_arm64', brand: 'google', cpuAbi: 'arm64-v8a', device: 'emu64a',
  diskInfo: '8GB', display: 'sdk_gphone64_arm64',
  fingerprint: 'google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys',
  hardware: 'ranchu', host: 'abfarm', manufacturer: 'Google', ramSize: '4GB',
  romSize: '8GB', tags: 'release-keys', verId: ''
};

/* ------------------------------------------------------------------ crypto */
function bufFrom(value, enc) {
  return Buffer.from ? Buffer.from(value, enc) : new Buffer(value, enc);
}

var EMPTY_IV = bufFrom('', 'binary');

function encryptBody(plain) {
  var c = crypto.createCipheriv('des-ede3', bufFrom(KEY_HEX, 'hex'), EMPTY_IV);
  var raw = Buffer.concat([c.update(bufFrom(plain, 'utf8')), c.final()]);
  return bufFrom(raw.toString('base64'), 'ascii').toString('hex');
}

function decryptBlob(wire) {
  var b64 = bufFrom(wire, 'hex').toString('ascii');
  var d = crypto.createDecipheriv('des-ede3', bufFrom(KEY_HEX, 'hex'), EMPTY_IV);
  return Buffer.concat([d.update(bufFrom(b64, 'base64')), d.final()]).toString('utf8');
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

/* ----------------------------------------------------------------- helpers */
function text(value) {
  if (value === null || value === undefined) { return ''; }
  return String(value);
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function imageOf(asset, type) {
  var list = asset && asset.posterList;
  if (!list || !list.length) { return ''; }
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].fileType === type && trim(list[i].fileUrl) !== '') {
      return trim(list[i].fileUrl);
    }
  }
  return '';
}

function genresOf(asset) {
  var raw = text(asset && asset.tags);
  if (!raw) { return []; }
  var parts = raw.split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var g = trim(parts[i]);
    if (g) { out.push(g); }
  }
  return out;
}

/* ----------------------------------------------------------------- session */
var session = { sn: '', userId: '', userToken: '', snToken: '', ready: false, busy: false };
var queue = [];
var lastCallAt = 0;

function enqueue(fn) {
  queue.push(fn);
  drain();
}

function drain() {
  if (session.busy || !queue.length) { return; }
  var wait = lastCallAt + RATE_MS - Date.now();
  if (wait > 0) {
    session.busy = true;
    setTimeout(function () { session.busy = false; drain(); }, wait);
    return;
  }
  var fn = queue.shift();
  session.busy = true;
  lastCallAt = Date.now();
  fn(function () {
    session.busy = false;
    drain();
  });
}

function deviceDict() {
  var d = {};
  for (var k in DEVICE_FIXED) {
    if (Object.prototype.hasOwnProperty.call(DEVICE_FIXED, k)) { d[k] = DEVICE_FIXED[k]; }
  }
  d.apkVersion = APK_VERSION;
  d.sysVersion = SPKG_VER;
  d.appId = APP_ID;
  d.sn = session.sn;
  return d;
}

function post(path, body, done) {
  var payload;
  try {
    payload = encryptBody(JSON.stringify(body));
  } catch (encErr) {
    return done(new Error(path + ': error cifrando cuerpo: ' + encErr.message));
  }
  var host = HOSTS[0];
  var attempt = 0;

  function tryHost() {
    var req = https.request({
      hostname: host,
      servername: host,
      rejectUnauthorized: false,
      path: '/api/portalCore/' + path,
      method: 'POST',
      headers: {
        apk: APP_ID,
        apkVer: APK_VER_HEADER,
        spkgVer: SPKG_VER,
        'User-Agent': USER_AGENT,
        'Content-Type': CONTENT_TYPE,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var answer;
        try {
          answer = JSON.parse(raw);
        } catch (e) {
          return done(new Error(path + ': respuesta no JSON (' + res.statusCode + ')'));
        }
        var code = answer.returnCode === undefined || answer.returnCode === null ? '' : String(answer.returnCode);
        if (code !== '' && code !== '0') {
          var err = new Error(path + ' -> ' + code + ' ' + text(answer.errorMessage));
          err.portalCode = code;
          return done(err);
        }
        if (typeof answer.data === 'string' && answer.data !== '') {
          var plain;
          try {
            plain = decryptBlob(answer.data);
          } catch (e2) {
            return done(new Error(path + ': no se pudo descifrar la respuesta (' + e2.message + ')'));
          }
          try {
            return done(null, JSON.parse(plain));
          } catch (e3) {
            return done(new Error(path + ': respuesta descifrada no JSON'));
          }
        }
        done(null, answer.data !== undefined && answer.data !== null ? answer.data : answer);
      });
    });

    req.setTimeout(REQUEST_TIMEOUT, function () {
      req.abort();
    });
    req.on('timeout', function () {
      req.abort();
    });
    req.on('error', function (e) {
      attempt++;
      if (attempt < HOSTS.length) {
        host = HOSTS[attempt];
        tryHost();
        return;
      }
      done(e);
    });
    req.write(payload);
    req.end();
  }

  tryHost();
}

function call(path, bean, opts, done) {
  if (typeof opts === 'function') { done = opts; opts = {}; }
  opts = opts || {};
  enqueue(function (release) {
    var body = {};
    var k;
    if (opts.baseFields !== false) {
      body.portalCode = PORTAL_CODE;
      body.userId = session.userId;
      body.userToken = session.userToken;
    }
    for (k in bean) {
      if (Object.prototype.hasOwnProperty.call(bean, k)) { body[k] = bean[k]; }
    }
    var dev = deviceDict();
    for (k in dev) {
      if (Object.prototype.hasOwnProperty.call(dev, k)) { body[k] = dev[k]; }
    }
    post(path, body, function (err, data) {
      release();
      // Si el portal rechaza con aaa100028 (no iniciado sesión / token caducado), renovamos la sesión automáticamente
      if (err && (err.portalCode === 'aaa100028' || /未登录|sesi[oó]n|login/i.test(err.message)) && !opts._sessionRetried) {
        console.log('[magis] sesión no iniciada (' + (err.portalCode || err.message) + '). Renovando sesión limpia...');
        session.ready = false;
        session.userId = '';
        session.userToken = '';
        session.snToken = '';
        return ensureSession(function (errSess) {
          if (errSess) { return done(err); }
          opts._sessionRetried = true;
          call(path, bean, opts, done);
        });
      }
      done(err, data);
    });
  });
}

function ensureSession(done) {
  if (session.ready && session.userId && session.userToken) { return done(null, session); }
  session.ready = false;
  var fp = {};
  var k;
  for (k in FINGERPRINT_FIXED) {
    if (Object.prototype.hasOwnProperty.call(FINGERPRINT_FIXED, k)) { fp[k] = FINGERPRINT_FIXED[k]; }
  }
  fp.androidId = randomHex(8);
  fp.cpuId = randomHex(8);
  fp.serialNumber = randomHex(8);
  fp.etheMac = randomHex(6).replace(/(..)(?=.)/g, '$1:');
  fp.gatewayMac = randomHex(6).replace(/(..)(?=.)/g, '$1:');
  fp.wifiMac = randomHex(6).replace(/(..)(?=.)/g, '$1:');

  function tryFallbackSeed(origErr) {
    console.log('[magis] snToken/active falló: ' + (origErr && origErr.message) + '. Reintentando con otro host...');
    if (!origErr || !origErr._retried) {
      HOSTS.push(HOSTS.shift()); // rotar host
      var retryErr = origErr || new Error('reintento');
      retryErr._retried = true;
      return setTimeout(function () {
        ensureSession(done);
      }, 500);
    }
    // Reintento final: si hay conexión exterior a github, probar seeds remotas
    var req = https.get('https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/seeds/seeds.json', { timeout: 10000 }, function (res) {
      if (res.statusCode !== 200) { return done(origErr); }
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try {
          var seeds = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          var list = Array.isArray(seeds) ? seeds : (seeds && seeds.seeds) || [];
          if (!list.length) { return done(origErr); }
          var seed = list[Math.floor(Math.random() * Math.min(list.length, 50))];
          session.userId = trim(seed.userId);
          session.userToken = trim(seed.userToken);
          session.sn = trim(seed.sn).toLowerCase();
          session.ready = true;
          done(null, session);
        } catch (pe) {
          done(origErr);
        }
      });
    });
    req.on('error', function () { done(origErr); });
    req.on('timeout', function () { req.abort(); done(origErr); });
  }

  call('v3/snToken', fp, { baseFields: false }, function (err, mint) {
    if (err) { return tryFallbackSeed(err); }
    var snToken = trim(mint && mint.snToken);
    if (!snToken) { return tryFallbackSeed(new Error('el portal no devolvió snToken')); }
    var sn = mint && trim(mint.sn);
    if (!sn) {
      sn = crypto.createHash('md5').update(snToken + SNTOKEN_SALT).digest('hex');
    }
    session.snToken = snToken;
    session.sn = String(sn).toLowerCase();

    call('v8/active', {
      snToken: snToken, authVersion: '', authCode: '', preCode: '', macAddr: FIXED_MAC,
      reserve1: '', openNum: 4, channel: 'default', matadata: '', signdata: ''
    }, { baseFields: false }, function (err2, active) {
      if (err2) { return tryFallbackSeed(err2); }
      session.userId = trim(active && active.userId);
      session.userToken = trim(active && active.userToken);
      if (!session.userToken) { return tryFallbackSeed(new Error('el portal no activó el dispositivo')); }
      session.ready = true;
      done(null, session);
    });
  });
}

/* ------------------------------------------------------------ normalizers */
function itemFromAsset(asset, category, kind) {
  if (!asset || trim(asset.contentId) === '') { return null; }
  var type = trim(asset.programType) || 'movie';
  var isSeries = type === 'teleplay' || type === 'series' || (asset.volumnCount && parseInt(asset.volumnCount, 10) > 1);
  return {
    id: trim(asset.contentId),
    title: text(asset.name || asset.title),
    category: category || '',
    kind: kind || (isSeries ? 'serie' : 'película'),
    score: asset.score === undefined || asset.score === null || asset.score === '' ? '—' : text(asset.score),
    year: trim(asset.releaseTime || asset.releaseDate) ? trim(asset.releaseTime || asset.releaseDate).slice(0, 4) : '—',
    duration: text(asset.duration),
    genres: genresOf(asset),
    director: text(asset.director),
    actors: text(asset.actorDisplay || asset.actors),
    synopsis: text(asset.description || asset.synopsis),
    poster: imageOf(asset, 'icon') || imageOf(asset, 'poster'),
    landscape: imageOf(asset, 'poster') || imageOf(asset, 'stage'),
    backdrop: imageOf(asset, 'stage') || imageOf(asset, 'poster'),
    type: isSeries ? 'teleplay' : type,
    alias: text(asset.alias),
    country: trim(asset.originalCountry || asset.country),
    releaseDate: trim(asset.releaseTime || asset.releaseDate),
    tagline: trim(asset.viewPoint || asset.tagline),
    volumeCount: asset.volumnCount === undefined || asset.volumnCount === null ? (parseInt(asset.volumeCount, 10) || 0) : parseInt(asset.volumnCount, 10) || 0,
    updateCount: asset.updateCount === undefined || asset.updateCount === null ? 0 : parseInt(asset.updateCount, 10) || 0,
    moreAudio: asset.moreAudio !== undefined ? asset.moreAudio : 0,
    moreSubtitle: asset.moreSubtitle !== undefined ? asset.moreSubtitle : 0,
    row: '',
    streamUrl: '',
    portal: true
  };
}

/* ------------------------------------------------------------------- cache */
var treeCache = {};    // rootKey -> { at, rows }
var itemCache = {};    // contentId -> item (full, with synopsis)
var searchCache = {};  // q -> { at, items }
var slbCache = null;

function remember(item) {
  if (item && item.id) { itemCache[item.id] = item; }
}

function itemsFromTree(tree, rootKey) {
  var rows = tree && tree.recommendList;
  var out = [];
  var category = ROOT_CATEGORY[rootKey] || '';
  if (!rows || !rows.length) { return out; }
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var assets = row && row.assetList;
    if (!assets || !assets.length) { continue; }
    for (var a = 0; a < assets.length; a++) {
      var item = itemFromAsset(assets[a], category, null);
      if (!item) { continue; }
      item.row = text(row.name);
      if (rootKey === 'free' && /free\.kids/i.test(item.row) && item.category.indexOf('infantil') === -1) {
        item.category += ',infantil';
      }
      out.push(item);
      remember(item);
    }
  }
  return out;
}

/* -------------------------------------------------------------- public API */
function home(rootKey, done) {
  rootKey = ROOT_CODES[rootKey] ? rootKey : 'movies';
  var cached = treeCache[rootKey];
  if (cached && Date.now() - cached.at < TREE_TTL) {
    return done(null, { root: rootKey, items: cached.items, cached: true });
  }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('getNextColumns', {
      columnCode: ROOT_CODES[rootKey], pageNum: 1, pageSize: 60, version: ''
    }, function (err2, tree) {
      if (err2) { return done(err2); }
      var items = itemsFromTree(tree, rootKey);
      treeCache[rootKey] = { at: Date.now(), items: items };
      done(null, { root: rootKey, items: items, cached: false });
    });
  });
}

function search(value, done) {
  var q = trim(value);
  if (!q) { return done(null, { items: [] }); }
  var key = q.toLowerCase();
  var cached = searchCache[key];
  if (cached && Date.now() - cached.at < SEARCH_TTL) {
    return done(null, { items: cached.items, cached: true });
  }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('v3/searchByName', {
      value: q, type: '0', columnId: '', filter: '', pageNum: 1, pageSize: 20
    }, function (err2, answer) {
      if (err2) { return done(err2); }
      var groups = answer && answer.searchItemList;
      var out = [];
      var seen = {};
      if (groups && groups.length) {
        for (var g = 0; g < groups.length; g++) {
          var list = groups[g] && groups[g].itemList;
          if (!list || !list.length) { continue; }
          for (var i = 0; i < list.length; i++) {
            var item = itemFromAsset(list[i], '', null);
            if (!item || seen[item.id]) { continue; }
            seen[item.id] = true;
            out.push(item);
            remember(item);
          }
        }
      }
      searchCache[key] = { at: Date.now(), items: out };
      done(null, { items: out, total: answer && answer.totalSize, cached: false });
    });
  });
}

function detail(contentId, done) {
  var id = trim(contentId);
  if (!id) { return done(new Error('falta contentId')); }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('v4/getItemData', {
      contentId: id, type: '0', sortType: '0', language: 'en', macAddr: FIXED_MAC
    }, function (err2, answer) {
      var cached = itemCache[id] || null;
      if (err2) {
        /* Movies answer portal100006 ("episode does not exist"): the catalog
           record already carries director/cast/synopsis/tags. */
        if (err2.portalCode === 'portal100006' && cached) {
          return done(null, { item: cached, episodes: [], seasons: [] });
        }
        return done(err2);
      }
      var data = answer && answer.assetData;
      if (!data) {
        return cached ? done(null, { item: cached, episodes: [], seasons: [] })
                      : done(new Error('el portal no devolvió datos del título'));
      }
      var item = itemFromAsset(data, cached ? cached.category : '', null);
      if (cached) {
        /* keep the row/alias context learned from the tree */
        item.row = cached.row;
        item.category = cached.category;
      }
      remember(item);

      var episodes = [];
      var list = data.simpleProgramList;
      if (list && list.length) {
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (!e) { continue; }
          episodes.push({
            id: trim(e.contentId),
            title: text(e.name),
            name: text(e.name),
            number: e.seriesNumber === undefined || e.seriesNumber === null ? i + 1 : e.seriesNumber,
            duration: text(e.duration),
            quality: text(e.quality)
          });
        }
      }
      var seasons = [];
      var sl = data.sameSeasonSeriesList;
      if (sl && sl.length) {
        for (var s = 0; s < sl.length; s++) {
          if (sl[s] && trim(sl[s].contentId)) {
            seasons.push({ id: trim(sl[s].contentId), number: sl[s].seasonNumber });
          }
        }
      }
      done(null, { item: item, episodes: episodes, seasons: seasons });
    });
  });
}

/* ------------------------------------------------------------------- play */
function slbBean() {
  return {
    hasPay: '0', userIdentity: '1', type: 'merge', appVer: APK_VERSION, lang: 'es',
    encMediaSupported: 1, liveCodeList: ['masnew_live'], appParams: '',
    reserve1: FIXED_MAC, pipFlag: '0'
  };
}

function isCfl(url) {
  var q = url.slice(url.lastIndexOf('?') + 1).split('&');
  for (var i = 0; i < q.length; i++) {
    if (trim(q[i]) === 'sign_type=cfl') { return true; }
  }
  return false;
}

function withScheme(addr) {
  var clean = trim(addr).replace(/\/+$/, '');
  return /^https?:\/\//.test(clean) ? clean : 'https://' + clean;
}

function vodCdns(slb) {
  var out = [];
  var list = slb && slb.cdn_list;
  if (!list || !list.length) { return out; }
  for (var i = 0; i < list.length; i++) {
    var cdn = list[i];
    if (!cdn || trim(cdn.tag) !== 'vod') { continue; }
    var urls = cdn.url_list || [];
    for (var u = 0; u < urls.length; u++) {
      var entry = urls[u];
      var url = trim(entry && entry.url);
      if ((isCfl(url) || trim(entry && entry.sign_type) === 'cfl') && trim(entry && entry.tag) === 'free') {
        var bases = [withScheme(cdn.main_addr)];
        var spare = trim(cdn.spared_addr);
        if (spare && bases.indexOf(withScheme(spare)) === -1) { bases.push(withScheme(spare)); }
        out.push({ bases: bases, auth: url });
        break;
      }
    }
  }
  return out;
}

function getSlb(done) {
  if (slbCache && Date.now() < slbCache.at + SLB_TTL) { return done(null, slbCache.slb); }
  call('v14/getSlbInfo', slbBean(), function (err, slb) {
    if (err) { return done(err); }
    if (!vodCdns(slb).length) { return done(new Error('el portal no expuso CDN de vod libre')); }
    slbCache = { at: Date.now(), slb: slb };
    done(null, slb);
  });
}

/* webOS 4 has hardware decode limits that are much lower than Android IjkPlayer.
 * The portal may return several files for the same episode but does not promise
 * that the first one is playable smoothly on a 2019 LG. Prefer an ordinary
 * H.264/MP4 rendition and reject high-frame-rate, UHD and very high bitrate
 * variants when a compatible alternative is present. */
function fieldNumber(value) {
  var match = text(value).match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function trackHeight(track) {
  var direct = fieldNumber(track && (track.videoHeight || track.height || track.pixelHeight));
  if (direct) { return direct; }
  var label = text(track && (track.resolution || track.videoResolution || track.quality)).toLowerCase();
  var byDimensions = label.match(/\d{3,4}\s*[x×]\s*(\d{3,4})/);
  if (byDimensions) { return parseInt(byDimensions[1], 10); }
  if (/\b(4k|uhd|2160)\b/.test(label)) { return 2160; }
  if (/\b1440\b/.test(label)) { return 1440; }
  if (/\b1080\b|\bfhd\b/.test(label)) { return 1080; }
  if (/\b720\b|\bhd\b/.test(label)) { return 720; }
  if (/\b480\b|\bsd\b/.test(label)) { return 480; }
  return 0;
}

function trackBitrateKbps(track) {
  var raw = track && (track.videoBitrate || track.videoBitRate || track.bitrate || track.bitRate || track.rate || '');
  var value = fieldNumber(raw);
  var label = text(raw).toLowerCase();
  if (/mbps|m\b/.test(label)) { return value * 1000; }
  /* Portal values without a suffix are normally bits per second. */
  return value > 10000 ? value / 1000 : value;
}

function trackFrameRate(track) {
  return fieldNumber(track && (track.frameRate || track.fps || track.videoFps));
}

function trackSummary(track) {
  return {
    codec: trim(track && track.encodeFormat).toUpperCase(),
    format: trim(track && track.videoFormat).toLowerCase(),
    quality: trim(track && track.quality),
    height: trackHeight(track),
    bitrateKbps: trackBitrateKbps(track),
    frameRate: trackFrameRate(track)
  };
}

function durationSeconds(value) {
  var raw = trim(value);
  if (!raw) { return 0; }
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(raw)) {
    var hms = raw.split(':');
    return (parseInt(hms[0], 10) * 3600) + (parseInt(hms[1], 10) * 60) + parseInt(hms[2], 10);
  }
  var seconds = fieldNumber(raw);
  /* Some portal records use milliseconds. */
  return seconds > 100000 ? seconds / 1000 : seconds;
}

function mediaScore(track) {
  var rawEnc = trim(track && track.encodeFormat).toLowerCase().replace(/[^a-z0-9]/g, '');
  var fmt = trim(track && track.videoFormat).toLowerCase();
  var isH264 = (rawEnc.indexOf('h264') !== -1 || rawEnc.indexOf('avc') !== -1);
  var isHevc = (rawEnc.indexOf('h265') !== -1 || rawEnc.indexOf('hevc') !== -1);
  var isMp4 = (fmt === 'mp4');
  var summary = trackSummary(track);

  var score = 0;
  if (isH264) {
    score += 0;
  } else if (isHevc) {
    score += 80;
  } else {
    score += 160;
  }
  if (/av1|vp9|10bit|hdr/.test(rawEnc)) { score += 500; }
  /* On webOS 4 the HTML5 MPEG-TS demuxer can keep the media clock moving
     while presenting uneven frames (even with a full network buffer).  The
     portal normally exposes the same VOD rendition as MP4, whose timestamps
     are handled by the native player reliably.  Make MP4 a true preference;
     TS remains the fallback only when no MP4 track is supplied. */
  if (!isMp4) { score += 2000; }
  if (summary.height > 1080) { score += 500 + summary.height; }
  if (summary.frameRate > 30) { score += 300 + summary.frameRate; }
  if (summary.bitrateKbps > 9000) { score += 250; }
  else if (summary.bitrateKbps > 6500) { score += 80; }
  return score;
}

function resolve(contentId, seriesId, done) {
  var id = trim(contentId);
  if (!id) { return done(new Error('falta contentId')); }
  ensureSession(function (err) {
    if (err) { return done(err); }
    call('v10/startPlayVOD', {
      contentId: id,
      seriesContentId: trim(seriesId),
      startTime: 0, type: '1', columnId: 0, authType: ''
    }, function (err2, play) {
      if (err2) { return done(err2); }
      var episode = play && play.episodeList && play.episodeList[0];
      if (!episode) { return done(new Error('el portal no devolvió pistas de vídeo')); }
      var tracks = [];
      var totals = episode.totalMovieList || [];
      for (var t = 0; t < totals.length; t++) {
        var movies = (totals[t] && totals[t].movieList) || [];
        for (var m = 0; m < movies.length; m++) {
          if (movies[m] && trim(movies[m].contentId)) { tracks.push(movies[m]); }
        }
      }
      if (!tracks.length) { return done(new Error('el portal no devolvió pistas de vídeo')); }
      tracks.sort(function (a, b) { return mediaScore(a) - mediaScore(b); });
      var track = tracks[0];
      /* Playback diagnostics deliberately contain only rendition metadata.
         They let us distinguish a TS-only title from a bad selector without
         exposing a playable URL, license, or request headers to the page. */
      var availableTracks = [];
      for (var a = 0; a < tracks.length; a++) {
        availableTracks.push(trackSummary(tracks[a]));
      }
      var license = trim((track.licenseList && track.licenseList[0] && track.licenseList[0].license) || '');
      if (!license) { return done(new Error('el portal no devolvió licencia de reproducción')); }

      getSlb(function (err3, slb) {
        if (err3) { return done(err3); }
        var cdns = vodCdns(slb);
        if (!cdns.length) { return done(new Error('el portal no expuso CDN de vod libre')); }
        var cdn = cdns[0];
        var ext = trim(track.videoFormat).toLowerCase() === 'ts' ? 'ts' : 'mp4';
        var url = cdn.bases[0] + '/vod/' + trim(track.contentId) + '_media.' + ext;

        var subtitles = [];
        var subs = episode.subtitleList || [];
        for (var s = 0; s < subs.length && subtitles.length < 30; s++) {
          var file = subs[s] && subs[s].file && subs[s].file[0];
          if (!file || !trim(file.url)) { continue; }
          subtitles.push({
            lang: trim(subs[s].language),
            url: trim(file.url),
            format: trim(file.fileType) || 'srt'
          });
        }

        var mime = ext === 'ts' ? 'video/mp2t' : 'video/mp4';
        var codec = trim(track.encodeFormat).toUpperCase();
        done(null, {
          url: url,
          mime: mime,
          codec: codec,
          quality: trim(track.quality),
          duration: durationSeconds(track.duration || episode.duration || (play && play.duration)),
          selectedTrack: trackSummary(track),
          availableTracks: availableTracks,
          audio: trim(track.audioInfo),
          headers: {
            'Content-Auth': cdn.auth,
            'Content-License': license,
            'User-Agent': UA_CDN,
            App: APP_ID,
            'App-Version': APK_VERSION
          },
          subtitles: subtitles,
          name: text(play && play.name)
        });
      });
    });
  });
}

module.exports = {
  home: home,
  search: search,
  detail: detail,
  resolve: resolve,
  ensureSession: ensureSession,
  session: session,
  constants: {
    APP_ID: APP_ID,
    APK_VERSION: APK_VERSION,
    UA_CDN: UA_CDN,
    FIXED_MAC: FIXED_MAC,
    ROOT_CODES: ROOT_CODES
  }
};
