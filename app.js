/* 한빛은혜교회 포털
 * - 방문자: 구글시트 내용을 읽어 화면을 보여줍니다.
 * - 관리자: 비밀번호로 로그인하면 화면에서 바로 추가·수정·삭제·순서변경·사진올리기를 할 수 있습니다.
 *   (저장은 구글시트에 설치한 Apps Script가 대신 해 줍니다. 서버 불필요)
 */
(function () {
  'use strict';
  var CFG = window.PORTAL_CONFIG || {};
  var API = (CFG.SCRIPT_URL || '').trim();
  var TABS = { settings: '설정', banners: '배너', dday: '디데이', apps: '앱링크' };
  var $ = function (id) { return document.getElementById(id); };
  var DAY = 86400000;
  var DATA = null, ADMIN = false, PW = '';
  var EMOJIS = ['⛪', '📖', '🙏', '🤝', '🙌', '📝', '📰', '💌', '💝', '🏢', '🎄', '🕯️', '🎉', '⛺', '📅', '🎵', '✝️', '👨‍👩‍👧', '📢', '🍚', '📸', '🎓', '❤️', '🌱'];

  /* ================= 작은 도구들 ================= */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;   // textContent: 시트 내용이 코드로 실행되지 않게 함
    return e;
  }
  function btn(label, cls, onclick) {
    var b = el('button', cls || 'btn', label); b.type = 'button';
    if (onclick) b.addEventListener('click', onclick);
    return b;
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
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(d) { return d ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) : ''; }
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? d : n; }
  function isEmoji(s) { return !!s && !/^https?:|^\.?\.?\//.test(s) && s.length <= 12; }
  function byOrder(a, b) { return num(a['순서'], 999) - num(b['순서'], 999); }

  var toastTimer;
  function toast(text, kind) {
    var t = $('toast'); t.textContent = text; t.className = 'toast ' + (kind || ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, kind === 'err' ? 5000 : 2500);
  }

  /* ================= CSV (관리 서버 없이 읽기만 할 때) ================= */
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

  /* ================= 데이터 읽기 ================= */
  function fetchLive() {
    if (API) {
      return fetch(API + (API.indexOf('?') < 0 ? '?' : '&') + 'action=data', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j.ok) throw new Error(j.error || '오류'); return j.data; });
    }
    return Promise.all([fetchTab(TABS.settings), fetchTab(TABS.banners), fetchTab(TABS.dday), fetchTab(TABS.apps)])
      .then(function (r) { return { settings: r[0], banners: r[1], dday: r[2], apps: r[3] }; });
  }
  function readCache() { try { return JSON.parse(localStorage.getItem('portalCache') || 'null'); } catch (e) { return null; } }
  function writeCache(d) { try { localStorage.setItem('portalCache', JSON.stringify(d)); } catch (e) { } }

  /* ================= 주간/야간 모드 ================= */
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

  /* ================= 화면 그리기 ================= */
  var FALLBACK_LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="#1f5e3b"/>' +
    '<path d="M20 7v26M12 15h16" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>' +
    '<path d="M8 33c4-5 8-7 12-7s8 2 12 7" stroke="#e5c87a" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>');

  function settingsMap(rows) {
    var m = {}; (rows || []).forEach(function (r) { var k = r['항목'] || ''; if (k) m[k] = r['내용'] || ''; }); return m;
  }
  function S() { return settingsMap(DATA && DATA.settings); }

  function render() {
    var s = S();
    renderHeader(s);
    renderBanners(DATA.banners || [], s);
    renderDday(DATA.dday || [], s);
    prepApps(DATA.apps || []);
    renderAdminChrome();
  }

  function renderHeader(s) {
    var name = s['교회명'] || '한빛은혜교회';
    $('churchName').textContent = name;
    $('tagline').textContent = s['소개문구'] || '';
    document.title = name;
    var logo = $('logo'), want = imgUrl(s['로고']) || 'assets/logo.webp';
    if (logo.getAttribute('data-want') !== want) {
      logo.setAttribute('data-want', want);
      logo.closest('.brand').classList.remove('nologo');
      logo.onerror = function () {   // 로고 파일이 없으면 기본 십자가 + 교회 이름 글자로 대체
        logo.onerror = null; logo.src = FALLBACK_LOGO; logo.closest('.brand').classList.add('nologo');
      };
      logo.src = want;
    }
    $('footText').textContent = s['하단문구'] || ('© ' + name);
  }

  /* ---- 배너 ---- */
  var slideIdx = 0, slideN = 0, timer = null, sec = 5;
  function visibleBanners(list) {
    var t = today();
    return list.filter(function (b) {
      if (!show(b['표시'])) return false;
      var s = parseDate(b['시작일']), e = parseDate(b['종료일']);
      if (s && t < s) return false;
      if (e && t > e) return false;
      return true;
    }).sort(byOrder);
  }
  function renderBanners(list, s) {
    var items = visibleBanners(list);
    var track = $('track'); track.textContent = ''; $('dots').textContent = '';
    slideN = items.length;
    $('bannerSec').hidden = slideN === 0 && !ADMIN;
    sec = Math.max(2, num(s['배너전환초'], 5));

    if (!slideN) {
      if (ADMIN) {
        var ph = el('div', 'slide plain'); var cap = el('div', 'cap');
        cap.appendChild(el('strong', null, '지금 보이는 배너가 없습니다'));
        cap.appendChild(el('span', null, '위의 [배너 관리]에서 새 배너를 추가해 보세요'));
        ph.appendChild(cap); track.appendChild(ph);
      }
      $('prev').hidden = $('next').hidden = $('dots').hidden = true;
      track.style.transform = ''; clearInterval(timer);
      return;
    }
    items.forEach(function (b, i) {
      var href = safeUrl(b['링크']);
      var s2 = el(href ? 'a' : 'div', 'slide');
      if (href) { s2.href = href; if (new URL(href).origin !== location.origin) { s2.target = '_blank'; s2.rel = 'noopener'; } }
      var im = imgUrl(b['이미지']);
      if (im) {
        var img = el('img', 'slide-img'); img.alt = b['제목'] || ''; img.loading = i ? 'lazy' : 'eager'; img.src = im;
        img.onerror = function () { img.remove(); s2.classList.add('plain'); };
        s2.appendChild(img);
      } else s2.classList.add('plain');
      if (b['제목'] || b['부제']) {
        var cap2 = el('div', 'cap');
        if (b['제목']) cap2.appendChild(el('strong', null, b['제목']));
        if (b['부제']) cap2.appendChild(el('span', null, b['부제']));
        s2.appendChild(cap2);
      }
      track.appendChild(s2);
      var d = el('button', 'dot'); d.type = 'button'; d.setAttribute('aria-label', (i + 1) + '번 배너');
      d.addEventListener('click', function () { go(i, true); });
      $('dots').appendChild(d);
    });
    var multi = slideN > 1;
    $('prev').hidden = $('next').hidden = $('dots').hidden = !multi;
    go(Math.min(slideIdx, slideN - 1)); restart();
  }
  function go(i, user) {
    if (!slideN) return;
    slideIdx = (i + slideN) % slideN;
    $('track').style.transform = 'translateX(' + (-100 * slideIdx) + '%)';
    $('dots').querySelectorAll('.dot').forEach(function (d, k) { d.classList.toggle('on', k === slideIdx); });
    if (user) restart();
  }
  function restart() {
    clearInterval(timer);
    if (slideN < 2 || ADMINBUSY || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = setInterval(function () { go(slideIdx + 1); }, sec * 1000);
  }
  var ADMINBUSY = false;   // 수정창이 열려 있는 동안은 배너 자동 넘김 정지
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

  /* ---- D-day ---- */
  function renderDday(list, s) {
    var t = today(), showPast = (s['지난일정표시'] || '').trim() !== '' && show(s['지난일정표시']);
    var items = [];
    list.forEach(function (d) {
      var dt = parseDate(d['날짜']); if (!dt) return;
      var hidden = !show(d['표시']);
      var diff = Math.round((dt - t) / DAY);
      if (!ADMIN && (hidden || (diff < 0 && !showPast))) return;
      items.push({ d: d, dt: dt, diff: diff, hidden: hidden });
    });
    items.sort(function (a, b) { return a.dt - b.dt; });
    var ul = $('ddayList'); ul.textContent = '';
    $('ddaySec').hidden = items.length === 0 && !ADMIN;
    items.forEach(function (it) {
      // 일정에 개별 링크가 있으면 그 주소로, 없으면 설정의 '일정게시판링크'(공통 게시판)로 연결
      var href = safeUrl(it.d['링크']) || safeUrl(s['일정게시판링크']);
      var li = el('li', 'dd' + (it.diff === 0 ? ' today' : '') + (it.diff < 0 ? ' past' : '') + (it.diff > 0 && it.diff <= 7 ? ' soon' : '') + (it.hidden ? ' hid' : ''));
      var box = el(href ? 'a' : 'div', 'dd-in'); if (href) { box.href = href; box.target = '_blank'; box.rel = 'noopener'; }
      box.appendChild(el('span', 'dd-ico', it.d['아이콘'] || '📌'));
      box.appendChild(el('span', 'dd-name', it.d['이름']));
      box.appendChild(el('span', 'dd-date', it.dt.getFullYear() + '.' + (it.dt.getMonth() + 1) + '.' + it.dt.getDate() +
        ' (' + '일월화수목금토'[it.dt.getDay()] + ')'));
      box.appendChild(el('strong', 'dd-count', it.diff === 0 ? 'D-DAY' : it.diff > 0 ? 'D-' + it.diff : 'D+' + (-it.diff)));
      if (href) box.appendChild(el('span', 'dd-more', '게시판 보기 ›'));
      li.appendChild(box);
      if (ADMIN) {
        if (it.hidden) li.appendChild(el('span', 'badge', '숨김'));
        else if (it.diff < 0) li.appendChild(el('span', 'badge', '지난 일정'));
        var ed = btn('✏️', 'adm-edit', function () { openDdayForm(it.d); });
        ed.title = '수정'; ed.setAttribute('aria-label', it.d['이름'] + ' 수정');
        li.appendChild(ed);
      }
      ul.appendChild(li);
    });
  }

  /* ---- 앱 목록 ---- */
  var APPS = [], CATS = [], cat = '전체';
  function prepApps(list) {
    APPS = list.filter(function (a) { return a['이름'] && (ADMIN || (show(a['표시']) && safeUrl(a['링크']))); })
      .map(function (a, i) { a._i = i; a._cat = a['카테고리'] || '기타'; return a; })
      .sort(function (a, b) { return byOrder(a, b) || a._i - b._i; });
    CATS = [];
    APPS.forEach(function (a) { if (CATS.indexOf(a._cat) < 0) CATS.push(a._cat); });
    var chips = $('chips'); chips.textContent = '';
    ['전체'].concat(CATS).forEach(function (c) {
      var b = el('button', 'chip', c); b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { cat = c; renderApps(); });
      chips.appendChild(b);
    });
    if (cat !== '전체' && CATS.indexOf(cat) < 0) cat = '전체';
    renderApps();
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
    $('appsEmpty').textContent = ADMIN ? '아직 앱이 없습니다. 위의 [앱 추가]를 눌러 보세요.' : '표시할 앱이 없습니다.';
    var canMove = ADMIN && !q;
    order.forEach(function (c) {
      var sec2 = el('section', 'group');
      var title = el('h3', 'group-title'); title.appendChild(el('span', null, c));
      if (canMove && cat === '전체') {
        var mv = el('span', 'mv');
        var up = btn('▲', 'adm-mini', function () { moveCategory(c, -1); }); up.title = '카테고리를 위로';
        var dn = btn('▼', 'adm-mini', function () { moveCategory(c, 1); }); dn.title = '카테고리를 아래로';
        up.disabled = CATS.indexOf(c) === 0; dn.disabled = CATS.indexOf(c) === CATS.length - 1;
        mv.appendChild(up); mv.appendChild(dn); title.appendChild(mv);
      }
      sec2.appendChild(title);
      var grid = el('div', 'grid');
      groups[c].forEach(function (a, idx) {
        var cell = el('div', 'cell' + (!show(a['표시']) ? ' hid' : ''));
        var href = safeUrl(a['링크']);
        var card = el('a', 'app'); if (href) card.href = href;
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
        cell.appendChild(card);
        if (ADMIN) {
          if (!show(a['표시'])) cell.appendChild(el('span', 'badge', '숨김'));
          var tools = el('div', 'cell-tools');
          if (canMove) {
            var u = btn('▲', 'adm-mini', function () { moveApp(a, -1); }); u.title = '앞으로'; u.disabled = idx === 0;
            var d = btn('▼', 'adm-mini', function () { moveApp(a, 1); }); d.title = '뒤로'; d.disabled = idx === groups[c].length - 1;
            tools.appendChild(u); tools.appendChild(d);
          }
          var ed = btn('✏️', 'adm-edit static', function () { openAppForm(a); }); ed.title = '수정'; ed.setAttribute('aria-label', a['이름'] + ' 수정');
          tools.appendChild(ed);
          cell.appendChild(tools);
        }
        grid.appendChild(cell);
      });
      sec2.appendChild(grid); box.appendChild(sec2);
    });
  }
  $('search').addEventListener('input', renderApps);

  /* ================= 관리자 기능 ================= */
  function call(payload) {
    payload.password = PW;
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); }, function () { throw new Error('인터넷 연결을 확인해 주세요.'); })
      .then(function (j) {
        if (!j.ok) {
          if (/비밀번호/.test(j.error || '') && payload.action !== 'login') logout(true);
          throw new Error(j.error || '저장하지 못했습니다.');
        }
        return j;
      });
  }
  function applyData(j) { if (j.data) { DATA = j.data; writeCache(DATA); render(); } return j; }
  function saveItem(sheet, item) { return call({ action: 'save', sheet: sheet, item: item }).then(applyData); }
  function deleteItem(sheet, id) { return call({ action: 'delete', sheet: sheet, id: id }).then(applyData); }
  function saveSettings(values) { return call({ action: 'setting', values: values }).then(applyData); }

  // 순서 바꾸기: 화면은 먼저 바꾸고, 저장이 실패하면 원래대로 되돌립니다.
  function reorderIds(sheet, ids) {
    var list = DATA[sheet], before = list.map(function (x) { return x['순서']; });
    ids.forEach(function (id, i) { list.forEach(function (x) { if (x.ID === id) x['순서'] = String(i + 1); }); });
    render();
    return call({ action: 'reorder', sheet: sheet, ids: ids }).then(applyData).catch(function (e) {
      list.forEach(function (x, i) { x['순서'] = before[i]; }); render(); toast(e.message, 'err');
    });
  }
  function seqByCats(cats) {
    var out = [];
    cats.forEach(function (c) { APPS.forEach(function (a) { if (a._cat === c) out.push(a); }); });
    return out;
  }
  function moveApp(a, dir) {
    var seq = seqByCats(CATS), block = seq.filter(function (x) { return x._cat === a._cat; });
    var i = block.indexOf(a), j = i + dir;
    if (j < 0 || j >= block.length) return;
    block[i] = block[j]; block[j] = a;
    var out = [];
    CATS.forEach(function (c) { (c === a._cat ? block : seq.filter(function (x) { return x._cat === c; })).forEach(function (x) { out.push(x.ID); }); });
    reorderIds('apps', out);
  }
  function moveCategory(c, dir) {
    var cats = CATS.slice(), i = cats.indexOf(c), j = i + dir;
    if (j < 0 || j >= cats.length) return;
    cats[i] = cats[j]; cats[j] = c;
    reorderIds('apps', seqByCats(cats).map(function (x) { return x.ID; }));
  }

  /* ---- 로그인/로그아웃 ---- */
  function login(pw) {
    PW = pw;
    return call({ action: 'login' }).then(function () {
      ADMIN = true;
      try { sessionStorage.setItem('adminPw', pw); } catch (e) { }
      render();
    }).catch(function (e) { PW = ''; throw e; });
  }
  function logout(expired) {
    ADMIN = false; PW = '';
    try { sessionStorage.removeItem('adminPw'); } catch (e) { }
    closeModal(); if (DATA) render();
    toast(expired ? '비밀번호가 달라 관리자 모드가 종료되었습니다.' : '관리자 모드를 종료했습니다.');
  }
  function openLogin() {
    var inp = el('input'); inp.type = 'password'; inp.autocomplete = 'current-password'; inp.placeholder = '관리자 비밀번호';
    var form = el('form', 'mform');
    var lab = el('label', 'mf'); lab.appendChild(el('span', 'mf-l', '비밀번호')); lab.appendChild(inp); form.appendChild(lab);
    var ok = el('button', 'btn', '로그인'); ok.type = 'submit';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!inp.value) return;
      ok.disabled = true; ok.textContent = '확인 중…';
      login(inp.value).then(function () { closeModal(); toast('관리자 모드로 들어왔습니다.'); })
        .catch(function (err) { toast(err.message, 'err'); ok.disabled = false; ok.textContent = '로그인'; inp.select(); });
    });
    openModal('관리자 로그인', form, [ok]);
    setTimeout(function () { inp.focus(); }, 30);
  }

  function renderAdminChrome() {
    var bar = $('adminBar'), link = $('adminLink');
    link.hidden = !API || ADMIN;
    bar.hidden = !ADMIN;
    ['bannerTools', 'ddayTools', 'appsTools'].forEach(function (id) { var t = $(id); t.textContent = ''; t.hidden = !ADMIN; });
    document.body.classList.toggle('is-admin', ADMIN);
    if (!ADMIN) return;
    bar.textContent = '';
    var in2 = el('div', 'wrap adminbar-in');
    in2.appendChild(el('span', 'adminbar-t', '🔧 관리자 모드 — ✏️ 를 눌러 수정하고, ▲▼ 로 순서를 바꾸세요'));
    var r = el('span', 'adminbar-r');
    r.appendChild(btn('⚙️ 화면 설정', 'btn sm light', openSettingsForm));
    r.appendChild(btn('로그아웃', 'btn sm ghost-w', function () { logout(); }));
    in2.appendChild(r); bar.appendChild(in2);
    $('bannerTools').appendChild(btn('🖼 배너 관리', 'btn sm', openBannerManager));
    $('ddayTools').appendChild(btn('＋ 일정 추가', 'btn sm', function () { openDdayForm(null); }));
    $('appsTools').appendChild(btn('＋ 앱 추가', 'btn sm', function () { openAppForm(null); }));
  }
  $('adminLink').addEventListener('click', openLogin);

  /* ---- 팝업(모달) ---- */
  var modalEl = null, modalKey = null;
  function openModal(title, body, actions, wide) {
    closeModal();
    var bg = el('div', 'modal-bg');
    var m = el('div', 'modal' + (wide ? ' wide' : '')); m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', title);
    var head = el('div', 'modal-head'); head.appendChild(el('h3', null, title));
    var x = btn('✕', 'modal-x', closeModal); x.setAttribute('aria-label', '닫기'); head.appendChild(x);
    m.appendChild(head);
    var bd = el('div', 'modal-body'); bd.appendChild(body); m.appendChild(bd);
    if (actions && actions.length) { var ac = el('div', 'modal-actions'); actions.forEach(function (a) { ac.appendChild(a); }); m.appendChild(ac); }
    bg.appendChild(m);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg && !bg.dataset.busy) closeModal(); });
    document.body.appendChild(bg); document.body.classList.add('modal-open');
    modalEl = bg; ADMINBUSY = true; clearInterval(timer);
    modalKey = function (e) { if (e.key === 'Escape' && !bg.dataset.busy) closeModal(); };
    document.addEventListener('keydown', modalKey);
    return m;
  }
  function closeModal() {
    if (!modalEl) return;
    modalEl.remove(); modalEl = null; document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', modalKey);
    ADMINBUSY = false; restart();
  }
  function busy(on) { if (modalEl) { if (on) modalEl.dataset.busy = '1'; else delete modalEl.dataset.busy; } }

  /* ---- 사진 올리기 ---- */
  function resizeImage(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var s = Math.min(1, max / Math.max(im.width, im.height));
        var c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var type = /png|webp|gif/.test(file.type) ? 'image/png' : 'image/jpeg';
        var data = c.toDataURL(type, 0.85);
        if (data.length > 3e6) { type = 'image/jpeg'; data = c.toDataURL(type, 0.8); }
        resolve({ mime: type, b64: data.split(',')[1] });
      };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error('사진을 읽을 수 없습니다.')); };
      im.src = url;
    });
  }
  function uploadImage(file, max) {
    return resizeImage(file, max).then(function (r) {
      return call({ action: 'upload', name: file.name, mime: r.mime, data: r.b64 });
    }).then(function (j) { return j.url; });
  }

  /* ---- 입력 항목 만들기 ---- */
  function fText(label, val, o) {
    o = o || {};
    var w = el('label', 'mf'); w.appendChild(el('span', 'mf-l', label + (o.req ? ' *' : '')));
    var i = el('input'); i.type = o.type || 'text'; i.value = val || ''; if (o.ph) i.placeholder = o.ph; if (o.max) i.maxLength = o.max;
    w.appendChild(i);
    if (o.hint) w.appendChild(el('small', 'mf-h', o.hint));
    return { node: w, get: function () { return i.value.trim(); }, label: label, req: o.req, kind: o.kind };
  }
  function fCheck(label, val) {
    var w = el('label', 'mf check'); var i = el('input'); i.type = 'checkbox'; i.checked = !!val;
    w.appendChild(i); w.appendChild(el('span', null, label));
    return { node: w, get: function () { return i.checked ? 'Y' : 'N'; } };
  }
  function fDate(label, val, o) {
    o = o || {}; var d = parseDate(val);
    return fText(label, fmtDate(d), { type: 'date', req: o.req, hint: o.hint });
  }
  function fCategory(val) {
    var cats = CATS.slice(), NEW = '__new__';
    var w = el('div', 'mf'); w.appendChild(el('span', 'mf-l', '카테고리 *'));
    var sel = el('select');
    cats.forEach(function (c) { var o = el('option', null, c); o.value = c; sel.appendChild(o); });
    var on = el('option', null, '＋ 새 카테고리 만들기'); on.value = NEW; sel.appendChild(on);
    var txt = el('input'); txt.type = 'text'; txt.placeholder = '새 카테고리 이름'; txt.hidden = true; txt.maxLength = 30;
    if (val && cats.indexOf(val) >= 0) sel.value = val;
    else if (val) { sel.value = NEW; txt.hidden = false; txt.value = val; }
    else if (cats.length) sel.value = cats[0]; else { sel.value = NEW; txt.hidden = false; }
    sel.addEventListener('change', function () { txt.hidden = sel.value !== NEW; if (!txt.hidden) txt.focus(); });
    w.appendChild(sel); w.appendChild(txt);
    return { node: w, label: '카테고리', req: true, get: function () { return (sel.value === NEW ? txt.value : sel.value).trim(); } };
  }
  // 사진/이모지 칸: o.max(사진 최대 크기), o.emojis(이모지 고르기), o.noUpload
  function fImage(label, val, o) {
    o = o || {};
    var w = el('div', 'mf'); w.appendChild(el('span', 'mf-l', label));
    var url = el('input'); url.type = 'text'; url.value = val || ''; url.placeholder = o.emojis ? '이모지를 고르거나 직접 입력' : '사진을 올리면 주소가 자동으로 들어갑니다';
    var prev = el('img', 'imgf-prev'); prev.alt = ''; prev.hidden = true;
    function sync() { var u = isEmoji(url.value) ? '' : imgUrl(url.value); prev.hidden = !u; if (u) prev.src = u; }
    url.addEventListener('input', sync); sync();
    if (o.emojis) {
      var row = el('div', 'emoji-row');
      EMOJIS.forEach(function (e) { row.appendChild(btn(e, 'emoji', function () { url.value = e; sync(); })); });
      w.appendChild(url); w.appendChild(row);
    } else w.appendChild(url);
    if (!o.noUpload) {
      var file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
      var up = btn('📷 사진 올리기', 'btn sm', function () { file.click(); });
      file.addEventListener('change', function () {
        var f = file.files[0]; if (!f) return;
        up.disabled = true; up.textContent = '올리는 중…'; busy(true);
        uploadImage(f, o.max || 1600).then(function (u) { url.value = u; sync(); toast('사진이 올라갔습니다.'); })
          .catch(function (e) { toast(e.message, 'err'); })
          .then(function () { up.disabled = false; up.textContent = '📷 사진 올리기'; busy(false); file.value = ''; });
      });
      var rowU = el('div', 'imgf-row'); rowU.appendChild(up); rowU.appendChild(file); rowU.appendChild(prev);
      w.appendChild(rowU);
    }
    return { node: w, get: function () { return url.value.trim(); }, kind: 'image' };
  }

  // 입력 팝업 공통: fields = [{k, f}], 저장/삭제 처리
  function formModal(title, fields, o) {
    var form = el('form', 'mform');
    fields.forEach(function (x) { form.appendChild(x.f.node); });
    if (o.note) form.appendChild(el('p', 'mf-note', o.note));
    var save = el('button', 'btn', '저장'); save.type = 'submit';
    var actions = [save];
    var del;
    if (o.onDelete) {
      del = btn('삭제', 'btn danger', function () {
        if (!confirm('정말 삭제할까요? 되돌릴 수 없습니다.')) return;
        lock(true); o.onDelete().then(function () { closeModal(); toast('삭제되었습니다.'); if (o.after) o.after(); })
          .catch(function (e) { toast(e.message, 'err'); lock(false); });
      });
      actions.unshift(del);
    }
    actions.push(btn('취소', 'btn ghost', function () { closeModal(); if (o.after) o.after(); }));
    function lock(on) { busy(on); save.disabled = on; if (del) del.disabled = on; save.textContent = on ? '저장 중…' : '저장'; }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var vals = {};
      for (var i = 0; i < fields.length; i++) {
        var x = fields[i], v = x.f.get();
        if (x.f.req && !v) { toast('"' + x.f.label + '"을(를) 입력해 주세요.', 'err'); return; }
        if (x.f.kind === 'url' && v && !/^https?:\/\/\S+$/i.test(v)) { toast('"' + x.f.label + '"은 http:// 또는 https:// 로 시작하는 주소여야 합니다.', 'err'); return; }
        vals[x.k] = v;
      }
      if (o.validate) { var msg = o.validate(vals); if (msg) { toast(msg, 'err'); return; } }
      lock(true);
      o.onSave(vals).then(function () { closeModal(); toast('저장되었습니다.'); if (o.after) o.after(); })
        .catch(function (err) { toast(err.message, 'err'); lock(false); });
    });
    openModal(title, form, actions);
    var first = form.querySelector('input:not([type=hidden]):not([type=file]),select'); if (first) setTimeout(function () { first.focus(); }, 30);
  }

  /* ---- 앱 / 일정 / 배너 / 설정 입력창 ---- */
  function openAppForm(a) {
    var isNew = !a; a = a || {};
    formModal(isNew ? '앱 추가' : '앱 수정', [
      { k: '카테고리', f: fCategory(a['카테고리']) },
      { k: '이름', f: fText('앱 이름', a['이름'], { req: true, max: 40 }) },
      { k: '설명', f: fText('짧은 설명', a['설명'], { max: 80, ph: '예) 처음 오신 분 등록 양식' }) },
      { k: '링크', f: fText('연결할 주소(링크)', a['링크'], { req: true, kind: 'url', ph: 'https://...' }) },
      { k: '아이콘', f: fImage('아이콘', a['아이콘'], { emojis: true, max: 256 }) },
      { k: '표시', f: fCheck('화면에 보이기 (끄면 숨겨집니다)', isNew ? true : show(a['표시'])) },
      { k: '새창', f: fCheck('새 창(탭)에서 열기', isNew ? true : show(a['새창'] || 'Y')) }
    ], {
      onSave: function (v) { if (a.ID) v.ID = a.ID; return saveItem('apps', v); },
      onDelete: a.ID ? function () { return deleteItem('apps', a.ID); } : null
    });
  }
  function openDdayForm(d) {
    var isNew = !d; d = d || {};
    formModal(isNew ? '일정(D-day) 추가' : '일정(D-day) 수정', [
      { k: '이름', f: fText('일정 이름', d['이름'], { req: true, max: 40, ph: '예) 성탄 감사예배' }) },
      { k: '날짜', f: fDate('날짜', d['날짜'], { req: true }) },
      { k: '아이콘', f: fImage('아이콘', d['아이콘'], { emojis: true, noUpload: true }) },
      { k: '링크', f: fText('눌렀을 때 이동할 주소 (선택)', d['링크'], { kind: 'url', ph: 'https://...', hint: '비워 두면 [화면 설정]의 "일정 게시판 주소"로 이동합니다.' }) },
      { k: '표시', f: fCheck('화면에 보이기', isNew ? true : show(d['표시'])) }
    ], {
      onSave: function (v) { if (d.ID) v.ID = d.ID; return saveItem('dday', v); },
      onDelete: d.ID ? function () { return deleteItem('dday', d.ID); } : null
    });
  }
  function openBannerForm(b, back) {
    var isNew = !b; b = b || {};
    formModal(isNew ? '배너 추가' : '배너 수정', [
      { k: '제목', f: fText('큰 글씨(제목)', b['제목'], { max: 60 }) },
      { k: '부제', f: fText('작은 글씨(부제)', b['부제'], { max: 100 }) },
      { k: '이미지', f: fImage('배너 사진', b['이미지'], { max: 1600 }) },
      { k: '링크', f: fText('눌렀을 때 이동할 주소 (선택)', b['링크'], { kind: 'url', ph: 'https://...' }) },
      { k: '시작일', f: fDate('보이기 시작하는 날 (선택)', b['시작일']) },
      { k: '종료일', f: fDate('끝나는 날 (선택)', b['종료일'], { hint: '비워 두면 계속 보입니다.' }) },
      { k: '표시', f: fCheck('화면에 보이기', isNew ? true : show(b['표시'])) }
    ], {
      note: '사진은 가로로 긴 모양(예: 1600×600)이 가장 예쁩니다. 글자는 사진 가운데쪽에 두세요.',
      validate: function (v) { if (!v['제목'] && !v['이미지']) return '제목이나 사진 중 하나는 있어야 합니다.'; },
      after: function () { if (back) openBannerManager(); },
      onSave: function (v) { if (b.ID) v.ID = b.ID; return saveItem('banners', v); },
      onDelete: b.ID ? function () { return deleteItem('banners', b.ID); } : null
    });
  }
  function openBannerManager() {
    var list = (DATA.banners || []).slice().sort(byOrder), t = today();
    var body = el('div', 'bm');
    if (!list.length) body.appendChild(el('p', 'empty', '아직 배너가 없습니다.'));
    list.forEach(function (b, i) {
      var row = el('div', 'bm-row');
      var th = el('div', 'bm-th'); var u = imgUrl(b['이미지']);
      if (u) { var im = el('img'); im.alt = ''; im.src = u; th.appendChild(im); } else th.textContent = '🖼';
      row.appendChild(th);
      var tx = el('div', 'bm-tx'); tx.appendChild(el('strong', null, b['제목'] || '(제목 없음)'));
      var st = [];
      if (!show(b['표시'])) st.push('숨김');
      var s0 = parseDate(b['시작일']), e0 = parseDate(b['종료일']);
      if (s0 && t < s0) st.push('시작 전'); if (e0 && t > e0) st.push('기간 종료');
      if (b['시작일'] || b['종료일']) st.push((b['시작일'] || '') + ' ~ ' + (b['종료일'] || ''));
      tx.appendChild(el('small', null, st.length ? st.join(' · ') : '표시 중'));
      row.appendChild(tx);
      var tl = el('div', 'bm-tools');
      var up = btn('▲', 'adm-mini', function () { moveBanner(list, i, -1); }); up.disabled = i === 0;
      var dn = btn('▼', 'adm-mini', function () { moveBanner(list, i, 1); }); dn.disabled = i === list.length - 1;
      tl.appendChild(up); tl.appendChild(dn);
      tl.appendChild(btn('✏️ 수정', 'btn sm', function () { openBannerForm(b, true); }));
      row.appendChild(tl); body.appendChild(row);
    });
    openModal('배너 관리', body, [btn('＋ 새 배너 추가', 'btn', function () { openBannerForm(null, true); }), btn('닫기', 'btn ghost', closeModal)], true);
  }
  function moveBanner(list, i, dir) {
    var j = i + dir; if (j < 0 || j >= list.length) return;
    var a = list[i]; list[i] = list[j]; list[j] = a;
    reorderIds('banners', list.map(function (x) { return x.ID; })).then(openBannerManager);
  }
  function openSettingsForm() {
    var s = S();
    formModal('화면 설정', [
      { k: '교회명', f: fText('교회 이름', s['교회명'], { max: 40, hint: '로고가 없을 때와 브라우저 제목에 쓰입니다.' }) },
      { k: '일정게시판링크', f: fText('일정 게시판 주소', s['일정게시판링크'], { kind: 'url', ph: 'https://...', hint: 'D-day 카드를 누르면 이동하는 게시판 주소입니다.' }) },
      { k: '하단문구', f: fText('맨 아래 문구', s['하단문구'], { max: 100 }) },
      { k: '배너전환초', f: fText('배너가 넘어가는 시간(초)', s['배너전환초'] || '5', { type: 'number' }) },
      { k: '지난일정표시', f: fCheck('지난 일정도 화면에 보이기 (D+3 처럼)', (s['지난일정표시'] || '').trim() !== '' && show(s['지난일정표시'])) },
      { k: '로고', f: fImage('로고 이미지 (비워 두면 기본 로고)', s['로고'], { max: 800 }) }
    ], { onSave: function (v) { return saveSettings(v); } });
  }

  /* ================= 시작 ================= */
  function setStatus(t) { $('status').textContent = t || ''; }
  var cached = readCache();
  if (cached && (API || CFG.SHEET_ID)) { DATA = cached; render(); }

  if (!API && !CFG.SHEET_ID) {
    DATA = window.SAMPLE_DATA; render();
    setStatus('예시 화면입니다. config.js에 구글시트 연결 정보를 넣으면 실제 내용이 나옵니다.');
  } else {
    fetchLive().then(function (d) { DATA = d; writeCache(d); setStatus(''); render(); })
      .catch(function () {
        if (DATA) { setStatus('인터넷 연결이 불안정하여 이전에 저장된 내용을 보여드립니다.'); return; }
        DATA = window.SAMPLE_DATA; render();
        setStatus('구글시트를 불러오지 못했습니다. (config.js의 주소와 공유 설정을 확인해 주세요)');
      })
      .then(function () {
        if (!API) return;
        var saved = ''; try { saved = sessionStorage.getItem('adminPw') || ''; } catch (e) { }
        if (saved) login(saved).catch(function () { try { sessionStorage.removeItem('adminPw'); } catch (e) { } });
        else if (/[?&]admin\b/.test(location.search)) openLogin();
      });
  }
})();
