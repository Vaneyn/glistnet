/* G-list autorun.js — двухпальцевое меню в стиле старого терминала
 * Жест: два пальца почти одновременно (<=250 мс между касаниями) и держим 2 секунды.
 * Окно: маленькое, таскается за заголовок, размер меняется уголком справа снизу.
 * Всё в ES5, чтобы летало на старом Android WebView.
 */
(function () {
  'use strict';

  // не запускаемся внутри собственных iframe (иначе меню в меню в меню)
  if (window.self !== window.top) return;
  if (window.__glistAutorun) return;
  window.__glistAutorun = true;

  // ===== НАСТРОЙКИ =====
  var HOLD_MS = 2000;        // сколько держать два пальца
  var SYNC_MS = 250;         // "почти одновременно"
  var MOVE_TOL = 25;         // допуск сдвига пальцев, px
  var COLOR = '#33ff33';
  var DIM = '#119911';
  var MIN_W = 190;           // минимальный размер окна
  var MIN_H = 140;
  var GEOM_KEY = 'glistShellGeom';
  var OPT_NP = { passive: false };

  // база для относительных путей = папка, откуда загружен autorun.js
  var BASE = '';
  try {
    var cs = document.currentScript;
    if (cs && cs.src) BASE = cs.src.replace(/[^\/]*$/, '');
  } catch (e) {}

  var APPS = [
    { key: '1', name: 'TERMINAL', file: 'terminal.html' },
    { key: '2', name: 'MP3 PLAYER', file: 'mp3player.html' },
    { key: '3', name: 'FPS CHECKER', builtin: 'fps' },
    { key: '4', name: 'НАЧИНКА', builtin: 'env' },
    { key: '5', name: 'G-LIST OS', file: 'glistos.html' }
  ];

  var win = null;        // корневой элемент окна (null = закрыто)
  var body = null;
  var titleEl = null;
  var backBtn = null;
  var cleanup = null;    // остановка текущего встроенного приложения
  var watchdog = null;   // сторож: возвращает окно на место, если его кто-то выпилил
  var backHook = null;   // перехват кнопки "<": приложение внутри может вернуть true = "я сам обработал"

  // Мост для встроенных страниц (например, G-LIST OS): вернуться в меню или перехватить "<"
  window.__glistShell = {
    menu: function () { if (win) showMenu(); },
    close: function () { closeMenu(); },
    setBackHook: function (fn) { backHook = (typeof fn === 'function') ? fn : null; }
  };
  var geom = null;       // {x,y,w,h}

  // ===== ЖЕСТ =====
  var firstTouchTime = 0;
  var holdTimer = null;
  var startPts = null;

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    startPts = null;
  }

  function pts(e) {
    var r = [];
    for (var i = 0; i < e.touches.length && i < 2; i++) {
      r.push({ x: e.touches[i].clientX, y: e.touches[i].clientY });
    }
    return r;
  }

  document.addEventListener('touchstart', function (e) {
    var now = Date.now();
    if (e.touches.length === 1) {
      firstTouchTime = now;
      cancelHold();
    } else if (e.touches.length === 2) {
      if (now - firstTouchTime <= SYNC_MS && !holdTimer && !win) {
        startPts = pts(e);
        holdTimer = setTimeout(function () {
          holdTimer = null;
          openMenu();
        }, HOLD_MS);
      }
    } else {
      cancelHold();
    }
  }, { passive: true });

  document.addEventListener('touchmove', function (e) {
    if (!holdTimer || !startPts) return;
    var p = pts(e);
    if (p.length < 2) { cancelHold(); return; }
    for (var i = 0; i < 2; i++) {
      var dx = p[i].x - startPts[i].x, dy = p[i].y - startPts[i].y;
      if (dx * dx + dy * dy > MOVE_TOL * MOVE_TOL) { cancelHold(); return; }
    }
  }, { passive: true });

  function onEnd(e) {
    if (e.touches.length < 2) cancelHold();
  }
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onEnd, { passive: true });

  // хоткей для ПК: Ctrl+Alt+T, закрыть: Esc
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
      win ? closeMenu() : openMenu();
    } else if (e.key === 'Escape' && win) {
      closeMenu();
    }
  });

  window.addEventListener('resize', function () {
    if (!win) return;
    clampGeom(false);
    applyGeom(true);
  });

  // ===== ХЕЛПЕРЫ =====
  function el(tag, css, text) {
    var n = document.createElement(tag);
    if (css) n.style.cssText = css;
    if (text != null) n.textContent = text;
    return n;
  }

  function btnCss() {
    return 'background:#000;color:' + COLOR + ';border:1px solid ' + COLOR + ';' +
      'font-family:inherit;font-size:11px;padding:0;width:22px;height:22px;margin:0 2px;' +
      'flex:0 0 auto;border-radius:0;';
  }

  function smallBtn() {
    return 'background:#000;color:' + COLOR + ';border:1px solid ' + COLOR + ';' +
      'font-family:inherit;font-size:10px;padding:0 5px;height:20px;margin-right:3px;border-radius:0;';
  }

  // ===== ГЕОМЕТРИЯ =====
  function vw() { return window.innerWidth || document.documentElement.clientWidth || 360; }
  function vh() { return window.innerHeight || document.documentElement.clientHeight || 640; }

  function loadGeom() {
    var g = null;
    try { g = JSON.parse(localStorage.getItem(GEOM_KEY)); } catch (e) {}
    if (!g || typeof g.w !== 'number' || typeof g.h !== 'number' ||
        typeof g.x !== 'number' || typeof g.y !== 'number') {
      var w = Math.min(Math.round(vw() * 0.78), 340);
      var h = Math.min(Math.round(vh() * 0.5), 360);
      g = { w: w, h: h, x: Math.round((vw() - w) / 2), y: Math.round((vh() - h) / 2) };
    }
    geom = g;
    clampGeom(false);
  }

  function saveGeom() {
    try { localStorage.setItem(GEOM_KEY, JSON.stringify(geom)); } catch (e) {}
  }

  function clampGeom(resizing) {
    var W = vw(), H = vh();
    var minW = Math.min(MIN_W, W), minH = Math.min(MIN_H, H);
    if (resizing) {
      geom.w = Math.min(geom.w, W - geom.x);
      geom.h = Math.min(geom.h, H - geom.y);
    }
    geom.w = Math.max(minW, Math.min(geom.w, W));
    geom.h = Math.max(minH, Math.min(geom.h, H));
    geom.x = Math.max(0, Math.min(geom.x, W - geom.w));
    geom.y = Math.max(0, Math.min(geom.y, H - geom.h));
  }

  function applyGeom(fit) {
    if (!win) return;
    win.style.left = Math.round(geom.x) + 'px';
    win.style.top = Math.round(geom.y) + 'px';
    win.style.width = Math.round(geom.w) + 'px';
    win.style.height = Math.round(geom.h) + 'px';
    if (fit) fitTitle();
  }

  // заголовок всегда в одну строку: уменьшаем шрифт, пока не влезет
  function fitTitle() {
    if (!titleEl) return;
    var size = 13;
    titleEl.style.fontSize = size + 'px';
    while (titleEl.scrollWidth > titleEl.clientWidth && size > 6) {
      size--;
      titleEl.style.fontSize = size + 'px';
    }
  }

  function setTitle(t) {
    if (!titleEl) return;
    titleEl.textContent = t;
    fitTitle();
  }

  // ===== ПЕРЕТАСКИВАНИЕ (мышь + тач) =====
  var lastTouch = 0;

  function bindDrag(handle, onStart, onMove, onEndCb) {
    var active = false, isTouch = false;

    function pt(e) {
      var t = (e.touches && e.touches.length) ? e.touches[0] :
        ((e.changedTouches && e.changedTouches.length) ? e.changedTouches[0] : e);
      return { x: t.clientX, y: t.clientY };
    }

    function move(e) {
      if (!active) return;
      if (isTouch && e.touches && e.touches.length > 1) return;
      if (e.cancelable) e.preventDefault();
      onMove(pt(e), e);
    }

    function up(e) {
      if (!active) return;
      active = false;
      if (isTouch) {
        document.removeEventListener('touchmove', move, OPT_NP);
        document.removeEventListener('touchend', up, false);
        document.removeEventListener('touchcancel', up, false);
      } else {
        document.removeEventListener('mousemove', move, false);
        document.removeEventListener('mouseup', up, false);
      }
      onEndCb(e);
    }

    function down(e) {
      var touch = e.type === 'touchstart';
      if (touch) {
        lastTouch = Date.now();
      } else {
        if (e.button !== 0) return;
        if (Date.now() - lastTouch < 800) return; // эмуляция мыши после тача
      }
      if (active) return;
      if (touch && e.touches.length > 1) return;
      if (onStart(pt(e), e) === false) return;
      active = true;
      isTouch = touch;
      if (touch) {
        document.addEventListener('touchmove', move, OPT_NP);
        document.addEventListener('touchend', up, false);
        document.addEventListener('touchcancel', up, false);
      } else {
        document.addEventListener('mousemove', move, false);
        document.addEventListener('mouseup', up, false);
        e.preventDefault();
      }
    }

    handle.addEventListener('touchstart', down, false);
    handle.addEventListener('mousedown', down, false);
  }

  // ===== ОКНО =====
  var taps = 0, lastTap = 0;
  function tapTitle() {
    var n = Date.now();
    taps = (n - lastTap < 1500) ? taps + 1 : 1;
    lastTap = n;
    if (taps >= 5) {
      taps = 0;
      noiseAndClose();
    }
  }

  function openMenu() {
    if (win) return;
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
    loadGeom();

    win = el('div',
      'position:fixed;z-index:2147483647;background:#000;color:' + COLOR + ';' +
      'border:2px solid ' + COLOR + ';' +
      'box-shadow:0 0 14px ' + COLOR + ',inset 0 0 24px rgba(51,255,51,.12);' +
      'display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;' +
      'font-family:"Courier New",Courier,monospace;');

    // шапка (она же ручка для перетаскивания)
    var bar = el('div',
      'display:flex;align-items:center;border-bottom:2px solid ' + COLOR + ';' +
      'padding:2px 3px;background:#052505;flex:0 0 auto;touch-action:none;position:relative;z-index:25;' +
      '-webkit-user-select:none;user-select:none;');
    backBtn = el('button', btnCss(), '<');
    backBtn.style.visibility = 'hidden';
    backBtn.onclick = function () {
      if (backHook) {
        var handled = false;
        try { handled = backHook(); } catch (e) {}
        if (handled) return;
      }
      showMenu();
    };
    titleEl = el('div',
      'flex:1 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-align:center;' +
      'letter-spacing:1px;line-height:22px;font-size:13px;');
    var closeBtn = el('button', btnCss(), 'X');
    closeBtn.onclick = closeMenu;
    bar.appendChild(backBtn);
    bar.appendChild(titleEl);
    bar.appendChild(closeBtn);

    body = el('div',
      'flex:1 1 auto;min-height:0;position:relative;overflow:auto;-webkit-overflow-scrolling:touch;');

    // CRT-сканлайны поверх
    var scan = el('div',
      'position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:15;' +
      'background:repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0,rgba(0,0,0,.18) 1px,transparent 1px,transparent 3px);');

    // уголок для изменения размера
    var handle = el('div',
      'position:absolute;right:0;bottom:0;width:30px;height:30px;z-index:20;' +
      'cursor:nwse-resize;touch-action:none;' +
      'background:linear-gradient(135deg,transparent 0,transparent 48%,' + COLOR + ' 48%,' + COLOR +
      ' 56%,transparent 56%,transparent 68%,' + COLOR + ' 68%,' + COLOR + ' 76%,transparent 76%);');

    win.appendChild(bar);
    win.appendChild(body);
    win.appendChild(scan);
    win.appendChild(handle);
    document.body.appendChild(win);

    watchdog = setInterval(function () {
      if (!win) return;
      if (document.body && !document.body.contains(win)) {
        try { document.body.appendChild(win); } catch (e) {}
      }
      if (win.style.display === 'none') win.style.display = 'flex';
    }, 500);

    // --- перетаскивание за шапку ---
    var drag = null;
    bindDrag(bar,
      function (p, e) {
        if (e.target && e.target.tagName === 'BUTTON') return false;
        drag = { x: p.x, y: p.y, gx: geom.x, gy: geom.y, target: e.target, moved: false };
        if (body) body.style.pointerEvents = 'none';
      },
      function (p) {
        if (!drag) return;
        var dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
        if (!drag.moved) return;
        geom.x = drag.gx + dx;
        geom.y = drag.gy + dy;
        clampGeom(false);
        applyGeom(false);
      },
      function () {
        if (body) body.style.pointerEvents = '';
        if (drag) {
          if (drag.moved) saveGeom();
          else if (drag.target === titleEl) tapTitle();
        }
        drag = null;
      });

    // --- изменение размера за уголок ---
    var rs = null;
    bindDrag(handle,
      function (p) {
        rs = { x: p.x, y: p.y, w: geom.w, h: geom.h };
        if (body) body.style.pointerEvents = 'none';
      },
      function (p) {
        if (!rs) return;
        geom.w = rs.w + (p.x - rs.x);
        geom.h = rs.h + (p.y - rs.y);
        clampGeom(true);
        applyGeom(true);
      },
      function () {
        if (body) body.style.pointerEvents = '';
        saveGeom();
        rs = null;
      });

    applyGeom(false);
    showMenu();
  }

  function stopApp() {
    backHook = null;
    if (cleanup) {
      try { cleanup(); } catch (e) {}
      cleanup = null;
    }
  }

  function closeMenu() {
    stopApp();
    if (watchdog) { clearInterval(watchdog); watchdog = null; }
    if (win && win.parentNode) win.parentNode.removeChild(win);
    win = body = titleEl = backBtn = null;
  }

  function clearBody() {
    stopApp();
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function showMenu() {
    clearBody();
    setTitle('G-LIST SHELL');
    backBtn.style.visibility = 'hidden';
    body.style.overflow = 'auto';

    var box = el('div', 'padding:6px;font-size:12px;line-height:1.4;');
    box.appendChild(el('div', 'white-space:pre;font-size:11px;color:' + DIM + ';',
      'C:\\GLIST> menu.exe\n' +
      '--------------------\n' +
      ' ВЫБЕРИ ПРОГРАММУ:'));

    for (var i = 0; i < APPS.length; i++) {
      (function (app) {
        var row = el('div',
          'margin:5px 0;padding:7px 6px;border:1px dashed ' + COLOR + ';cursor:pointer;' +
          '-webkit-tap-highlight-color:rgba(51,255,51,.3);',
          '[' + app.key + '] ' + app.name);
        row.onclick = function () { launch(app); };
        box.appendChild(row);
      })(APPS[i]);
    }

    var prompt = el('div', 'margin-top:10px;color:' + DIM + ';font-size:11px;', 'C:\\GLIST> ');
    var cur = el('span', '', '█');
    prompt.appendChild(cur);
    box.appendChild(prompt);
    var on = true;
    var blink = setInterval(function () {
      if (!cur.parentNode) { clearInterval(blink); return; }
      on = !on; cur.style.visibility = on ? 'visible' : 'hidden';
    }, 500);

    body.appendChild(box);
  }

  function launch(app) {
    if (app.builtin === 'fps') { runFps(); return; }
    if (app.builtin === 'env') { runEnv(); return; }
    clearBody();
    setTitle(app.name);
    backBtn.style.visibility = 'visible';
    body.style.overflow = 'hidden';

    var loading = el('div', 'padding:8px;font-size:12px;', 'LOADING ' + app.file + ' ...');
    body.appendChild(loading);

    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;border:0;background:#000;';
    frame.setAttribute('allow', 'autoplay');
    // песочница: код внутри не может увести верхнюю страницу, развернуть себя на весь экран
    // или снести наш интерфейс (шапку, крестик). Скрипты, хранилище и звук работают.
    frame.setAttribute('sandbox',
      'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads');
    body.appendChild(frame);

    // Грузим HTML как ТЕКСТ и вписываем в iframe (document.write),
    // чтобы не было навигации, которую G-list перехватывает как "открыть ссылку".
    var url = BASE + app.file;
    var xhr = new XMLHttpRequest();
    var done = false;

    function fallback() {
      if (done) return;
      done = true;
      frame.src = url; // запасной вариант, если текст не достали
      frame.onload = function () {
        if (loading.parentNode) loading.parentNode.removeChild(loading);
      };
    }

    function inject(html) {
      if (done) return;
      done = true;
      var baseTag = '<base href="' + BASE + '">';
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, function (m) { return m + baseTag; });
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + baseTag + '</head>'; });
      } else {
        html = baseTag + html;
      }
      try {
        var d = frame.contentWindow.document;
        d.open();
        d.write(html);
        d.close();
      } catch (e) {
        done = false;
        fallback();
        return;
      }
      if (loading.parentNode) loading.parentNode.removeChild(loading);
    }

    try {
      xhr.open('GET', url, true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
          inject(xhr.responseText);
        } else {
          fallback();
        }
      };
      xhr.onerror = fallback;
      xhr.send();
    } catch (e) {
      fallback();
    }
  }

  // ===== ПОМЕХИ + закрытие окна =====
  function noiseAndClose() {
    if (!win) return;
    var w0 = win;
    var cv = document.createElement('canvas');
    var w = cv.width = 120, h = cv.height = 80;
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;z-index:30;' +
      'image-rendering:pixelated;image-rendering:-moz-crisp-edges;';
    w0.appendChild(cv);
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(w, h);
    var t0 = Date.now();
    var DUR = 1300;

    function frame() {
      if (win !== w0) return;
      var p = (Date.now() - t0) / DUR;
      if (p >= 1) { closeMenu(); return; }
      var d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var v = Math.random() * 255;
        d[i] = v * 0.4; d[i + 1] = v; d[i + 2] = v * 0.4; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      var jx = (Math.random() - 0.5) * 24 * p;
      var jy = (Math.random() - 0.5) * 10 * p;
      w0.style.transform = 'translate(' + jx + 'px,' + jy + 'px) scaleY(' + (1 - p * p * 0.9) + ')';
      w0.style.opacity = String(1 - p * p * 0.6);
      setTimeout(frame, 40);
    }
    frame();
  }

  // ===== FPS CHECKER (встроенный) =====
  function runFps() {
    clearBody();
    setTitle('FPS CHECKER');
    backBtn.style.visibility = 'visible';
    body.style.overflow = 'auto';

    var wrap = el('div', 'padding:6px;box-sizing:border-box;');
    var info = el('div', 'white-space:pre;font-size:13px;line-height:1.3;', '');
    var cv = document.createElement('canvas');
    cv.style.cssText = 'display:block;width:100%;height:70px;margin-top:6px;border:1px solid ' + DIM + ';';
    var note = el('div', 'margin-top:6px;font-size:11px;color:' + DIM + ';', '');
    wrap.appendChild(info);
    wrap.appendChild(cv);
    wrap.appendChild(note);
    body.appendChild(wrap);

    var W = cv.width = 300, H = cv.height = 70;
    var ctx = cv.getContext('2d');
    var raf = (window.requestAnimationFrame || window.webkitRequestAnimationFrame);
    var caf = (window.cancelAnimationFrame || window.webkitCancelAnimationFrame || clearTimeout);

    var running = true;
    var last = 0, frames = 0, acc = 0;
    var fps = 0, minF = 9999, maxF = 0, sumF = 0, cnt = 0;
    var hist = [];
    var id = 0;
    var started = Date.now();
    var spinner = 0;

    function loop(t) {
      if (!running) return;
      if (last) {
        var dt = t - last;
        frames++; acc += dt; spinner += dt;
        if (acc >= 500) {
          fps = Math.round(frames * 1000 / acc);
          frames = 0; acc = 0;
          if (Date.now() - started > 1000) {
            if (fps < minF) minF = fps;
            if (fps > maxF) maxF = fps;
            sumF += fps; cnt++;
          }
          hist.push(fps);
          if (hist.length > 60) hist.shift();
          draw();
        }
      }
      last = t;
      id = raf.call(window, loop);
    }

    function draw() {
      var spin = ['|', '/', '-', '\\'][Math.floor(spinner / 150) % 4];
      var rating = fps >= 55 ? 'ОТЛИЧНО' : fps >= 40 ? 'НОРМ' : fps >= 25 ? 'ТЯЖЕЛОВАТО' : 'СЛАЙД-ШОУ';
      info.textContent =
        ' ' + spin + ' FPS : ' + fps + '\n' +
        '   MIN : ' + (cnt ? minF : '--') + '\n' +
        '   MAX : ' + (cnt ? maxF : '--') + '\n' +
        '   AVG : ' + (cnt ? Math.round(sumF / cnt) : '--') + '\n' +
        '   СТАТУС: ' + rating;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = DIM;
      ctx.lineWidth = 1;
      var marks = [30, 60];
      for (var m = 0; m < marks.length; m++) {
        var gy = H - (marks[m] / 75) * H;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
        ctx.fillStyle = DIM; ctx.font = '10px monospace';
        ctx.fillText(String(marks[m]), 3, gy - 2);
      }
      ctx.strokeStyle = COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (var i = 0; i < hist.length; i++) {
        var x = i * (W / 59);
        var y = H - Math.min(hist[i], 75) / 75 * H;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      note.textContent = fps > 0 && fps < 20
        ? 'Телефону пиздец. Закрой лишние вкладки.'
        : 'Меряется через requestAnimationFrame. Потолок обычно 60.';
    }

    info.textContent = ' ИЗМЕРЯЮ...';
    id = raf.call(window, loop);

    cleanup = function () {
      running = false;
      try { caf.call(window, id); } catch (e) {}
    };
  }

  // ===== ENV TEST: тестирование среды =====
  function itemsToText(items) {
    var s = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.raw !== undefined) s.push(it.raw);
      else if (it.t) { s.push(''); s.push('== ' + it.t + ' =='); }
      else s.push(it.k + ': ' + it.v);
    }
    return s.join('\n');
  }

  function copyText(text, cb) {
    function fb() {
      var res = false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        res = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (e) {}
      cb(res);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { cb(true); }, fb);
        return;
      }
    } catch (e) {}
    fb();
  }

  function collectEnv(update) {
    var items = [];
    var nav = navigator;
    var ua = nav.userAgent || '';
    var scr = window.screen || {};

    function S(t) { items.push({ t: t }); }
    function K(k, v) { var o = { k: k, v: String(v) }; items.push(o); return o; }
    function ok(fn) { try { return fn(); } catch (e) { return undefined; } }
    function val(x) { return (x === undefined || x === null || x === '') ? 'n/a' : x; }
    function yn(b) { return b ? 'да' : 'нет'; }
    function mb(b) { return Math.round(b / 1048576); }
    function sec(title, fn) {
      S(title);
      try { fn(); } catch (e) { K('ошибка секции', e && e.message); }
    }
    function w(n) { return function () { return n in window; }; }
    function nv(n) { return function () { return n in nav; }; }
    function listSupport(title, tests) {
      var yes = [], no = [];
      for (var i = 0; i < tests.length; i++) {
        var r = ok(tests[i][1]);
        (r ? yes : no).push(tests[i][0]);
      }
      K(title + ' ЕСТЬ', yes.join(', ') || '—');
      K(title + ' НЕТ', no.join(', ') || '—');
    }
    function cp(elm, type) {
      var r = ok(function () { return elm.canPlayType(type); });
      return r === 'probably' ? 'да' : (r === 'maybe' ? 'возможно' : 'нет');
    }

    // --- БРАУЗЕР ---
    sec('БРАУЗЕР', function () {
      K('UserAgent', ua);
      K('Платформа', val(nav.platform));
      K('Вендор', val(nav.vendor));
      var m = ua.match(/Android\s([\d.]+)/);
      if (m) K('Android', m[1]);
      m = ua.match(/Android[^;]*;\s*([^;)]+)/);
      if (m) K('Модель (по UA)', m[1].replace(/\s*Build\/.*/, ''));
      var names = ['SamsungBrowser', 'YaBrowser', 'OPR', 'Edg', 'Firefox', 'Chrome'];
      for (var i = 0; i < names.length; i++) {
        var mm = ua.match(new RegExp(names[i] + '\\/([\\d.]+)'));
        if (mm) { K('Браузер/движок', names[i] + ' ' + mm[1]); break; }
      }
      m = ua.match(/Version\/([\d.]+)/);
      if (m) K('Version/', m[1]);
      K('WebView?', yn(/; wv\)/.test(ua) ||
        (/Android/.test(ua) && /Version\/[\d.]+/.test(ua) && /Chrome\//.test(ua))));
      K('Язык', val(nav.language) + ' | ' +
        val(ok(function () { return nav.languages.join(', '); })));
      K('Cookies', yn(nav.cookieEnabled));
      K('Онлайн', yn(nav.onLine));
      K('DoNotTrack', val(nav.doNotTrack || window.doNotTrack));
      K('Плагины / MIME', val(ok(function () { return nav.plugins.length + ' / ' + nav.mimeTypes.length; })));
      var uad = nav.userAgentData;
      if (uad) {
        K('UA Client Hints', ok(function () {
          return 'mobile=' + uad.mobile + ', platform=' + uad.platform + ', brands=' +
            uad.brands.map(function (b) { return b.brand + ' ' + b.version; }).join('; ');
        }));
      }
      K('Secure context', yn(window.isSecureContext));
      K('URL', location.href);
      K('Протокол', location.protocol);
      K('Referrer', val(document.referrer));
      K('Кодировка', val(document.characterSet || document.charset));
      K('История (длина)', history.length);
      K('Режим PWA', yn(nav.standalone || ok(function () {
        return window.matchMedia('(display-mode: standalone)').matches;
      })));
    });

    // --- УСТРОЙСТВО ---
    sec('УСТРОЙСТВО', function () {
      K('Ядра CPU', val(nav.hardwareConcurrency));
      K('RAM (deviceMemory, округл.)', nav.deviceMemory ? '~' + nav.deviceMemory + ' GB' : 'n/a');
      K('Тач-точек', val(nav.maxTouchPoints));
      K('Touch events', yn('ontouchstart' in window));
      K('Pointer events', yn(window.PointerEvent));
      K('Экран', scr.width + 'x' + scr.height + ' (доступно ' + scr.availWidth + 'x' + scr.availHeight + ')');
      K('Глубина цвета', scr.colorDepth + ' / ' + scr.pixelDepth + ' бит');
      var dpr = window.devicePixelRatio || 1;
      K('DPR', dpr + ' (физ. ~' + Math.round(scr.width * dpr) + 'x' + Math.round(scr.height * dpr) + ')');
      K('Окно (inner)', window.innerWidth + 'x' + window.innerHeight);
      K('Окно (outer)', window.outerWidth + 'x' + window.outerHeight);
      var vv = window.visualViewport;
      if (vv) K('visualViewport', Math.round(vv.width) + 'x' + Math.round(vv.height) + ', scale ' + vv.scale);
      K('Ориентация', ok(function () { return scr.orientation.type + ' (' + scr.orientation.angle + ' град.)'; }) ||
        val(window.orientation));

      var dtf = ok(function () { return Intl.DateTimeFormat().resolvedOptions(); });
      K('Часовой пояс', dtf ? dtf.timeZone + ' / ' + dtf.locale : 'Intl недоступен');
      var off = -new Date().getTimezoneOffset() / 60;
      K('Смещение', 'UTC' + (off >= 0 ? '+' : '') + off);
      K('Локальное время', new Date().toString());

      var bat = K('Батарея', '...');
      if (nav.getBattery) {
        nav.getBattery().then(function (b) {
          bat.v = Math.round(b.level * 100) + '%, ' + (b.charging ? 'заряжается' : 'не заряжается') +
            (isFinite(b.dischargingTime) ? ', осталось ~' + Math.round(b.dischargingTime / 60) + ' мин' : '');
          update();
        }, function () { bat.v = 'n/a'; update(); });
      } else bat.v = 'API нет';

      var c = nav.connection || nav.mozConnection || nav.webkitConnection;
      K('Сеть', c ? ('type=' + val(c.type) + ', eff=' + val(c.effectiveType) + ', downlink=' +
        val(c.downlink) + ' Мбит/с, rtt=' + val(c.rtt) + ' мс, saveData=' + val(c.saveData)) : 'API нет');

      var stg = K('Хранилище', '...');
      if (nav.storage && nav.storage.estimate) {
        nav.storage.estimate().then(function (e) {
          stg.v = 'занято ' + mb(e.usage || 0) + ' MB из ~' + mb(e.quota || 0) + ' MB';
          update();
        }, function () { stg.v = 'n/a'; update(); });
      } else stg.v = 'API нет';

      var md = K('Медиаустройства', '...');
      if (nav.mediaDevices && nav.mediaDevices.enumerateDevices) {
        nav.mediaDevices.enumerateDevices().then(function (list) {
          var cnt = {}, parts = [];
          for (var i = 0; i < list.length; i++) cnt[list[i].kind] = (cnt[list[i].kind] || 0) + 1;
          for (var k in cnt) if (cnt.hasOwnProperty(k)) parts.push(k + '=' + cnt[k]);
          md.v = parts.join(', ') || 'нет';
          update();
        }, function () { md.v = 'n/a'; update(); });
      } else md.v = 'API нет';

      var gp = ok(function () { return nav.getGamepads(); });
      var gpn = 0;
      if (gp) for (var g = 0; g < gp.length; g++) if (gp[g]) gpn++;
      K('Геймпады подключено', gp ? gpn : 'API нет');

      var perms = ['geolocation', 'notifications', 'camera', 'microphone', 'clipboard-read'];
      var pk = K('Разрешения', '...');
      if (nav.permissions && nav.permissions.query) {
        var res = {}, left = perms.length;
        var fin = function () {
          left--;
          if (left === 0) {
            var out = [];
            for (var q = 0; q < perms.length; q++) out.push(perms[q] + '=' + res[perms[q]]);
            pk.v = out.join(', ');
            update();
          }
        };
        for (var p = 0; p < perms.length; p++) {
          (function (n) {
            try {
              nav.permissions.query({ name: n }).then(function (r) { res[n] = r.state; fin(); },
                function () { res[n] = 'n/a'; fin(); });
            } catch (e) { res[n] = 'n/a'; fin(); }
          })(perms[p]);
        }
      } else pk.v = 'API нет';
    });

    // --- ГРАФИКА ---
    sec('ГРАФИКА', function () {
      var gl = ok(function () {
        var c = document.createElement('canvas');
        return c.getContext('webgl') || c.getContext('experimental-webgl');
      });
      if (gl) {
        K('WebGL', 'да, ' + gl.getParameter(gl.VERSION));
        K('GLSL', gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        K('GPU вендор', dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
        K('GPU рендерер', dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        K('Макс. текстура', gl.getParameter(gl.MAX_TEXTURE_SIZE));
        var vd = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
        K('Макс. viewport', vd[0] + 'x' + vd[1]);
        K('Макс. vertex-атрибутов', gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
        K('Расширений WebGL', (gl.getSupportedExtensions() || []).length);
      } else K('WebGL', 'нет');
      K('WebGL2', yn(ok(function () { return document.createElement('canvas').getContext('webgl2'); })));
      K('Canvas 2D', yn(ok(function () { return document.createElement('canvas').getContext('2d'); })));
      K('Canvas -> WebP', yn(ok(function () {
        return document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0;
      })));
      K('OffscreenCanvas', yn(window.OffscreenCanvas));
      K('createImageBitmap', yn(window.createImageBitmap));

      var hz = K('Частота экрана (оценка)', 'измеряю...');
      var raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame;
      if (!raf) { hz.v = 'rAF нет'; }
      else {
        var ts = [], t0 = Date.now();
        var step = function (t) {
          ts.push(t || Date.now());
          if (ts.length < 25 && Date.now() - t0 < 2500) { raf.call(window, step); return; }
          var d = [];
          for (var i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
          d.sort(function (a, b) { return a - b; });
          var med = d[Math.floor(d.length / 2)];
          hz.v = med > 0 ? '~' + Math.round(1000 / med) + ' Гц' : 'n/a';
          update();
        };
        raf.call(window, step);
      }
    });

    // --- API ---
    sec('API', function () {
      listSupport('API', [
        ['localStorage', function () { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; }],
        ['sessionStorage', w('sessionStorage')],
        ['indexedDB', w('indexedDB')],
        ['serviceWorker', nv('serviceWorker')],
        ['WebSocket', w('WebSocket')],
        ['WebRTC', function () { return window.RTCPeerConnection || window.webkitRTCPeerConnection; }],
        ['WebAssembly', w('WebAssembly')],
        ['Promise', w('Promise')],
        ['fetch', w('fetch')],
        ['Worker', w('Worker')],
        ['SharedWorker', w('SharedWorker')],
        ['Notification', w('Notification')],
        ['Clipboard', nv('clipboard')],
        ['Fullscreen', function () {
          return document.fullscreenEnabled || document.webkitFullscreenEnabled ||
            document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen;
        }],
        ['WebAudio', function () { return window.AudioContext || window.webkitAudioContext; }],
        ['SpeechSynthesis', w('speechSynthesis')],
        ['SpeechRecognition', function () { return window.SpeechRecognition || window.webkitSpeechRecognition; }],
        ['MediaRecorder', w('MediaRecorder')],
        ['FileReader', w('FileReader')],
        ['Blob', w('Blob')],
        ['createObjectURL', function () { return window.URL && URL.createObjectURL; }],
        ['requestAnimationFrame', function () { return window.requestAnimationFrame || window.webkitRequestAnimationFrame; }],
        ['IntersectionObserver', w('IntersectionObserver')],
        ['ResizeObserver', w('ResizeObserver')],
        ['MutationObserver', w('MutationObserver')],
        ['BroadcastChannel', w('BroadcastChannel')],
        ['Share', nv('share')],
        ['WakeLock', nv('wakeLock')],
        ['Bluetooth', nv('bluetooth')],
        ['USB', nv('usb')],
        ['Serial', nv('serial')],
        ['MIDI', nv('requestMIDIAccess')],
        ['PaymentRequest', w('PaymentRequest')],
        ['Vibration', nv('vibrate')],
        ['Geolocation', nv('geolocation')],
        ['Gamepad', nv('getGamepads')],
        ['DeviceOrientation', w('DeviceOrientationEvent')],
        ['DeviceMotion', w('DeviceMotionEvent')],
        ['PointerLock', function () { return 'pointerLockElement' in document; }],
        ['History API', function () { return history.pushState; }],
        ['FormData', w('FormData')],
        ['TextEncoder', w('TextEncoder')],
        ['crypto.subtle', function () { return window.crypto && crypto.subtle; }],
        ['Intl', w('Intl')]
      ]);
    });

    // --- ЯЗЫК JS ---
    sec('JS (СИНТАКСИС)', function () {
      var evalOk = ok(function () { return new Function('return 1')() === 1; });
      if (!evalOk) {
        K('Проверка', 'Function() заблокирован (CSP) — проверить нельзя');
        return;
      }
      var syn = function (src) { return function () { new Function(src); return true; }; };
      listSupport('JS', [
        ['let/const', syn('let a=1;const b=2;')],
        ['arrow', syn('(()=>1)')],
        ['template', syn('`${1}`')],
        ['class', syn('class A{}')],
        ['async/await', syn('async function f(){await 1}')],
        ['?.', syn('var a={};a?.b')],
        ['??', syn('null??1')],
        ['spread', syn('[...[1]]')],
        ['destructuring', syn('var {a}={a:1}')],
        ['generators', syn('function* g(){yield 1}')],
        ['for-of', syn('for(var x of [1]){}')],
        ['**', syn('2**2')],
        ['dynamic import', syn('import("x")')],
        ['BigInt', function () { return typeof BigInt === 'function'; }],
        ['Map/Set', function () { return typeof Map === 'function' && typeof Set === 'function'; }],
        ['Symbol', function () { return typeof Symbol === 'function'; }],
        ['Proxy', function () { return typeof Proxy === 'function'; }],
        ['type=module', function () { return 'noModule' in document.createElement('script'); }]
      ]);
    });

    // --- CSS ---
    sec('CSS', function () {
      if (!(window.CSS && CSS.supports)) { K('CSS.supports', 'нет'); return; }
      var sp = function (a, b) { return function () { return CSS.supports(a, b); }; };
      listSupport('CSS', [
        ['grid', sp('display', 'grid')],
        ['gap', sp('gap', '1px')],
        ['css-vars', sp('--a', '0')],
        ['sticky', sp('position', 'sticky')],
        ['backdrop-filter', function () { return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'); }],
        ['aspect-ratio', sp('aspect-ratio', '1/1')],
        ['inset', sp('inset', '0')],
        ['dvh', sp('height', '100dvh')],
        ['overscroll', sp('overscroll-behavior', 'none')],
        ['touch-action', sp('touch-action', 'none')],
        ['pixelated', sp('image-rendering', 'pixelated')],
        ['clamp()', sp('width', 'clamp(1px,2px,3px)')],
        ['min()', sp('width', 'min(1px,2px)')],
        ['scroll-snap', sp('scroll-snap-type', 'x mandatory')],
        [':has()', function () { return CSS.supports('selector(:has(a))'); }]
      ]);
    });

    // --- MEDIA QUERIES ---
    sec('MEDIA QUERIES', function () {
      if (!window.matchMedia) { K('matchMedia', 'нет'); return; }
      var mqs = [
        ['dark', '(prefers-color-scheme: dark)'],
        ['light', '(prefers-color-scheme: light)'],
        ['reduced-motion', '(prefers-reduced-motion: reduce)'],
        ['hover', '(hover: hover)'],
        ['pointer:coarse', '(pointer: coarse)'],
        ['pointer:fine', '(pointer: fine)'],
        ['standalone', '(display-mode: standalone)'],
        ['portrait', '(orientation: portrait)'],
        ['landscape', '(orientation: landscape)'],
        ['hdr', '(dynamic-range: high)'],
        ['wide-gamut', '(color-gamut: p3)']
      ];
      var on = [];
      for (var i = 0; i < mqs.length; i++) {
        if (ok(function () { return window.matchMedia(mqs[i][1]).matches; })) on.push(mqs[i][0]);
      }
      K('Активны', on.join(', ') || '—');
    });

    // --- КОДЕКИ ---
    sec('МЕДИА-КОДЕКИ', function () {
      var a = document.createElement('audio'), v = document.createElement('video');
      K('Аудио',
        'mp3=' + cp(a, 'audio/mpeg') + ', aac=' + cp(a, 'audio/aac') +
        ', m4a=' + cp(a, 'audio/mp4') + ', ogg=' + cp(a, 'audio/ogg; codecs="vorbis"') +
        ', opus=' + cp(a, 'audio/ogg; codecs="opus"') + ', flac=' + cp(a, 'audio/flac') +
        ', wav=' + cp(a, 'audio/wav') + ', webm=' + cp(a, 'audio/webm; codecs="vorbis"'));
      K('Видео',
        'h264=' + cp(v, 'video/mp4; codecs="avc1.42E01E"') +
        ', hevc=' + cp(v, 'video/mp4; codecs="hvc1.1.6.L93.B0"') +
        ', vp8=' + cp(v, 'video/webm; codecs="vp8"') +
        ', vp9=' + cp(v, 'video/webm; codecs="vp9"') +
        ', av1=' + cp(v, 'video/mp4; codecs="av01.0.05M.08"') +
        ', 3gp=' + cp(v, 'video/3gpp') +
        ', ogv=' + cp(v, 'video/ogg; codecs="theora"'));
    });

    // --- ПРОИЗВОДИТЕЛЬНОСТЬ ---
    sec('ПРОИЗВОДИТЕЛЬНОСТЬ', function () {
      var now = (window.performance && performance.now) ?
        function () { return performance.now(); } : function () { return Date.now(); };
      var t0 = now(), acc = 0;
      for (var i = 0; i < 1500000; i++) { acc += Math.sqrt(i); }
      var dt = now() - t0;
      K('Тест JS (1.5M итераций)', Math.round(dt) + ' мс — ' +
        (dt < 60 ? 'быстро' : dt < 200 ? 'нормально' : dt < 600 ? 'медленно' : 'очень медленно') +
        ' [' + Math.round(acc % 1000) + ']');
      var tm = ok(function () { return performance.timing; });
      if (tm && tm.navigationStart) {
        K('Загрузка страницы', 'DOM ' + (tm.domContentLoadedEventEnd - tm.navigationStart) +
          ' мс, load ' + (tm.loadEventEnd - tm.navigationStart) + ' мс');
      }
      var pm = ok(function () { return performance.memory; });
      K('JS-куча', pm ? mb(pm.usedJSHeapSize) + ' / ' + mb(pm.totalJSHeapSize) +
        ' MB (лимит ' + mb(pm.jsHeapSizeLimit) + ')' : 'n/a');
    });

    items.push({ raw: '\nГЛИСТ ПРОСКАНИРОВАЛ УСТРОЙСТВО. УСТРОЙСТВО ЖИВО. ГЛИСТ ДОВОЛЕН.' });
    return items;
  }

  function runEnv() {
    clearBody();
    setTitle('НАЧИНКА');
    backBtn.style.visibility = 'visible';
    body.style.overflow = 'hidden';

    var wrap = el('div',
      'position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;');
    var tools = el('div',
      'flex:0 0 auto;padding:4px;border-bottom:1px solid ' + DIM + ';display:flex;align-items:center;');
    var bCopy = el('button', smallBtn(), 'COPY');
    var bRe = el('button', smallBtn(), 'REFRESH');
    var st = el('span', 'font-size:11px;color:' + DIM + ';margin-left:2px;', '');
    var out = el('div',
      'flex:1 1 auto;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:6px;' +
      'font-size:11px;line-height:1.35;white-space:pre-wrap;word-break:break-all;' +
      '-webkit-user-select:text;user-select:text;', '');
    tools.appendChild(bCopy);
    tools.appendChild(bRe);
    tools.appendChild(st);
    wrap.appendChild(tools);
    wrap.appendChild(out);
    body.appendChild(wrap);

    var items = [];
    var alive = true;

    function render() {
      if (!alive || !out.parentNode) return;
      out.textContent = itemsToText(items);
    }

    function scan() {
      out.textContent = 'СКАНИРУЮ...';
      setTimeout(function () {
        if (!alive) return;
        items = collectEnv(render);
        render();
      }, 40);
    }

    bCopy.onclick = function () {
      copyText(itemsToText(items), function (res) {
        st.textContent = res ? 'СКОПИРОВАНО' : 'НЕ ВЫШЛО';
        setTimeout(function () { st.textContent = ''; }, 1600);
      });
    };
    bRe.onclick = scan;

    cleanup = function () { alive = false; };
    scan();
  }
})();