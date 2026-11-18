/* 한빛은혜교회 포털 - 구글시트 내용을 읽어 화면을 만듭니다. (서버 불필요) */
(function () {
  'use strict';
  var CFG = window.PORTAL_CONFIG || {};
  var TABS = { settings: '설정', banners: '배너', dday: '디데이', apps: '앱링크' };
  var $ = function (id) { return document.getElementById(id); };
  var DAY = 86400000;

  /* ---------- 작은 도구들 ---------- */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;   // textContent: 시트 내용이 코드로 실행되지 않게 함
    return e;
  }
  function safeUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    try {
      var x = new URL(u, location.href);
      return (x.protocol === 'http:' || x.protocol === 'https:') ? x.href : '';
    } catch (e) { return ''; }
  }
  function imgUrl(u) {   // 구글 드라이브 공유 링크도 이미지 주소로 바꿔줌
    u = (u || '').trim();
    var m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/) || u.match(/drive\.google\.com\/(?:open|uc)\?[^#]*id=([\w-]+)/);
    if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1600';
    return safeUrl(u);
  }
  function show(v) {   // '표시' 칸: 비어 있거나 Y면 보임, N/아니오/X 등이면 숨김
    v = (v || '').trim().toLowerCase();
    return ['n', 'no', '아니오', '아니요', 'x', '0', 'false', '숨김', '안함'].indexOf(v) < 0;
  }
  function parseDate(s) {
    var m = (s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function isEmoji(s) { return s && !/^https?:|^\.?\.?\//.test(s) && s.length <= 8; }

  /* ---------- CSV 읽기 ---------- */
  function parseCSV(t) {
    var rows = [], row = [], f = '', q = false, i, c;
    t = t.replace(/^﻿/, '');
    for (i = 0; i < t.length; i++) {
      c = t[i];
      if (q) {
        if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function toObjects(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim(); });
    return rows.slice(1).filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); })
      .map(function (r) { var o = {}; head.forEach(function (h, i) { o[h] = (r[i] || '').trim(); }); return o; });
  }
  function fetchTab(name) {
    var url = 'https://docs.google.com/spreadsheets/d/' + encodeURIComponent(CFG.SHEET_ID) +
      '/gviz/tq?tqx=out:csv&headers=1&sheet=' + encodeURIComponent(name);
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      return r.text();
    }).then(function (t) {
      if (/^\s*<(!doctype|html)/i.test(t)) throw new Error(name + ' 비공개');
      return toObjects(parseCSV(t));
    });
  }
  function loadData() {
    if (!CFG.SHEET_ID) return Promise.resolve({ data: window.SAMPLE_DATA, source: 'sample' });
    return Promise.all([fetchTab(TABS.settings), fetchTab(TABS.banners), fetchTab(TABS.dday), fetchTab(TABS.apps)])
      .then(function (r) {
        var data = { settings: r[0], banners: r[1], dday: r[2], apps: r[3] };
        try { localStorage.setItem('portalCache', JSON.stringify(data)); } catch (e) { }
        return { data: data, source: 'live' };
      })
      .catch(function () {
        try {
          var c = JSON.parse(localStorage.getItem('portalCache') || 'null');
          if (c) return { data: c, source: 'cache' };
        } catch (e) { }
        return { data: window.SAMPLE_DATA, source: 'error' };
      });
  }

  /* ---------- 주간/야간 모드 ---------- */
  var mq = matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    var mode = 'auto';
    try { mode = localStorage.getItem('theme') || 'auto'; } catch (e) { }
    var dark = mode === 'dark';
    if (mode === 'auto') {
      var light = matchMedia('(prefers-color-scheme: light)').matches;
      var h = new Date().getHours();
      dark = mq.matches ? true : (light ? false : (h >= 18 || h < 6));
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('.theme button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = dark ? '#101412' : '#1f5e3b';
  }
  document.querySelectorAll('.theme button').forEach(function (b) {
    b.addEventListener('click', function () {
      try { localStorage.setItem('theme', b.dataset.mode); } catch (e) { }
      applyTheme();
    });
  });
  if (mq.addEventListener) mq.addEventListener('change', applyTheme);
  applyTheme();

  /* ---------- 화면 그리기 ---------- */
  var FALLBACK_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#1f5e3b"/>' +
    '<path d="M20 7v26M12 15h16" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>' +
    '<path d="M8 33c4-5 8-7 12-7s8 2 12 7" stroke="#e5c87a" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>');

  function renderHeader(S) {
    var name = S['교회명'] || '한빛은혜교회';
    $('churchName').textContent = name;
    $('tagline').textContent = S['소개문구'] || '';
    document.title = name;
    var logo = $('logo');
    logo.onerror = function () {   // 로고 파일이 없으면 기본 십자가 + 교회 이름 글자로 대체
      logo.onerror = null; logo.src = FALLBACK_LOGO; logo.closest('.brand').classList.add('nologo');
    };
    logo.src = imgUrl(S['로고']) || 'assets/logo.webp';
    $('footText').textContent = S['하단문구'] || ('© ' + name);
  }

  /* 배너 */
  var slideIdx = 0, slideN = 0, timer = null, sec = 5;
  function renderBanners(list, S) {
    var t = today();
    var items = list.filter(function (b) {
      if (!show(b['표시'])) return false;
      var s = parseDate(b['시작일']), e = parseDate(b['종료일']);
      if (s && t < s) return false;
      if (e && t > e) return false;
      return true;
    }).sort(function (a, b) { return num(a['순서'], 999) - num(b['순서'], 999); });

    var track = $('track'); track.textContent = ''; $('dots').textContent = '';
    slideN = items.length;
    $('bannerSec').hidden = slideN === 0;
    if (!slideN) return;
    sec = Math.max(2, num(S['배너전환초'], 5));

    items.forEach(function (b, i) {
      var href = safeUrl(b['링크']);
      var s = el(href ? 'a' : 'div', 'slide');
      if (href) { s.href = href; if (new URL(href).origin !== location.origin) { s.target = '_blank'; s.rel = 'noopener'; } }
      var im = imgUrl(b['이미지']);
      if (im) {
        var img = el('img', 'slide-img'); img.alt = b['제목'] || ''; img.loading = i ? 'lazy' : 'eager'; img.src = im;
        img.onerror = function () { img.remove(); s.classList.add('plain'); };
        s.appendChild(img);
      } else s.classList.add('plain');
      if (b['제목'] || b['부제']) {
        var cap = el('div', 'cap');
        if (b['제목']) cap.appendChild(el('strong', null, b['제목']));
        if (b['부제']) cap.appendChild(el('span', null, b['부제']));
        s.appendChild(cap);
      }
      track.appendChild(s);
      var d = el('button', 'dot'); d.type = 'button'; d.setAttribute('aria-label', (i + 1) + '번 배너');
      d.addEventListener('click', function () { go(i, true); });
      $('dots').appendChild(d);
    });
    var multi = slideN > 1;
    $('prev').hidden = $('next').hidden = $('dots').hidden = !multi;
    go(0); restart();
  }
  function go(i, user) {
    slideIdx = (i + slideN) % slideN;
    $('track').style.transform = 'translateX(' + (-100 * slideIdx) + '%)';
    $('dots').querySelectorAll('.dot').forEach(function (d, k) { d.classList.toggle('on', k === slideIdx); });
    if (user) restart();
  }
  function restart() {
    clearInterval(timer);
    if (slideN < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setInterval(function () { go(slideIdx + 1); }, sec * 1000);
  }
  $('prev').addEventListener('click', function () { go(slideIdx - 1, true); });
  $('next').addEventListener('click', function () { go(slideIdx + 1, true); });
  (function swipe() {
    var b = $('banner'), x0 = null;
    b.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    b.addEventListener('pointerup', function (e) {
      if (x0 == null) return;
      var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) go(slideIdx + (dx < 0 ? 1 : -1), true);
    });
    b.addEventListener('mouseenter', function () { clearInterval(timer); });
    b.addEventListener('mouseleave', restart);
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') go(slideIdx - 1, true);
      if (e.key === 'ArrowRight') go(slideIdx + 1, true);
    });
  })();

  /* D-day */
  function renderDday(list, S) {
    var t = today(), showPast = show(S['지난일정표시']) && (S['지난일정표시'] || '').trim() !== '';
    var items = [];
    list.forEach(function (d) {
      if (!show(d['표시'])) return;
      var dt = parseDate(d['날짜']); if (!dt) return;
      var diff = Math.round((dt - t) / DAY);
      if (diff < 0 && !showPast) return;
      items.push({ d: d, dt: dt, diff: diff });
    });
    items.sort(function (a, b) { return a.dt - b.dt; });
    var ul = $('ddayList'); ul.textContent = '';
    $('ddaySec').hidden = items.length === 0;
    items.forEach(function (it) {
      // 일정에 개별 링크가 있으면 그 주소로, 없으면 설정의 '일정게시판링크'(공통 게시판)로 연결
      var href = safeUrl(it.d['링크']) || safeUrl(S['일정게시판링크']);
      var li = el('li', 'dd' + (it.diff === 0 ? ' today' : '') + (it.diff < 0 ? ' past' : '') + (it.diff > 0 && it.diff <= 7 ? ' soon' : ''));
      var box = el(href ? 'a' : 'div', 'dd-in'); if (href) { box.href = href; box.target = '_blank'; box.rel = 'noopener'; }
      box.appendChild(el('span', 'dd-ico', it.d['아이콘'] || '📌'));
      box.appendChild(el('span', 'dd-name', it.d['이름']));
      box.appendChild(el('span', 'dd-date', it.dt.getFullYear() + '.' + (it.dt.getMonth() + 1) + '.' + it.dt.getDate() +
        ' (' + '일월화수목금토'[it.dt.getDay()] + ')'));
      box.appendChild(el('strong', 'dd-count', it.diff === 0 ? 'D-DAY' : it.diff > 0 ? 'D-' + it.diff : 'D+' + (-it.diff)));
      if (href) box.appendChild(el('span', 'dd-more', '게시판 보기 ›'));
      li.appendChild(box); ul.appendChild(li);
    });
  }

  /* 앱 목록 */
  var APPS = [], cat = '전체';
  function prepApps(list) {
    APPS = list.filter(function (a) { return show(a['표시']) && a['이름'] && safeUrl(a['링크']); })
      .map(function (a, i) { a._i = i; a._cat = a['카테고리'] || '기타'; return a; })
      .sort(function (a, b) { return num(a['순서'], 999) - num(b['순서'], 999) || a._i - b._i; });
    var cats = []; APPS.forEach(function (a) { if (cats.indexOf(a._cat) < 0) cats.push(a._cat); });
    var chips = $('chips'); chips.textContent = '';
    ['전체'].concat(cats).forEach(function (c) {
      var b = el('button', 'chip', c); b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { cat = c; renderApps(); });
      chips.appendChild(b);
    });
    cat = '전체'; renderApps();
  }
  function renderApps() {
    var q = $('search').value.trim().toLowerCase();
    document.querySelectorAll('.chip').forEach(function (b) {
      var on = b.textContent === cat; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    });
    var box = $('apps'); box.textContent = '';
    var groups = {}, order = [];
    APPS.forEach(function (a) {
      if (cat !== '전체' && a._cat !== cat) return;
      if (q && (a['이름'] + ' ' + (a['설명'] || '') + ' ' + a._cat).toLowerCase().indexOf(q) < 0) return;
      if (!groups[a._cat]) { groups[a._cat] = []; order.push(a._cat); }
      groups[a._cat].push(a);
    });
    $('appsEmpty').hidden = order.length > 0;
    order.forEach(function (c) {
      var sec = el('section', 'group');
      sec.appendChild(el('h3', 'group-title', c));
      var grid = el('div', 'grid');
      groups[c].forEach(function (a) {
        var href = safeUrl(a['링크']);
        var card = el('a', 'app'); card.href = href;
        if (show(a['새창'] || 'Y')) { card.target = '_blank'; card.rel = 'noopener'; }
        var ic = el('span', 'app-ico');
        var raw = a['아이콘'] || '';
        if (raw && !isEmoji(raw) && imgUrl(raw)) { var im = el('img'); im.alt = ''; im.loading = 'lazy'; im.src = imgUrl(raw); ic.appendChild(im); }
        else ic.textContent = raw || '🔗';
        card.appendChild(ic);
        var tx = el('span', 'app-tx');
        tx.appendChild(el('strong', null, a['이름']));
        if (a['설명']) tx.appendChild(el('small', null, a['설명']));
        card.appendChild(tx);
        card.appendChild(el('span', 'go', '›'));
        grid.appendChild(card);
      });
      sec.appendChild(grid); box.appendChild(sec);
    });
  }
  $('search').addEventListener('input', renderApps);

  /* ---------- 시작 ---------- */
  function settingsMap(rows) {
    var m = {}; rows.forEach(function (r) { var k = r['항목'] || ''; if (k) m[k] = r['내용'] || ''; }); return m;
  }
  loadData().then(function (res) {
    var d = res.data, S = settingsMap(d.settings || []);
    renderHeader(S);
    renderBanners(d.banners || [], S);
    renderDday(d.dday || [], S);
    prepApps(d.apps || []);
    var st = $('status'); st.textContent = '';
    if (res.source === 'error') st.textContent = '구글시트를 불러오지 못했습니다. (시트 ID와 공유 설정을 확인해 주세요)';
    else if (res.source === 'cache') st.textContent = '인터넷 연결이 불안정하여 이전에 저장된 내용을 보여드립니다.';
    else if (res.source === 'sample') st.textContent = '예시 화면입니다. config.js에 구글시트 ID를 넣으면 실제 내용이 나옵니다.';
  });
})();
