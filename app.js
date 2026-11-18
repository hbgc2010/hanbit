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

  /* ================= 스크롤 움직임 ================= */
  // 화면에 들어올 때 부드럽게 나타나기(한 번 본 항목은 다시 움직이지 않음), 머리글 그림자,
  // 배너 시차 효과, 읽기 진행 막대, 맨 위로 버튼. '움직임 줄이기' 설정을 쓰는 기기에서는 모두 꺼집니다.
  var MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window;
  var SEEN = {}, IO = null;
  if (MOTION) {
    document.documentElement.classList.add('motion');
    IO = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        // 화면 아래쪽에서 기다리는 항목은 그대로 두고, 이미 지나쳐 위로 올라간 항목은 바로 보이게 함
        if (!e.isIntersecting && e.boundingClientRect.top >= 0) return;
        e.target.classList.add('in');
        countUp(e.target);
        var k = e.target.getAttribute('data-rk'); if (k) SEEN[k] = 1;
        IO.unobserve(e.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
  }
  // D-day 숫자가 나타날 때 0에서 올라가는 효과
  function countUp(root) {
    root.querySelectorAll('[data-n]').forEach(function (n) {
      var to = +n.getAttribute('data-n'), t0 = performance.now();
      (function f(t) {
        var p = Math.min(1, (t - t0) / 800);
        n.textContent = 'D-' + Math.round(to * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(f);
      })(t0);
    });
  }
  function reveal(node, key, i) {
    if (!MOTION || SEEN[key]) return node;
    node.classList.add('reveal'); node.setAttribute('data-rk', key);
    if (i) node.style.setProperty('--d', Math.min(i, 8) * 70 + 'ms');
    IO.observe(node);
    return node;
  }
  (function scrollFx() {
    var hdr = document.querySelector('.top'), bar = el('div', 'progress');
    var up = el('button', 'totop', '↑'); up.type = 'button'; up.hidden = true; up.setAttribute('aria-label', '맨 위로');
    up.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: MOTION ? 'smooth' : 'auto' }); });
    document.body.appendChild(bar); document.body.appendChild(up);
    var tick = false;
    function on() {
      tick = false;
      var y = window.pageYOffset, max = document.documentElement.scrollHeight - window.innerHeight;
      hdr.classList.toggle('scrolled', y > 8);
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
      up.hidden = y < 500;
      if (MOTION) $('banner').style.setProperty('--py', Math.min(y, 600) * 0.12 + 'px');
    }
    window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(on); } }, { passive: true });
    on();
  })();

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
    if (meta) meta.content = dark ? '#0d1424' : '#ffffff';
    // 주간/야간에 따라 달라지는 이미지(로고, 야간 배너 사진)를 바꿔 보여줌
    if (DATA && DATA.settings) {
      renderHeader(S());
      if ((DATA.banners || []).some(function (b) { return b['야간이미지']; })) renderBanners(DATA.banners || [], S());
    }
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
    // 야간 모드에는 '야간 로고'가 있으면 그것을, 없으면 주간 로고를 흰 받침 위에 보여줌
    var logo = $('logo'), isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var night = imgUrl(s['야간로고']), useNight = isDark && !!night;
    var want = (useNight ? night : imgUrl(s['로고'])) || 'assets/logo.webp';
    logo.classList.toggle('night', useNight);
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
        var ph = el('div', 'slide plain'), cap = el('div', 'cap'), cin = el('div', 'wrap cap-in');
        cin.appendChild(el('strong', null, '지금 보이는 배너가 없습니다'));
        cin.appendChild(el('span', null, '위의 [배너 관리]에서 새 배너를 추가해 보세요'));
        cap.appendChild(cin); ph.appendChild(cap); track.appendChild(ph);
      }
      $('prev').hidden = $('next').hidden = $('dots').hidden = true;
      track.style.transform = ''; clearInterval(timer);
      return;
    }
    items.forEach(function (b, i) {
      var href = safeUrl(b['링크']);
      var s2 = el(href ? 'a' : 'div', 'slide');
      if (href) { s2.href = href; if (new URL(href).origin !== location.origin) { s2.target = '_blank'; s2.rel = 'noopener'; } }
      var dk = document.documentElement.getAttribute('data-theme') === 'dark';
      var im = imgUrl(dk && b['야간이미지'] ? b['야간이미지'] : b['이미지']);
      if (im) {
        var img = el('img', 'slide-img'); img.alt = b['제목'] || ''; img.loading = i ? 'lazy' : 'eager'; img.src = im;
        img.onerror = function () { img.remove(); s2.classList.add('plain'); };
        s2.appendChild(img);
      } else s2.classList.add('plain');
      if (b['제목'] || b['부제']) {
        var cap2 = el('div', 'cap'), inn = el('div', 'wrap cap-in');
        if (b['제목']) inn.appendChild(el('strong', null, b['제목']));
        if (b['부제']) inn.appendChild(el('span', null, b['부제']));
        cap2.appendChild(inn); s2.appendChild(cap2);
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
    Array.prototype.forEach.call($('track').children, function (s, k) { s.classList.toggle('active', k === slideIdx); });
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

  /* ---- 교회 일정: D-day 카드 / 목록형 / 달력형 (관리자가 고름) ---- */
  var calMonth = null, calSel = null, LASTDD = null;
  function ddMode(s) { var m = (s['일정표시방식'] || '').trim(); return (m === 'list' || m === 'calendar') ? m : 'dday'; }
  function ddLabel(diff) { return diff === 0 ? 'D-DAY' : diff > 0 ? 'D-' + diff : 'D+' + (-diff); }
  function dateText(dt) { return dt.getFullYear() + '.' + (dt.getMonth() + 1) + '.' + dt.getDate() + ' (' + '일월화수목금토'[dt.getDay()] + ')'; }
  function redrawDday() { if (LASTDD) renderDday(LASTDD.list, LASTDD.s); }

  function collectItems(list, s, mode) {
    var t = today(), showPast = (s['지난일정표시'] || '').trim() !== '' && show(s['지난일정표시']), items = [];
    list.forEach(function (d) {
      var dt = parseDate(d['날짜']); if (!dt) return;
      var hidden = !show(d['표시']), diff = Math.round((dt - t) / DAY);
      // 달력형은 지난 일정도 달력에 남겨 둠 (숨김 처리한 일정만 제외)
      if (!ADMIN && (hidden || (mode !== 'calendar' && diff < 0 && !showPast))) return;
      items.push({ d: d, dt: dt, diff: diff, hidden: hidden });
    });
    items.sort(function (a, b) { return a.dt - b.dt; });
    return items;
  }

  // 일정 한 줄/한 칸 (D-day 카드·목록형·달력 아래 목록이 함께 사용)
  function ddItem(it, s, idx) {
    // 일정에 개별 링크가 있으면 그 주소로, 없으면 설정의 '일정게시판링크'(공통 게시판)로 연결
    var href = safeUrl(it.d['링크']) || safeUrl(s['일정게시판링크']);
    var li = el('li', 'dd' + (it.diff === 0 ? ' today' : '') + (it.diff < 0 ? ' past' : '') + (it.diff > 0 && it.diff <= 7 ? ' soon' : '') + ((it.hidden || it.over) ? ' hid' : ''));
    var box = el(href ? 'a' : 'div', 'dd-in'); if (href) { box.href = href; box.target = '_blank'; box.rel = 'noopener'; }
    box.appendChild(el('span', 'dd-ico', it.d['아이콘'] || '📌'));
    box.appendChild(el('span', 'dd-name', it.d['이름']));
    box.appendChild(el('span', 'dd-date', dateText(it.dt)));
    var cnt = el('strong', 'dd-count', ddLabel(it.diff));
    if (it.diff > 0) cnt.setAttribute('data-n', it.diff);
    box.appendChild(cnt);
    if (href) box.appendChild(el('span', 'dd-more', '게시판 보기 ›'));
    li.appendChild(box);
    reveal(li, 'dd:' + it.d['이름'] + it.d['날짜'], idx);
    if (ADMIN) {
      if (it.hidden) li.appendChild(el('span', 'badge', '숨김'));
      else if (it.over) li.appendChild(el('span', 'badge', '개수 제한으로 숨김'));
      else if (it.diff < 0) li.appendChild(el('span', 'badge', '지난 일정'));
      var ed = btn('✏️', 'adm-edit', function () { openDdayForm(it.d); });
      ed.title = '수정'; ed.setAttribute('aria-label', it.d['이름'] + ' 수정');
      li.appendChild(ed);
    }
    return li;
  }

  function renderDday(list, s) {
    LASTDD = { list: list, s: s };
    var mode = ddMode(s), items = collectItems(list, s, mode), max = parseInt(s['일정최대개수'], 10) || 0;
    var ul = $('ddayList'), cal = $('ddayCal');
    ul.textContent = ''; ul.className = 'dday-list' + (mode === 'list' ? ' is-list' : '');
    $('ddaySec').hidden = items.length === 0 && !ADMIN;
    if (cal) { cal.textContent = ''; cal.hidden = mode !== 'calendar'; }
    if (mode === 'calendar') { ul.hidden = true; renderCalendar(items, s); return; }
    ul.hidden = false;
    if (!ADMIN && max > 0) items = items.slice(0, max);
    items.forEach(function (it, i) { it.over = ADMIN && max > 0 && i >= max; ul.appendChild(ddItem(it, s, i)); });
  }

  function renderCalendar(items, s) {
    var host = $('ddayCal');
    if (!host) { host = el('div', 'cal'); host.id = 'ddayCal'; $('ddayList').insertAdjacentElement('afterend', host); }
    host.hidden = false; host.textContent = '';
    var now = today();
    if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    var y = calMonth.getFullYear(), mo = calMonth.getMonth();
    function go(m) { calMonth = new Date(y, mo + m, 1); calSel = null; redrawDday(); }

    var head = el('div', 'cal-head');
    var pv = btn('‹', 'cal-nav', function () { go(-1); }); pv.setAttribute('aria-label', '이전 달');
    var nx = btn('›', 'cal-nav', function () { go(1); }); nx.setAttribute('aria-label', '다음 달');
    head.appendChild(pv); head.appendChild(el('strong', 'cal-title', y + '년 ' + (mo + 1) + '월')); head.appendChild(nx);
    head.appendChild(btn('이번 달', 'btn sm light cal-now', function () { calMonth = new Date(now.getFullYear(), now.getMonth(), 1); calSel = null; redrawDday(); }));
    host.appendChild(head);

    var byDay = {};
    items.forEach(function (it) { var k = fmtDate(it.dt); (byDay[k] = byDay[k] || []).push(it); });
    var grid = el('div', 'cal-grid');
    '일월화수목금토'.split('').forEach(function (w, i) { grid.appendChild(el('div', 'cal-wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), w)); });
    var first = new Date(y, mo, 1), off = first.getDay(), days = new Date(y, mo + 1, 0).getDate(), total = Math.ceil((off + days) / 7) * 7;
    for (var i = 0; i < total; i++) {
      var d = i - off + 1, col = i % 7;
      if (d < 1 || d > days) { grid.appendChild(el('div', 'cal-day other')); continue; }
      (function (d, col) {
        var dt = new Date(y, mo, d), key = fmtDate(dt), evs = byDay[key] || [];
        var cell = el('div', 'cal-day' + (col === 0 ? ' sun' : col === 6 ? ' sat' : '') + (key === fmtDate(now) ? ' today' : '') + (evs.length ? ' has' : '') + (calSel === key ? ' sel' : ''));
        cell.appendChild(el('span', 'n', String(d)));
        var box = el('div', 'cal-evs');
        evs.slice(0, 2).forEach(function (it) {
          var href = safeUrl(it.d['링크']) || safeUrl(s['일정게시판링크']);
          var c = ADMIN ? btn(it.d['이름'], 'cal-ev', function () { openDdayForm(it.d); })
            : el(href ? 'a' : 'span', 'cal-ev', it.d['이름']);
          if (!ADMIN && href) { c.href = href; c.target = '_blank'; c.rel = 'noopener'; }
          if (it.diff < 0) c.classList.add('past');
          if (it.hidden) c.classList.add('hid');
          c.title = it.d['이름']; box.appendChild(c);
        });
        if (evs.length > 2) box.appendChild(el('span', 'cal-more', '+' + (evs.length - 2) + '개'));
        cell.appendChild(box);
        if (ADMIN) {
          var add = btn('＋', 'cal-add', function () { openDdayForm(null, key); });
          add.title = key + ' 일정 추가'; add.setAttribute('aria-label', d + '일 일정 추가'); cell.appendChild(add);
        }
        if (evs.length) {
          cell.tabIndex = 0; cell.setAttribute('role', 'button'); cell.setAttribute('aria-label', (mo + 1) + '월 ' + d + '일 일정 ' + evs.length + '개 보기');
          var pick = function () { calSel = (calSel === key ? null : key); redrawDday(); };
          cell.addEventListener('click', function (e) { if (e.target.closest('a,button')) return; pick(); });
          cell.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
        }
        grid.appendChild(cell);
      })(d, col);
    }
    host.appendChild(grid);

    // 달력 아래: 고른 날(없으면 그 달 전체)의 일정 목록
    var shown = items.filter(function (it) { return calSel ? fmtDate(it.dt) === calSel : (it.dt.getFullYear() === y && it.dt.getMonth() === mo); });
    var sub = el('div', 'cal-sub');
    var sd = calSel ? parseDate(calSel) : null;
    sub.appendChild(el('span', null, sd ? (sd.getMonth() + 1) + '월 ' + sd.getDate() + '일 일정' : (mo + 1) + '월 일정'));
    if (calSel) sub.appendChild(btn('이 달 전체 보기', 'btn sm light', function () { calSel = null; redrawDday(); }));
    host.appendChild(sub);
    if (!shown.length) host.appendChild(el('p', 'cal-empty', '등록된 일정이 없습니다.'));
    else {
      var ul2 = el('ul', 'dday-list is-list');
      shown.forEach(function (it, i) { ul2.appendChild(ddItem(it, s, i)); });
      host.appendChild(ul2);
    }
  }

  /* ---- 앱 목록 ---- */
  var APPS = [], CATS = [], cat = '전체';
  // 링크 박스의 색·투명도·글자색 적용 (시트의 '배경색' '투명도' '글자색' 칸)
  function hexRgb(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
  // 색·투명도·글자색 값으로 배경과 글자색을 계산 (앱 박스와 카테고리 상자가 함께 사용)
  function calcStyle(o) {
    var c = (o['배경색'] || '').trim(), hasC = /^#[0-9a-f]{6}$/i.test(c);
    var op = Math.min(100, Math.max(10, num(o['투명도'], 100)));
    if (!hasC && op >= 100) return null;
    var tc = (o['글자색'] || '').trim(), color = '', bg;
    if (hasC) {
      var rgb = hexRgb(c), lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      bg = 'rgba(' + rgb.join(',') + ',' + (op / 100) + ')';
      if (op >= 50) color = lum < 0.6 ? '#ffffff' : '#1d2421';
    } else {
      bg = 'color-mix(in srgb, var(--card) ' + op + '%, transparent)';
    }
    if (tc === 'light') color = '#ffffff'; else if (tc === 'dark') color = '#1d2421';
    return { bg: bg, color: color };
  }
  function styleCard(card, a) {
    var s = calcStyle(a); if (!s) return;
    card.classList.add('custom'); card.style.background = s.bg;
    if (s.color) { card.style.color = s.color; card.classList.add('tinted'); }
  }
  function styleBox(box, o) {   // 카테고리 상자(제목 + 앱 칸 전체)
    var s = calcStyle(o); if (!s) return;
    box.classList.add('catbox'); box.style.background = s.bg;
    if (s.color) { box.style.color = s.color; box.classList.add('tinted'); }
  }
  function catInfo(name) {
    var l = DATA.categories || [];
    for (var i = 0; i < l.length; i++) if ((l[i]['이름'] || '').trim() === name) return l[i];
    return {};
  }
  function prepApps(list) {
    APPS = list.filter(function (a) { return a['이름'] && (ADMIN || (show(a['표시']) && safeUrl(a['링크']))); })
      .map(function (a, i) { a._i = i; a._cat = a['카테고리'] || '기타'; return a; })
      .sort(function (a, b) { return byOrder(a, b) || a._i - b._i; });
    CATS = [];
    APPS.forEach(function (a) { if (CATS.indexOf(a._cat) < 0) CATS.push(a._cat); });
    var chips = $('chips'); chips.textContent = '';
    ['전체'].concat(CATS).forEach(function (c, ci) {
      var b = el('button', 'chip', c); b.type = 'button'; b.setAttribute('role', 'tab');
      b.addEventListener('click', function () { cat = c; renderApps(); swap(); });
      reveal(b, 'chip:' + c, ci);
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
    var box = $('apps'); box.textContent = ''; box.classList.remove('skel-grid');
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
      styleBox(sec2, catInfo(c));
      var title = el('h3', 'group-title'); title.appendChild(el('span', null, c));
      if (ADMIN) {
        var mv = el('span', 'mv');
        if (canMove && cat === '전체') {
          var up = btn('▲', 'adm-mini', function () { moveCategory(c, -1); }); up.title = '카테고리를 위로';
          var dn = btn('▼', 'adm-mini', function () { moveCategory(c, 1); }); dn.title = '카테고리를 아래로';
          up.disabled = CATS.indexOf(c) === 0; dn.disabled = CATS.indexOf(c) === CATS.length - 1;
          mv.appendChild(up); mv.appendChild(dn);
        }
        var ce = btn('✏️ 카테고리 수정', 'btn sm ghost', function () { openCategoryForm(c); });
        ce.setAttribute('aria-label', c + ' 카테고리 수정');
        mv.appendChild(ce); title.appendChild(mv);
      }
      reveal(title, 'gt:' + c, 0);
      sec2.appendChild(title);
      var grid = el('div', 'grid');
      groups[c].forEach(function (a, idx) {
        var cell = el('div', 'cell' + (!show(a['표시']) ? ' hid' : ''));
        reveal(cell, 'app:' + (a.ID || a['이름']), idx % 3);
        var href = safeUrl(a['링크']);
        var card = el('a', 'app'); if (href) card.href = href;
        styleCard(card, a);
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
  // 카테고리를 바꾸거나 검색할 때 목록이 부드럽게 바뀌는 효과
  function swap() { var a = $('apps'); a.classList.remove('swap'); void a.offsetWidth; a.classList.add('swap'); }
  $('search').addEventListener('input', function () { renderApps(); swap(); });
  // 처음 불러오는 동안 빈 화면 대신 깜빡이는 자리표시
  function showSkeleton() {
    $('bannerSec').hidden = false; $('track').appendChild(el('div', 'slide skel'));
    var box = $('apps'); box.classList.add('skel-grid');
    for (var i = 0; i < 6; i++) box.appendChild(el('div', 'skel skel-card'));
  }

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
    $('logoTools').textContent = '';
    document.body.classList.toggle('is-admin', ADMIN);
    if (!ADMIN) return;
    bar.textContent = '';
    var in2 = el('div', 'wrap adminbar-in');
    in2.appendChild(el('span', 'adminbar-t', '🔧 관리자 모드 — ✏️ 를 눌러 수정하고, ▲▼ 로 순서를 바꾸세요'));
    var r = el('span', 'adminbar-r');
    r.appendChild(btn('⚙️ 화면 설정', 'btn sm light', openSettingsForm));
    r.appendChild(btn('로그아웃', 'btn sm ghost-w', function () { logout(); }));
    in2.appendChild(r); bar.appendChild(in2);
    var lt = $('logoTools'); lt.textContent = '';
    lt.appendChild(btn('🖼 로고', 'btn sm ghost', openLogoForm));
    $('bannerTools').appendChild(btn('🖼 배너 관리', 'btn sm', openBannerManager));
    $('ddayTools').appendChild(btn('＋ 일정 추가', 'btn sm light', function () { openDdayForm(null); }));
    $('ddayTools').appendChild(btn('🧩 보기 방식', 'btn sm light', openDdayViewForm));
    $('appsTools').appendChild(btn('＋ 앱 추가', 'btn sm', function () { openAppForm(null); }));
    layoutVars();
  }
  // 머리글(+관리자 띠) 높이를 CSS가 알 수 있게 알려줍니다 (고정 메뉴가 서로 겹치지 않게)
  function layoutVars() {
    var t = document.querySelector('.top'), ab = $('adminBar'), r = document.documentElement.style;
    r.setProperty('--topH', t.offsetHeight + 'px');
    r.setProperty('--abH', (ab.hidden ? 0 : ab.offsetHeight) + 'px');
  }
  window.addEventListener('resize', layoutVars);
  window.addEventListener('load', layoutVars);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(layoutVars);
    ro.observe(document.querySelector('.top')); ro.observe($('adminBar'));
  }
  layoutVars();
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
    var prev = el('img', 'imgf-prev' + (o.bg ? ' bg-' + o.bg : '')); prev.alt = ''; prev.hidden = true;
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
      var rowU = el('div', 'imgf-row'); rowU.appendChild(up); rowU.appendChild(file);
      rowU.appendChild(btn('지우기', 'btn sm ghost', function () { url.value = ''; sync(); }));
      rowU.appendChild(prev);
      w.appendChild(rowU);
    }
    if (o.hint) w.appendChild(el('small', 'mf-h', o.hint));
    return { node: w, get: function () { return url.value.trim(); }, kind: 'image' };
  }

  // 링크 박스 모양 편집: 색 고르기 + 투명도 + 글자색 + 미리보기
  function fStyle(a, o) {
    o = o || {};   // o.cat: 카테고리 상자 모양 편집 (미리보기와 안내 문구가 달라짐)
    var SW = ['#1f5e3b', '#2f7d52', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#f59e0b', '#64748b', '#111827', '#dcfce7', '#dbeafe', '#fef3c7'];
    var st = {
      bg: /^#[0-9a-f]{6}$/i.test(a['배경색'] || '') ? a['배경색'].toLowerCase() : '',
      op: Math.min(100, Math.max(10, num(a['투명도'], 100))),
      tc: (a['글자색'] === 'light' || a['글자색'] === 'dark') ? a['글자색'] : ''
    };
    var w = el('div', 'mf'); w.appendChild(el('span', 'mf-l', o.cat ? '카테고리 상자 모양 (색 · 투명도)' : '박스 모양 (색 · 투명도)'));
    var stage = el('div', 'style-stage');
    var pv = el('div', o.cat ? 'pvbox' : 'app pv');
    var pi = el('span', 'app-ico', '🔗'), px = el('span', 'app-tx');
    px.appendChild(el('strong', null, o.cat ? '앱 이름' : '앱 이름 미리보기')); px.appendChild(el('small', null, '이렇게 보입니다'));
    var mini = el('div', 'app'); mini.appendChild(pi); mini.appendChild(px);
    if (o.cat) { pv.appendChild(el('h3', 'group-title', '카테고리 이름 미리보기')); var gm = el('div', 'grid'), cm = el('div', 'cell'); cm.appendChild(mini); gm.appendChild(cm); pv.appendChild(gm); }
    else { pv.appendChild(pi); pv.appendChild(px); }
    stage.appendChild(pv); w.appendChild(stage);

    var sw = el('div', 'sw-row'), colorIn = el('input'); colorIn.type = 'color'; colorIn.value = st.bg || '#2f7d52'; colorIn.setAttribute('aria-label', '직접 색 고르기');
    function update() {
      pv.className = o.cat ? 'pvbox' : 'app pv'; pv.removeAttribute('style');
      (o.cat ? styleBox : styleCard)(pv, { '배경색': st.bg, '투명도': st.op, '글자색': st.tc });
      sw.querySelectorAll('.sw').forEach(function (b) { b.classList.toggle('on', b.dataset.c === st.bg); });
    }
    sw.appendChild(btn('기본색', 'btn sm ghost', function () { st.bg = ''; update(); }));
    SW.forEach(function (c) {
      var b = btn('', 'sw', function () { st.bg = c; colorIn.value = c; update(); });
      b.dataset.c = c; b.style.background = c; b.title = c; b.setAttribute('aria-label', '색 ' + c); sw.appendChild(b);
    });
    colorIn.addEventListener('input', function () { st.bg = colorIn.value.toLowerCase(); update(); });
    sw.appendChild(colorIn); w.appendChild(sw);

    var opRow = el('label', 'op-row'), opL = el('span', null, '투명도 ' + st.op + '%');
    var rg = el('input'); rg.type = 'range'; rg.min = 10; rg.max = 100; rg.step = 5; rg.value = st.op;
    rg.addEventListener('input', function () { st.op = +rg.value; opL.textContent = '투명도 ' + st.op + '%'; update(); });
    opRow.appendChild(opL); opRow.appendChild(rg); w.appendChild(opRow);

    var tcRow = el('label', 'op-row'); tcRow.appendChild(el('span', null, '글자색'));
    var tcs = el('select'); [['', '자동 (색에 맞춰)'], ['dark', '진하게'], ['light', '밝게']].forEach(function (o) {
      var op = el('option', null, o[1]); op.value = o[0]; tcs.appendChild(op);
    });
    tcs.value = st.tc; tcs.addEventListener('change', function () { st.tc = tcs.value; update(); });
    tcRow.appendChild(tcs); w.appendChild(tcRow);

    var all = el('label', 'mf check'), ci = el('input'); ci.type = 'checkbox';
    all.appendChild(ci); all.appendChild(el('span', null, o.cat ? '이 카테고리 안의 모든 앱 박스에도 같은 모양 적용' : '같은 카테고리의 모든 앱에도 이 모양 적용'));
    w.appendChild(all);
    update();
    return { node: w, get: function () { return { bg: st.bg, op: st.op >= 100 ? '' : String(st.op), tc: st.tc, applyCat: ci.checked }; } };
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
      { k: '__style', f: fStyle(a) },
      { k: '표시', f: fCheck('화면에 보이기 (끄면 숨겨집니다)', isNew ? true : show(a['표시'])) },
      { k: '새창', f: fCheck('새 창(탭)에서 열기', isNew ? true : show(a['새창'] || 'Y')) }
    ], {
      onSave: function (v) {
        var st = v.__style; delete v.__style;
        v['배경색'] = st.bg; v['투명도'] = st.op; v['글자색'] = st.tc;
        if (a.ID) v.ID = a.ID;
        return saveItem('apps', v).then(function () {
          if (!st.applyCat) return;
          var ids = (DATA.apps || []).filter(function (x) { return (x['카테고리'] || '기타') === v['카테고리'] && x.ID; })
            .map(function (x) { return x.ID; });
          if (ids.length < 2) return;
          return call({ action: 'style', ids: ids, values: { '배경색': st.bg, '투명도': st.op, '글자색': st.tc } }).then(applyData);
        });
      },
      onDelete: a.ID ? function () { return deleteItem('apps', a.ID); } : null
    });
  }
  // 카테고리 이름 바꾸기 + 상자 색·투명도 (안의 앱은 새 이름으로 자동 이동)
  function openCategoryForm(name) {
    var info = catInfo(name);
    formModal('카테고리 수정', [
      { k: '이름', f: fText('카테고리 이름', name, { req: true, max: 30, hint: '이미 있는 다른 카테고리 이름으로 바꾸면 두 카테고리가 하나로 합쳐집니다.' }) },
      { k: '__style', f: fStyle(info, { cat: true }) }
    ], {
      onSave: function (v) {
        var st = v.__style, newName = v['이름'];
        return call({ action: 'catSave', name: name, values: { '이름': newName, '배경색': st.bg, '투명도': st.op, '글자색': st.tc } })
          .then(applyData).then(function () {
            if (!st.applyCat) return;
            var ids = (DATA.apps || []).filter(function (x) { return (x['카테고리'] || '기타') === newName && x.ID; })
              .map(function (x) { return x.ID; });
            if (!ids.length) return;
            return call({ action: 'style', ids: ids, values: { '배경색': st.bg, '투명도': st.op, '글자색': st.tc } }).then(applyData);
          });
      }
    });
  }
  // 교회 일정 보기 방식 고르기 (D-day 카드 / 목록형 / 달력형) + 보여 줄 개수
  function openDdayViewForm() {
    var s = S(), cur = ddMode(s), picked = cur;
    var MODES = [
      ['dday', 'D-day 카드', '남은 날짜를 큰 숫자로 보여 줍니다.'],
      ['list', '목록형', '날짜 · 이름 · D-day를 한 줄씩 차례로 보여 줍니다.'],
      ['calendar', '달력형', '한 달 달력에 일정을 표시하고, 날짜를 누르면 아래에 목록이 나옵니다.']
    ];
    var w = el('div', 'mf'); w.appendChild(el('span', 'mf-l', '일정을 보여 주는 방식'));
    var cards = el('div', 'vm-list');
    MODES.forEach(function (m) {
      var lab = el('label', 'vm-card' + (m[0] === cur ? ' on' : ''));
      var r = el('input'); r.type = 'radio'; r.name = 'vmode'; r.value = m[0]; r.checked = m[0] === cur;
      r.addEventListener('change', function () {
        picked = m[0];
        cards.querySelectorAll('.vm-card').forEach(function (c) { c.classList.toggle('on', c.querySelector('input').value === picked); });
      });
      var pv = el('div', 'vm-prev vm-p-' + m[0]);
      if (m[0] === 'dday') ['D-37', 'D-43', 'D-46'].forEach(function (t) { pv.appendChild(el('span', 'vp-box', t)); });
      else if (m[0] === 'list') for (var i = 0; i < 3; i++) pv.appendChild(el('span', 'vp-row'));
      else for (var j = 0; j < 21; j++) pv.appendChild(el('span', 'vp-cell' + ([3, 9, 16].indexOf(j) >= 0 ? ' has' : '')));
      var tx = el('div'); tx.appendChild(el('b', null, m[1])); tx.appendChild(el('small', null, m[2]));
      lab.appendChild(r); lab.appendChild(pv); lab.appendChild(tx); cards.appendChild(lab);
    });
    w.appendChild(cards);
    formModal('교회 일정 보기 방식', [
      { k: '__mode', f: { node: w, get: function () { return picked; } } },
      { k: '일정최대개수', f: fText('화면에 보여 줄 일정 개수', s['일정최대개수'] || '0', { type: 'number', hint: '0 = 모두 보이기. 날짜가 가까운 일정부터 보입니다. (달력형에는 적용되지 않습니다)' }) }
    ], {
      validate: function (v) { var n = Number(v['일정최대개수'] || 0); if (isNaN(n) || n < 0 || n > 50) return '일정 개수는 0~50 사이로 입력해 주세요.'; },
      onSave: function (v) { calSel = null; return saveSettings({ '일정표시방식': v.__mode, '일정최대개수': v['일정최대개수'] || '0' }); }
    });
  }
  function openDdayForm(d, preDate) {
    var isNew = !d; d = d || {};
    if (isNew && preDate) d = { '날짜': preDate };
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
      { k: '이미지', f: fImage('배너 사진 (주간 · 기본)', b['이미지'], { max: 1600 }) },
      { k: '야간이미지', f: fImage('야간 모드 배너 사진 (선택)', b['야간이미지'], { max: 1600, bg: 'dark', hint: '비워 두면 위의 사진을 야간에도 그대로 씁니다.' }) },
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
      { k: '__logo', f: { node: el('p', 'mf-note', '로고 이미지는 왼쪽 위의 [🖼 로고] 버튼에서 바꿉니다.'), get: function () { return ''; } } }
    ], { onSave: function (v) { delete v.__logo; return saveSettings(v); } });
  }
  // 로고 바꾸기: 주간(밝은 화면)용 / 야간(어두운 화면)용을 따로 올릴 수 있음
  function openLogoForm() {
    var s = S();
    formModal('로고 설정', [
      { k: '로고', f: fImage('주간(밝은 화면) 로고', s['로고'], { max: 800, bg: 'light', hint: '비워 두면 기본 한빛은혜교회 로고를 씁니다.' }) },
      { k: '야간로고', f: fImage('야간(어두운 화면) 로고', s['야간로고'], { max: 800, bg: 'dark', hint: '비워 두면 주간 로고를 흰 받침 위에 보여 줍니다. 글자가 흰색인 로고 파일을 올리면 야간에 더 깔끔합니다.' }) }
    ], {
      note: '배경이 투명한 PNG, 가로로 긴 로고가 가장 깔끔합니다. 저장한 뒤 위쪽 주간/야간 버튼을 눌러 두 화면을 모두 확인해 보세요.',
      onSave: function (v) { return saveSettings({ '로고': v['로고'], '야간로고': v['야간로고'] }); }
    });
  }

  /* ================= 시작 ================= */
  function setStatus(t) { $('status').textContent = t || ''; }
  // 고정 영역도 스크롤하면 부드럽게 나타나게
  reveal($('bannerSec'), 'sec:banner', 0);
  document.querySelectorAll('.sec-head').forEach(function (h, i) { reveal(h, 'sec:head' + i, 0); });
  reveal(document.querySelector('.foot'), 'sec:foot', 0);
  var cached = readCache();
  if (cached && (API || CFG.SHEET_ID)) { DATA = cached; render(); }

  if (!API && !CFG.SHEET_ID) {
    DATA = window.SAMPLE_DATA; render();
    setStatus('예시 화면입니다. config.js에 구글시트 연결 정보를 넣으면 실제 내용이 나옵니다.');
  } else {
    if (!DATA) showSkeleton();
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
