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
  var DATA = null, ADMIN = false, PW = '', PENDING = 0;
  var MEMBER = { token: '', name: '' };   // 승인된 교인으로 로그인한 상태 (브라우저에 보관)
  try { MEMBER.token = localStorage.getItem('memberToken') || ''; MEMBER.name = localStorage.getItem('memberName') || ''; localStorage.removeItem('portalCache'); } catch (e) { }
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
  // 앱을 눌렀을 때 열리는 것: link(링크 주소) / image(이미지 파일) / pdf(PDF 파일)
  function appKind(a) { var k = (a['종류'] || '').trim(); return (k === 'image' || k === 'pdf') ? k : 'link'; }
  function isLocked(a) { return a.locked === '1' || a.locked === 1 || a.locked === true; }
  function appUrl(a) { return appKind(a) === 'link' ? safeUrl(a['링크']) : safeUrl(a['파일']); }
  function driveId(u) { var m = (u || '').match(/drive\.google\.com\/(?:file\/d\/|(?:open|uc|thumbnail)\?[^#]*id=)([\w-]+)/); return m ? m[1] : ''; }

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
  function fetchPublic() {   // 누구나 받는 데이터 (교인 전용 내용은 서버가 빼고 보냄)
    return fetch(API + (API.indexOf('?') < 0 ? '?' : '&') + 'action=data', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j.ok) throw new Error(j.error || '오류'); return j.data; });
  }
  function fetchLive() {
    if (API) {
      if (MEMBER.token) {   // 로그인한 교인: 교인 전용 내용까지 받음
        return mcall({ action: 'memberData', token: MEMBER.token })
          .then(function (j) { if (j.name) MEMBER.name = j.name; saveMember(); return j.data; })
          .catch(function (err) { if (err.expired) { memberClear(); toast('교인 로그인이 만료되었습니다. 다시 로그인해 주세요.', 'err'); return fetchPublic(); } throw err; });
      }
      return fetchPublic();
    }
    return Promise.all([fetchTab(TABS.settings), fetchTab(TABS.banners), fetchTab(TABS.dday), fetchTab(TABS.apps)])
      .then(function (r) { return { settings: r[0], banners: r[1], dday: r[2], apps: r[3] }; });
  }
  // 저장해 두는 내용은 '누구나 보는 내용'뿐입니다. (관리자·교인 전용 내용은 브라우저에 남기지 않음)
  function readCache() { try { return JSON.parse(localStorage.getItem('portalCache2') || 'null'); } catch (e) { return null; } }
  function writeCache(d) { if (ADMIN || MEMBER.token) return; try { localStorage.setItem('portalCache2', JSON.stringify(d)); } catch (e) { } }
  function refreshData() { fetchLive().then(function (d) { DATA = d; writeCache(d); render(); }).catch(function () { }); }
  // 로그아웃 직후, 서버 응답을 기다리는 동안에도 교인 전용·숨김 내용이 화면에 남지 않게 걸러 줌
  function publicView(d) {
    var c = JSON.parse(JSON.stringify(d || {})), vis = function (x) { return show(x['표시']); };
    c.banners = (c.banners || []).filter(vis); c.dday = (c.dday || []).filter(vis);
    c.apps = (c.apps || []).filter(vis).filter(function (a) { return (a['공개범위'] || '').trim() !== 'member-hidden'; }).map(function (a) {
      if ((a['공개범위'] || '').trim() === 'member') { a['링크'] = ''; a['파일'] = ''; a['파일명'] = ''; a.locked = '1'; }
      return a;
    });
    return c;
  }
  // 교인용 요청 (관리자 비밀번호와 무관)
  function mcall(payload) {
    return fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); }, function () { throw new Error('인터넷 연결을 확인해 주세요.'); })
      .then(function (j) { if (!j.ok) { var e = new Error(j.error || '처리하지 못했습니다.'); e.expired = j.code === 'expired'; throw e; } return j; });
  }
  function saveMember() { try { localStorage.setItem('memberToken', MEMBER.token); localStorage.setItem('memberName', MEMBER.name); } catch (e) { } }
  function memberClear() { MEMBER.token = ''; MEMBER.name = ''; try { localStorage.removeItem('memberToken'); localStorage.removeItem('memberName'); localStorage.removeItem('portalCache2'); } catch (e) { } }

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
    renderMemberNav();
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
    APPS = list.filter(function (a) { return a['이름'] && (ADMIN || (show(a['표시']) && (appUrl(a) || isLocked(a)))); })
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
        var kind = appKind(a), href = appUrl(a), locked = isLocked(a), vis = (a['공개범위'] || '').trim();
        var card = el('a', 'app'); if (href) card.href = href;
        styleCard(card, a);
        if (locked) {   // 교인 전용 앱: 비회원에게는 링크 없이 자물쇠만 보이고, 누르면 로그인 안내
          card.classList.add('locked'); card.setAttribute('role', 'button'); card.tabIndex = 0;
          var ask = function (e) { e.preventDefault(); openMemberLogin('교인 전용 앱입니다. 로그인해 주세요.'); };
          card.addEventListener('click', ask);
          card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') ask(e); });
        } else if (kind === 'link') {
          if (show(a['새창'] || 'Y')) { card.target = '_blank'; card.rel = 'noopener'; }
        } else {   // 이미지/PDF: 화면 안의 보기 창으로 열기 (Ctrl·Shift 클릭이나 길게 누르기는 브라우저 기본 동작)
          card.addEventListener('click', function (e) { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); openViewer(a); });
        }
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
        if (locked) card.appendChild(el('span', 'app-vis', '🔒 교인 전용'));
        else if ((ADMIN || MEMBER.token) && vis) card.appendChild(el('span', 'app-vis', vis === 'member-hidden' ? '🔒 교인 전용 · 비회원에겐 숨김' : '🔒 교인 전용'));
        if (kind !== 'link' && !locked) card.appendChild(el('span', 'app-kind', kind === 'pdf' ? 'PDF' : '이미지'));
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
    return call({ action: 'login' }).then(function (j) {
      ADMIN = true; PENDING = j.pending || 0;
      try { sessionStorage.setItem('adminPw', pw); } catch (e) { }
      if (j.data) DATA = j.data;   // 관리자는 교인 전용 내용까지 모두 받음 (수정할 때 값이 비어 지워지는 일이 없도록)
      render();
    }).catch(function (e) { PW = ''; throw e; });
  }
  function logout(expired) {
    ADMIN = false; PW = ''; PENDING = 0;
    try { sessionStorage.removeItem('adminPw'); localStorage.removeItem('portalCache2'); } catch (e) { }
    closeModal(); if (DATA) { DATA = publicView(DATA); render(); } refreshData();
    toast(expired ? '비밀번호가 달라 관리자 모드가 종료되었습니다.' : '관리자 모드를 종료했습니다.');
  }
  function openLogin() {
    var inp = el('input'); inp.type = 'password'; inp.autocomplete = 'current-password'; inp.placeholder = '관리자 비밀번호';
    var form = el('form', 'mform');
    var lab = el('label', 'mf'); lab.appendChild(el('span', 'mf-l', '비밀번호')); lab.appendChild(inp); form.appendChild(lab);
    form.id = 'loginForm';
    var ok = el('button', 'btn', '로그인'); ok.type = 'submit'; ok.setAttribute('form', 'loginForm');
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
    r.appendChild(btn('👥 교인 관리' + (PENDING ? ' (' + PENDING + ')' : ''), 'btn sm light', openMemberManager));
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
  // PDF 올리기 (10MB 이하)
  function uploadPdf(file) {
    if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('PDF는 10MB 이하만 올릴 수 있습니다. (이 파일: ' + (file.size / 1048576).toFixed(1) + 'MB)'));
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(',')[1]); };
      fr.onerror = function () { rej(new Error('파일을 읽을 수 없습니다.')); };
      fr.readAsDataURL(file);
    }).then(function (b64) { return call({ action: 'upload', name: file.name, mime: 'application/pdf', data: b64 }); })
      .then(function (j) { return j.url; });
  }

  // 앱을 눌렀을 때 열릴 것 고르기: 링크 주소 / 이미지 파일 / PDF 파일
  function fTarget(a) {
    var cur = appKind(a);
    var st = { type: cur, link: cur === 'link' ? (a['링크'] || '') : '', file: cur !== 'link' ? (a['파일'] || '') : '', fname: a['파일명'] || '' };
    var w = el('div', 'mf'); w.appendChild(el('span', 'mf-l', '누르면 열리는 것 *'));
    var seg = el('div', 'seg');
    var linkP = el('div', 'fpanel'), fileP = el('div', 'fpanel');
    // 링크 칸
    var linkIn = el('input'); linkIn.type = 'text'; linkIn.value = st.link; linkIn.placeholder = 'https://...'; linkIn.setAttribute('aria-label', '연결할 주소');
    linkP.appendChild(linkIn);
    // 파일 칸
    var nameEl = el('div', 'fname'), prev = el('img', 'fprev'); prev.alt = ''; prev.hidden = true;
    var fileIn = el('input'); fileIn.type = 'file'; fileIn.hidden = true;
    var upBtn = btn('📎 파일 올리기', 'btn sm', function () { fileIn.click(); });
    var clr = btn('지우기', 'btn sm ghost', function () { st.file = ''; st.fname = ''; urlIn.value = ''; refresh(); });
    var row = el('div', 'imgf-row'); row.appendChild(upBtn); row.appendChild(clr); row.appendChild(fileIn);
    var urlIn = el('input'); urlIn.type = 'text'; urlIn.value = st.file; urlIn.placeholder = '또는 파일 주소 직접 입력'; urlIn.setAttribute('aria-label', '파일 주소');
    urlIn.addEventListener('input', function () { st.file = urlIn.value.trim(); if (!st.file) st.fname = ''; refresh(); });
    var hint = el('small', 'mf-h');
    fileP.appendChild(nameEl); fileP.appendChild(row); fileP.appendChild(prev); fileP.appendChild(urlIn); fileP.appendChild(hint);
    function refresh() {
      nameEl.textContent = st.file ? '📎 ' + (st.fname || '올려진 파일 (주소 입력)') : '아직 올린 파일이 없습니다.';
      var id = driveId(st.file), u = (st.type === 'image' && st.file) ? (id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400' : safeUrl(st.file)) : '';
      prev.hidden = !u; if (u) prev.src = u;
    }
    function apply() {
      linkP.hidden = st.type !== 'link'; fileP.hidden = st.type === 'link';
      seg.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === st.type); b.setAttribute('aria-pressed', String(b.dataset.t === st.type)); });
      fileIn.accept = st.type === 'pdf' ? 'application/pdf,.pdf' : 'image/*';
      hint.textContent = st.type === 'pdf' ? 'PDF는 10MB 이하만 올릴 수 있습니다. 올린 파일은 구글 드라이브의 "한빛포털_이미지" 폴더에 저장됩니다.' : '사진은 자동으로 크기가 줄어서 올라갑니다. 올린 파일은 구글 드라이브의 "한빛포털_이미지" 폴더에 저장됩니다.';
      refresh();
    }
    [['link', '🔗 링크 주소'], ['image', '🖼 이미지 파일'], ['pdf', '📄 PDF 파일']].forEach(function (t) {
      var b = el('button', null, t[1]); b.type = 'button';
      b.addEventListener('click', function () {
        if (st.type !== 'link' && t[0] !== 'link' && st.type !== t[0]) { st.file = ''; st.fname = ''; urlIn.value = ''; }   // 이미지 ↔ PDF 로 바꾸면 올린 파일을 비움
        st.type = t[0]; apply();
      });
      b.dataset.t = t[0]; seg.appendChild(b);
    });
    fileIn.addEventListener('change', function () {
      var f = fileIn.files[0]; if (!f) return;
      var isPdf = st.type === 'pdf';
      if (isPdf ? !(f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) : !/^image\//.test(f.type)) { toast(isPdf ? 'PDF 파일을 골라 주세요.' : '이미지 파일을 골라 주세요.', 'err'); fileIn.value = ''; return; }
      upBtn.disabled = true; upBtn.textContent = '올리는 중…'; busy(true);
      (isPdf ? uploadPdf(f) : uploadImage(f, 2000)).then(function (u) { st.file = u; st.fname = f.name; urlIn.value = u; refresh(); toast('파일이 올라갔습니다.'); })
        .catch(function (e) { toast(e.message, 'err'); })
        .then(function () { upBtn.disabled = false; upBtn.textContent = '📎 파일 올리기'; busy(false); fileIn.value = ''; });
    });
    w.appendChild(seg); w.appendChild(linkP); w.appendChild(fileP); apply();
    return { node: w, label: '연결', get: function () { return { type: st.type, link: linkIn.value.trim(), file: st.file.trim(), fname: st.fname }; } };
  }

  // 이미지/PDF 보기 창
  function openViewer(a) {
    var kind = appKind(a), url = appUrl(a), id = driveId(url), title = a['이름'] || '파일';
    var openUrl = id ? 'https://drive.google.com/file/d/' + id + '/view' : url;
    var dlUrl = id ? 'https://drive.google.com/uc?export=download&id=' + id : url;
    var same = false; try { same = new URL(url).origin === location.origin; } catch (e) { }
    var body = el('div', 'viewer-body');
    if (kind === 'image') {
      var box = el('div', 'viewer-imgbox'), img = el('img', 'viewer-img'); img.alt = title;
      img.src = id ? 'https://drive.google.com/thumbnail?id=' + id + '&sz=w2000' : url;
      img.addEventListener('click', function () { img.classList.toggle('zoom'); });
      img.onerror = function () { box.textContent = ''; box.appendChild(el('p', 'viewer-msg', '이미지를 불러올 수 없습니다. 아래 [새 창에서 열기]를 눌러 보세요.')); };
      box.appendChild(img); body.appendChild(box);
    } else if (id || same) {   // 구글 드라이브 또는 이 홈페이지 안의 PDF 는 창 안에서 보여 줌
      var fr = el('iframe', 'viewer-frame'); fr.title = title; fr.src = id ? 'https://drive.google.com/file/d/' + id + '/preview' : url;
      body.appendChild(fr);
    } else { window.open(url, '_blank', 'noopener'); return; }   // 그 밖의 주소는 새 창으로
    var acts = [
      btn('새 창에서 열기', 'btn ghost', function () { window.open(openUrl, '_blank', 'noopener'); }),
      btn('내려받기', 'btn ghost', function () { window.open(dlUrl, '_blank', 'noopener'); }),
      btn('닫기', 'btn', closeModal)
    ];
    var m = openModal(title, body, acts, true); m.classList.add('viewer');
  }

  var FORMSEQ = 0;
  function formModal(title, fields, o) {
    var form = el('form', 'mform');
    // 저장 버튼은 팝업 아래쪽(입력 칸 묶음 밖)에 있으므로 form 속성으로 이 입력 칸들과 연결해야 눌렀을 때 저장됩니다
    form.id = 'mform' + (++FORMSEQ);
    // 입력이 잘못되었을 때 이유를 팝업 안에 계속 보여주는 칸
    var errBox = el('div', 'm-err'); errBox.hidden = true; errBox.setAttribute('role', 'alert');
    form.appendChild(errBox);
    function fail(msg) { errBox.textContent = msg; errBox.hidden = false; toast(msg, 'err'); errBox.scrollIntoView({ block: 'nearest' }); }
    fields.forEach(function (x) { form.appendChild(x.f.node); });
    if (o.note) form.appendChild(el('p', 'mf-note', o.note));
    var save = el('button', 'btn', o.submitLabel || '저장'); save.type = 'submit'; save.setAttribute('form', form.id);
    var actions = [save];
    if (o.extra) o.extra.forEach(function (b) { actions.unshift(b); });
    var del;
    if (o.onDelete) {
      del = btn('삭제', 'btn danger', function () {
        if (!confirm('정말 삭제할까요? 되돌릴 수 없습니다.')) return;
        lock(true); o.onDelete().then(function () { closeModal(); toast('삭제되었습니다.'); if (o.after) o.after(); })
          .catch(function (e) { fail(e.message); lock(false); });
      });
      actions.unshift(del);
    }
    actions.push(btn('취소', 'btn ghost', function () { closeModal(); if (o.after) o.after(); }));
    function lock(on) { busy(on); save.disabled = on; if (del) del.disabled = on; save.textContent = on ? (o.busyLabel || '저장 중…') : (o.submitLabel || '저장'); }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errBox.hidden = true;
      var vals = {};
      for (var i = 0; i < fields.length; i++) {
        var x = fields[i], v = x.f.get();
        if (x.f.req && !v) { fail('"' + x.f.label + '"을(를) 입력해 주세요.'); return; }
        if (x.f.kind === 'url' && v) {
          // 주소 앞에 https:// 를 빼먹었으면 자동으로 붙여 줍니다 (예: cafe.naver.com/hanbit)
          if (!/^https?:\/\//i.test(v) && /^[^\s\/:]+\.[^\s\/]+/.test(v)) v = 'https://' + v;
          if (!/^https?:\/\/\S+$/i.test(v)) { fail('"' + x.f.label + '"은 https:// 로 시작하는 인터넷 주소여야 합니다.'); return; }
        }
        vals[x.k] = v;
      }
      if (o.validate) { var msg = o.validate(vals); if (msg) { fail(msg); return; } }
      lock(true);
      o.onSave(vals).then(function (res) { closeModal(); if (o.successMsg !== '') toast(o.successMsg || '저장되었습니다.'); if (o.onDone) o.onDone(res); if (o.after) o.after(); })
        .catch(function (err) { fail(err.message || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'); lock(false); });
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
      { k: '__target', f: fTarget(a) },
      { k: '공개범위', f: fSelect('누가 볼 수 있나요?', (a['공개범위'] || '').trim(), [
        ['', '모두 (전체 공개)'],
        ['member', '교인만 (비회원에게는 🔒 로 보이고, 누르면 로그인 안내)'],
        ['member-hidden', '교인만 (비회원에게는 아예 보이지 않음)']
      ], '교인 전용으로 하면 비회원에게는 링크·파일 주소가 서버에서 아예 전송되지 않습니다.') },
      { k: '아이콘', f: fImage('아이콘', a['아이콘'], { emojis: true, max: 256 }) },
      { k: '__style', f: fStyle(a) },
      { k: '표시', f: fCheck('화면에 보이기 (끄면 숨겨집니다)', isNew ? true : show(a['표시'])) },
      { k: '새창', f: fCheck('새 창(탭)에서 열기', isNew ? true : show(a['새창'] || 'Y')) }
    ], {
      validate: function (v) {
        var t = v.__target;
        if (t.type === 'link') {
          if (!t.link) return '연결할 주소(링크)를 입력해 주세요.';
          if (!/^https?:\/\//i.test(t.link) && /^[^\s\/:]+\.[^\s\/]+/.test(t.link)) t.link = 'https://' + t.link;
          if (!/^https?:\/\/\S+$/i.test(t.link)) return '연결할 주소는 https:// 로 시작하는 인터넷 주소여야 합니다.';
        } else {
          if (!t.file) return (t.type === 'pdf' ? 'PDF' : '이미지') + ' 파일을 올리거나 파일 주소를 입력해 주세요.';
          if (!/^(https?:\/\/\S+|assets\/\S+)$/i.test(t.file)) return '파일 주소는 https:// 또는 assets/ 로 시작해야 합니다.';
        }
      },
      onSave: function (v) {
        var t = v.__target; delete v.__target;
        var isLink = t.type === 'link';
        v['종류'] = isLink ? '' : t.type; v['링크'] = isLink ? t.link : ''; v['파일'] = isLink ? '' : t.file; v['파일명'] = isLink ? '' : (t.fname || '');
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
      { k: '야간로고', f: fImage('야간(어두운 화면) 로고', s['야간로고'], { max: 800, bg: 'dark', hint: '비워 두면 주간 로고의 색을 자동으로 반전해서 보여 줍니다. (글씨는 밝게, 별 색은 그대로) 직접 만든 야간용 로고가 있으면 올려 주세요.' }) }
    ], {
      note: '배경이 투명한 PNG, 가로로 긴 로고가 가장 깔끔합니다. 저장한 뒤 위쪽 주간/야간 버튼을 눌러 두 화면을 모두 확인해 보세요.',
      onSave: function (v) { return saveSettings({ '로고': v['로고'], '야간로고': v['야간로고'] }); }
    });
  }

  /* ================= 홈 화면에 설치 (앱처럼 사용) ================= */
  var deferredInstall = null;
  var UA = navigator.userAgent || '';
  var IS_IOS = /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var IS_ANDROID = /android/i.test(UA), IS_KAKAO = /KAKAOTALK/i.test(UA);
  // 카카오톡·네이버·페이스북 등 '앱 안의 브라우저'에서는 홈 화면 설치가 안 됨
  var IS_INAPP = IS_KAKAO || /NAVER\(inapp|FBAN|FBAV|Instagram|Line\/|DaumApps/i.test(UA);
  var BROWSER_NAME = IS_IOS ? '사파리' : '크롬';
  var BROWSER_WITH = IS_IOS ? '사파리로' : '크롬으로';   // '~로/으로' 받침 처리
  // 카카오톡 안에서 지금 주소를 기본 브라우저(크롬/사파리)로 한 번에 열어 줌
  function openExternal() { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href.split('#')[0]); }
  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; }
  function canInstallUI() { return !isStandalone() && (!!deferredInstall || IS_IOS || IS_ANDROID || IS_INAPP); }
  function updateInstallUI() { var on = canInstallUI(); $('installBtn').hidden = !on; $('installLink').hidden = !on; }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; updateInstallUI(); });
  window.addEventListener('appinstalled', function () { deferredInstall = null; updateInstallUI(); toast('홈 화면에 설치되었습니다.'); });
  if (window.matchMedia) { var smq = matchMedia('(display-mode: standalone)'); if (smq.addEventListener) smq.addEventListener('change', updateInstallUI); }
  function installClick() {
    if (deferredInstall) {   // 크롬 등: 설치 창을 바로 띄움
      var p = deferredInstall; deferredInstall = null;
      p.prompt();
      Promise.resolve(p.userChoice).then(function (c) { if (c && c.outcome !== 'accepted') toast('나중에 다시 설치할 수 있습니다.'); })
        .catch(function () { }).then(updateInstallUI);
      return;
    }
    showInstallHelp();   // 설치 창을 띄울 수 없는 곳(아이폰, 카카오톡 안 등): 방법을 안내
  }
  function showInstallHelp() {
    var steps, note = '';
    if (IS_KAKAO) {
      steps = ['아래 [' + BROWSER_WITH + ' 열기] 버튼을 누릅니다.', '열린 화면에서 [📲 앱 설치]를 다시 눌러 설치합니다.', '버튼이 안 먹으면 화면 오른쪽 아래(또는 위)의 ⋮ 또는 … 를 눌러 ' + (IS_IOS ? '"Safari로 열기"' : '"다른 브라우저로 열기"') + '를 누르세요.'];
      note = '카카오톡 안에서 열면 설치할 수 없어요. ' + BROWSER_NAME + (IS_IOS ? '로' : '으로') + ' 열어야 합니다.';
    } else if (IS_INAPP) {
      steps = ['화면 오른쪽 위(또는 아래)의 ⋮ 또는 … 메뉴를 누릅니다.', '"다른 브라우저로 열기" 또는 "' + (IS_IOS ? 'Safari' : '크롬') + '에서 열기"를 누릅니다.', '열린 화면에서 [📲 앱 설치]를 다시 눌러 설치합니다.'];
      note = '이 앱 안에서는 설치할 수 없어요. ' + BROWSER_NAME + (IS_IOS ? '로' : '으로') + ' 열어 주세요.';
    } else if (IS_IOS) {
      steps = ['사파리 아래쪽의 공유 버튼 ⬆️ (네모에서 화살표가 나오는 모양)을 누릅니다.', '목록을 위로 올려 "홈 화면에 추가"를 누릅니다.', '오른쪽 위의 "추가"를 누르면 홈 화면에 아이콘이 생깁니다.'];
      note = '아이폰은 사파리에서만 설치할 수 있습니다. (크롬·네이버 앱 안에서는 안 돼요)';
    } else if (IS_ANDROID) {
      steps = ['크롬 오른쪽 위의 ⋮ 메뉴를 누릅니다.', '"홈 화면에 추가" 또는 "앱 설치"를 누릅니다.', '"설치"를 누르면 홈 화면에 아이콘이 생깁니다.'];
    } else {
      steps = ['주소창 오른쪽의 설치 아이콘(⊕)을 누르거나, 브라우저 메뉴에서 "앱 설치"를 선택합니다.'];
    }
    var body = el('div', 'inst');
    var ic = el('img', 'inst-ico'); ic.alt = '앱 아이콘'; ic.src = 'assets/icons/icon-192.png'; body.appendChild(ic);
    body.appendChild(el('p', null, '홈 화면에 설치하면 앱처럼 바로 열 수 있어요. 이 아이콘이 만들어집니다.'));
    var ol = el('ol'); steps.forEach(function (t) { ol.appendChild(el('li', null, t)); }); body.appendChild(ol);
    if (note) body.appendChild(el('p', 'mf-note', note));
    var acts = IS_KAKAO ? [btn(BROWSER_WITH + ' 열기', 'btn', openExternal), btn('닫기', 'btn ghost', closeModal)] : [btn('확인', 'btn', closeModal)];
    openModal('홈 화면에 설치하기', body, acts);
  }
  // 앱 안의 브라우저(카카오톡 등)로 들어왔을 때, 화면 맨 위에 자동으로 안내를 보여 줌
  function showInAppBar() {
    if (!IS_INAPP || isStandalone()) return;
    try { if (sessionStorage.getItem('inappClosed')) return; } catch (e) { }
    var bar = el('div', 'inapp-bar'); bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '설치 안내');
    bar.appendChild(el('span', 'inapp-t', IS_KAKAO ? '📲 앱처럼 설치하려면 ' + BROWSER_NAME + (IS_IOS ? '로' : '으로') + ' 열어 주세요.' : '📲 이 앱 안에서는 설치할 수 없어요. 메뉴에서 "다른 브라우저로 열기"를 눌러 주세요.'));
    if (IS_KAKAO) bar.appendChild(btn(BROWSER_WITH + ' 열기', 'btn sm light', openExternal));
    var x = btn('✕', 'inapp-x', function () { bar.remove(); try { sessionStorage.setItem('inappClosed', '1'); } catch (e) { } });
    x.setAttribute('aria-label', '닫기'); bar.appendChild(x);
    document.body.insertBefore(bar, document.body.firstChild);
  }
  $('installBtn').addEventListener('click', installClick);
  $('installLink').addEventListener('click', installClick);
  updateInstallUI();
  showInAppBar();
  // 오프라인에서도 열리도록 서비스 워커 등록 (https 또는 localhost 에서만 동작)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { }); });
  }

  /* ================= 교인 가입 · 로그인 · 관리 ================= */
  function fSelect(label, val, opts, hint) {
    var w = el('label', 'mf'); w.appendChild(el('span', 'mf-l', label));
    var sel = el('select');
    opts.forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; sel.appendChild(op); });
    sel.value = val || ''; w.appendChild(sel);
    if (hint) w.appendChild(el('small', 'mf-h', hint));
    return { node: w, get: function () { return sel.value; } };
  }
  function setAttrs(f, attrs) { var i = f.node.querySelector('input'); Object.keys(attrs).forEach(function (k) { i.setAttribute(k, attrs[k]); }); return f; }
  function phoneOk(v) { return /^01[016789]\d{7,8}$/.test(String(v || '').replace(/\D/g, '')); }

  // 화면 맨 위 메뉴 아래의 작은 줄: 교인 로그인/가입 (로그인하면 이름·비밀번호 변경·로그아웃)
  function renderMemberNav() {
    var top = document.querySelector('.top'), row = $('memberRow');
    if (!row) { row = el('div', 'member-row'); row.id = 'memberRow'; top.appendChild(row); }
    row.textContent = '';
    if (!API) { row.hidden = true; return; }
    row.hidden = false;
    var in2 = el('div', 'wrap member-in');
    if (MEMBER.token) {
      in2.appendChild(el('span', 'mn-name', '👤 ' + (MEMBER.name || '교인') + '님'));
      in2.appendChild(btn('비밀번호 변경', 'mn-link', openMemberPassword));
      in2.appendChild(btn('로그아웃', 'mn-link', memberLogout));
    } else {
      in2.appendChild(el('span', 'mn-hint', '교인이신가요?'));
      in2.appendChild(btn('교인 로그인', 'mn-link', function () { openMemberLogin(); }));
      in2.appendChild(btn('교인 가입', 'mn-link', openMemberRegister));
    }
    row.appendChild(in2);
    layoutVars();
  }
  function memberLogout() {
    memberClear();
    if (DATA && !ADMIN) { DATA = publicView(DATA); render(); }
    refreshData();
    toast('로그아웃되었습니다.');
  }

  function openMemberLogin(note) {
    var ph = setAttrs(fText('휴대폰 번호', '', { req: true, ph: '010-1234-5678', max: 13 }), { inputmode: 'tel', autocomplete: 'tel', autocapitalize: 'off' });
    var pw = setAttrs(fText('비밀번호', '', { req: true, type: 'password', max: 40 }), { autocomplete: 'current-password' });
    var reg = btn('교인 가입 신청', 'btn ghost', function () { closeModal(); openMemberRegister(); });
    formModal('교인 로그인', [{ k: 'phone', f: ph }, { k: 'password', f: pw }], {
      note: note || '교인으로 가입하고 교회의 승인을 받으면 교인 전용 앱을 볼 수 있습니다.',
      submitLabel: '로그인', busyLabel: '확인 중…', successMsg: '', extra: [reg],
      validate: function (v) { if (!phoneOk(v.phone)) return '휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)'; },
      onSave: function (v) {
        return mcall({ action: 'memberLogin', phone: v.phone, password: v.password }).then(function (j) {
          MEMBER.token = j.token; MEMBER.name = j.name; saveMember();
          if (!ADMIN && j.data) { DATA = j.data; }
          render(); return j;
        });
      },
      onDone: function () { toast((MEMBER.name || '교인') + '님, 환영합니다.'); }
    });
  }

  function openMemberRegister() {
    var nm = fText('이름', '', { req: true, max: 20 });
    var ph = setAttrs(fText('휴대폰 번호', '', { req: true, ph: '010-1234-5678', max: 13 }), { inputmode: 'tel', autocomplete: 'tel' });
    var pw = setAttrs(fText('비밀번호 (6자 이상)', '', { req: true, type: 'password', max: 40 }), { autocomplete: 'new-password' });
    var pw2 = setAttrs(fText('비밀번호 확인', '', { req: true, type: 'password', max: 40 }), { autocomplete: 'new-password' });
    var memo = fText('교인 확인용 메모 (선택)', '', { max: 80, ph: '예) 송파교구, 김철수 집사 소개', hint: '교회에서 교인인지 확인할 때 참고합니다.' });
    var agree = fCheck('개인정보 수집·이용에 동의합니다 (필수)', false);
    var hp = el('input'); hp.type = 'text'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true'); hp.className = 'hp';   // 자동 가입 프로그램(봇) 차단용 숨은 칸
    formModal('교인 가입 신청', [
      { k: 'name', f: nm }, { k: 'phone', f: ph }, { k: 'password', f: pw }, { k: 'password2', f: pw2 }, { k: 'memo', f: memo },
      { k: 'agree', f: agree }, { k: 'website', f: { node: hp, get: function () { return hp.value; } } }
    ], {
      note: '수집 항목: 이름, 휴대폰 번호, 비밀번호(암호화되어 저장), 확인용 메모. 교인 확인과 교인 전용 앱 제공에만 사용하며, 구글 드라이브의 비공개 파일에 보관됩니다. 삭제를 원하시면 교회로 요청해 주세요.',
      submitLabel: '가입 신청', busyLabel: '신청 중…', successMsg: '',
      validate: function (v) {
        if (!phoneOk(v.phone)) return '휴대폰 번호를 정확히 입력해 주세요. (예: 010-1234-5678)';
        if (v.password.length < 6) return '비밀번호는 6자 이상으로 정해 주세요.';
        if (v.password !== v.password2) return '비밀번호 확인이 일치하지 않습니다.';
        if (v.agree !== 'Y') return '개인정보 수집·이용에 동의해 주세요.';
      },
      onSave: function (v) { return mcall({ action: 'register', name: v.name, phone: v.phone, password: v.password, memo: v.memo, agree: true, website: v.website }); },
      onDone: function () {
        var b = el('div', 'inst');
        b.appendChild(el('p', null, '✅ 가입 신청이 접수되었습니다.'));
        b.appendChild(el('p', null, '교회에서 교인 여부를 확인한 뒤 승인해 드립니다. 승인되면 같은 휴대폰 번호와 비밀번호로 로그인하실 수 있습니다.'));
        openModal('가입 신청 완료', b, [btn('확인', 'btn', closeModal)]);
      }
    });
  }

  function openMemberPassword() {
    var o1 = setAttrs(fText('현재 비밀번호', '', { req: true, type: 'password', max: 40 }), { autocomplete: 'current-password' });
    var n1 = setAttrs(fText('새 비밀번호 (6자 이상)', '', { req: true, type: 'password', max: 40 }), { autocomplete: 'new-password' });
    var n2 = setAttrs(fText('새 비밀번호 확인', '', { req: true, type: 'password', max: 40 }), { autocomplete: 'new-password' });
    formModal('비밀번호 변경', [{ k: 'old', f: o1 }, { k: 'new', f: n1 }, { k: 'new2', f: n2 }], {
      submitLabel: '변경', busyLabel: '변경 중…', successMsg: '비밀번호가 변경되었습니다.',
      validate: function (v) { if (v.new.length < 6) return '새 비밀번호는 6자 이상으로 정해 주세요.'; if (v.new !== v.new2) return '새 비밀번호 확인이 일치하지 않습니다.'; },
      onSave: function (v) { return mcall({ action: 'memberPassword', token: MEMBER.token, old: v.old, new: v.new }).then(function (j) { MEMBER.token = j.token; saveMember(); return j; }); }
    });
  }

  // ---- 관리자: 교인 승인·관리 ----
  var STATUS_LABEL = { pending: '승인 대기', approved: '승인됨', rejected: '거절', blocked: '차단' };
  function openMemberManager() {
    var state = { list: null, filter: 'pending', err: '', temp: null };
    var body = el('div', 'mm');
    function load() {
      call({ action: 'memberList' }).then(function (j) { state.list = j.list; PENDING = j.pending; state.err = ''; draw(); renderAdminChrome(); })
        .catch(function (e) { state.err = e.message; draw(); });
    }
    function act(payload, okMsg) {
      call(payload).then(function (j) {
        state.list = j.list; PENDING = j.pending; if (j.temp) state.temp = { name: j.tempFor, pw: j.temp };
        draw(); renderAdminChrome(); if (okMsg) toast(okMsg);
      }).catch(function (e) { toast(e.message, 'err'); });
    }
    function count(st) { return (state.list || []).filter(function (m) { return st === 'all' || m.status === st || (st === 'closed' && (m.status === 'rejected' || m.status === 'blocked')); }).length; }
    function draw() {
      body.textContent = '';
      if (state.err) { body.appendChild(el('p', 'm-err', state.err)); return; }
      if (!state.list) { body.appendChild(el('p', 'empty', '불러오는 중…')); return; }
      if (state.temp) {
        var tb = el('div', 'mm-temp');
        tb.appendChild(el('strong', null, state.temp.name + '님의 임시 비밀번호: '));
        tb.appendChild(el('code', null, state.temp.pw));
        tb.appendChild(el('small', null, '이 창을 닫으면 다시 볼 수 없습니다. 본인에게 전달하고, 로그인 후 [비밀번호 변경]에서 바꾸도록 안내해 주세요.'));
        body.appendChild(tb);
      }
      var fl = el('div', 'mm-filter');
      [['pending', '승인 대기'], ['approved', '승인됨'], ['closed', '거절·차단'], ['all', '전체']].forEach(function (f) {
        var b = btn(f[1] + ' ' + count(f[0]), 'chip' + (state.filter === f[0] ? ' on' : ''), function () { state.filter = f[0]; draw(); });
        fl.appendChild(b);
      });
      body.appendChild(fl);
      var rows = state.list.filter(function (m) { return state.filter === 'all' || m.status === state.filter || (state.filter === 'closed' && (m.status === 'rejected' || m.status === 'blocked')); });
      if (!rows.length) body.appendChild(el('p', 'empty', state.filter === 'pending' ? '승인을 기다리는 교인이 없습니다.' : '해당하는 교인이 없습니다.'));
      rows.forEach(function (m) {
        var r = el('div', 'mm-row st-' + m.status);
        var info = el('div', 'mm-info');
        var h = el('div', 'mm-name'); h.appendChild(el('strong', null, m.name)); h.appendChild(el('span', 'mm-st', STATUS_LABEL[m.status] || m.status)); info.appendChild(h);
        info.appendChild(el('div', 'mm-sub', '📞 ' + m.phone + '  ·  신청 ' + (m.applied || '-') + (m.approved ? '  ·  승인 ' + m.approved : '')));
        if (m.memo) info.appendChild(el('div', 'mm-sub', '💬 ' + m.memo));
        if (m.adminMemo) info.appendChild(el('div', 'mm-sub mm-admin', '📝 ' + m.adminMemo));
        r.appendChild(info);
        var ac = el('div', 'mm-acts');
        var setSt = function (st, msg) { return function () { act({ action: 'memberSet', id: m.id, status: st }, msg); }; };
        if (m.status !== 'approved') ac.appendChild(btn('승인', 'btn sm', setSt('approved', m.name + '님을 승인했습니다.')));
        if (m.status === 'pending') ac.appendChild(btn('거절', 'btn sm ghost', setSt('rejected', '거절했습니다.')));
        if (m.status === 'approved') { ac.appendChild(btn('차단', 'btn sm ghost', function () { if (confirm(m.name + '님의 이용을 차단할까요? (로그인이 즉시 해제됩니다)')) act({ action: 'memberSet', id: m.id, status: 'blocked' }, '차단했습니다.'); })); ac.appendChild(btn('비밀번호 초기화', 'btn sm ghost', function () { if (confirm(m.name + '님의 비밀번호를 임시 비밀번호로 바꿀까요?')) act({ action: 'memberReset', id: m.id }); })); }
        ac.appendChild(btn('메모', 'btn sm ghost', function () { var t = prompt('관리자 메모 (교인에게는 보이지 않습니다)', m.adminMemo || ''); if (t !== null) act({ action: 'memberSet', id: m.id, adminMemo: t }); }));
        ac.appendChild(btn('삭제', 'btn sm danger', function () { if (confirm(m.name + '님의 가입 정보를 삭제할까요? 되돌릴 수 없습니다.')) act({ action: 'memberDelete', id: m.id }, '삭제했습니다.'); }));
        r.appendChild(ac); body.appendChild(r);
      });
    }
    openModal('교인 관리', body, [btn('닫기', 'btn', closeModal)], true);
    draw(); load();
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
