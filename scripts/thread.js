/* The thread: one unbroken line for the whole page.
   A single path is built over the whole document from the elements marked data-thread, in page order:
     data-thread="knot"   the line passes straight down through it, and ties it when it gets there.
                          With data-thread-span="<selector>" it leaves the gutter at that box's top,
                          crosses to the knot, and comes back to the gutter at its bottom.
     data-thread="wrap"   the line goes once around the button inside, then ties [data-thread-knot].
     data-thread="end"    the line ends at its top, and ties it.
   Elements with data-fade-after="<knot id>" appear once that knot is tied.
   The line is drawn exactly as far as the reader: to 60% down the screen.

   It is alive, gently:
     - it sways where a mouse brushes it (a touch plucks it), a damped spring of a few pixels;
     - a knot glows when the pointer comes near, and gives one small tug the first time it is tied;
     - when a message is sent (fildevie:message-sent) a light travels up from the knot at the
       button to the top of the page, carrying the message back along the thread;
     - once that light has left the loop round the button (the form is gone by then), the loop
       untwists into a plain stretch of line; fildevie:message-reset ties it round the button again.
   One requestAnimationFrame clock drives the opening draw, the sway, the pulse and the loop. It stops as soon
   as everything is at rest and pauses while the tab is hidden. Frames never read layout: scroll and
   viewport values are cached in their own event handlers, geometry is measured only in build().
   With prefers-reduced-motion (live) or ?fil, the thread is simply drawn in full and stays still. */
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const READ = 0.6;
  const STEP = 150;
  const SUB = 16;           // samples per curve segment
  const CELL = 120;         // proximity grid cell, px
  const SWAY_R = 130;       // half-length of thread that sways, px along the line
  const SWAY_PEAK = 12;     // px
  const OMEGA = 2 * Math.PI * 1.3;
  const ZETA = 0.5;         // damping ratio: two or three soft swings, then still
  const V_MAX = 190;        // px/s; with ζ 0.5 that peaks near 12 px
  const PULSE_MS = 4000;
  const PULSE_SEG = 90;
  const LOOP_MS = 900;      // the loop round the button untwisting, or forming again

  const anchors = [...document.querySelectorAll("[data-thread]")];
  if (!anchors.length) return;

  // ?fil draws the whole thread at once, to check it from top to bottom in one capture
  const fil = new URLSearchParams(location.search).has("fil");
  const mqReduce = matchMedia("(prefers-reduced-motion: reduce)");
  let still = fil || mqReduce.matches;

  const probe = document.createElement("div");
  probe.className = "rail-probe";
  probe.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "page-thread");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("class", "thread-line");
  const swayPath = document.createElementNS(NS, "path"); // the short overlay that sways
  swayPath.setAttribute("class", "thread-sway");
  const loopPath = document.createElementNS(NS, "path"); // the loop round the button, while it untwists
  loopPath.setAttribute("class", "thread-loop");
  svg.append(path, loopPath, swayPath);
  document.body.append(probe, svg);
  const root = document.documentElement;
  root.classList.add("thread-live");
  root.classList.toggle("thread-still", still);

  const knotOf = (a) => (a.dataset.thread === "wrap" ? a.querySelector("[data-thread-knot]") : a);
  const followersOf = new Map();
  document.querySelectorAll("[data-fade-after]").forEach((el) => {
    const id = el.dataset.fadeAfter;
    if (!followersOf.has(id)) followersOf.set(id, []);
    followersOf.get(id).push(el);
  });
  const allFollowers = [...followersOf.values()].flat();
  if (!still) {
    anchors.forEach((a) => { const k = knotOf(a); if (k) k.dataset.knot = "waiting"; });
    allFollowers.forEach((el) => el.classList.add("is-waiting"));
  }

  // Geometry, written only by build()
  let total = 0, d = "";
  let lens = new Float64Array(0);  // length along the path at each sample
  let xs = new Float64Array(0), ys = new Float64Array(0);
  let reach = new Float64Array(0); // the page y the reader must reach for that sample to be drawn
  let grid = new Map();            // proximity grid: cell -> sample indices
  let ties = [];                   // { el, len, i, tied }
  let docH = 0;
  let loopR = null;                // the loop round the button: { i0, i1, bx, by }, bx/by = the same samples untwisted

  // Cached viewport values, read in their own event handlers, never inside a frame
  let sx = scrollX, sy = scrollY, vh = innerHeight;

  // Animation state
  let arrive = still ? 1 : 0, arriveT = still ? 1 : 0;
  let drawn = 0, dirty = true;
  let sentFloor = 0; // a sent message ties the knot at the button, wherever the reader is
  const sway = { on: false, i0: 0, i1: 0, x: 0, v: 0, nx: null, ny: null, w: null };
  let pulse = null; // { t, from, a, b }
  const tugged = new WeakSet();
  // 0: tied round the button, 1: untwisted into the line
  let loopK = 0, loopFrom = 0, loopTo = 0, loopT = 1, loopDur = LOOP_MS, loopPending = false;

  // Seeded jitter: the same hand-drawn line on every visit
  const jitter = (i) => { const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s) - 0.5; };
  const pageBox = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left + sx, r: r.right + sx, t: r.top + sy, b: r.bottom + sy, w: r.width, h: r.height };
  };

  /* ---------- build: measure everything first, then write ---------- */
  function build() {
    // The page-tall SVG must not hold the page open while we measure it: collapse it first,
    // otherwise after a resize the old height stays in scrollHeight and the page stays too tall.
    svg.style.width = "0px";
    svg.style.height = "0px";

    // ---- reads ----
    sx = scrollX; sy = scrollY; vh = innerHeight;
    const W = root.clientWidth;
    const H = Math.max(root.scrollHeight, document.body.scrollHeight);
    const rx = probe.getBoundingClientRect().left + sx;
    const boxes = anchors.map((a) => {
      const kind = a.dataset.thread;
      const span = kind === "knot" && a.dataset.threadSpan ? a.closest(a.dataset.threadSpan) : null;
      return {
        a, kind,
        b: pageBox(a),
        span: span ? pageBox(span) : null,
        btn: kind === "wrap" ? pageBox(a.querySelector("button, a") || a) : null,
      };
    });

    // ---- pure computation ----
    const amp = W >= 1024 ? 12 : 7;
    let n = 0;
    const lean = (y) => amp * (Math.sin(y / 170 + 0.6) * 0.7 + Math.sin(y / 63) * 0.2 + jitter(n++) * 0.25);
    const pts = [{ x: rx, y: 0, v: true }];
    const tieAt = [];
    let wrapAt = null;
    let lastY = 0;
    let ended = false;
    const rail = (y0, y1) => {
      const span = y1 - y0;
      if (span < STEP * 1.2) return;
      const k = Math.round(span / STEP);
      for (let i = 1; i < k; i++) { const y = y0 + (span * i) / k; pts.push({ x: rx + lean(y), y }); }
    };
    const through = (cx, cy, R) => pts.push({ x: cx, y: cy - R, v: true }, { x: cx, y: cy, v: true }, { x: cx, y: cy + R, v: true });

    for (const { a, kind, b, span, btn } of boxes) {
      if (!b.w && !b.h) continue;     // hidden
      if (b.t < lastY - 1) continue;  // never loop back up the page
      if (kind === "knot") {
        const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2, R = Math.min(b.h / 2, 26);
        if (span) {
          rail(lastY, span.t);
          pts.push({ x: rx, y: span.t, v: true });
          through(cx, cy, R);
          tieAt.push({ el: a, idx: pts.length - 2 });
          pts.push({ x: rx, y: span.b, v: true });
          lastY = span.b;
        } else {
          rail(lastY, cy - R);
          through(cx, cy, R);
          tieAt.push({ el: a, idx: pts.length - 2 });
          lastY = cy + R;
        }
      } else if (kind === "wrap") {
        const p = 12, L = btn.l, R = btn.r, T = btn.t, B = btn.b, M = (T + B) / 2, w = R - L;
        rail(lastY, T - 70);
        pts.push({ x: rx, y: T - 70, v: true });
        const s0 = pts.length - 1;
        // In at the left, once around the button, and tied where it started
        pts.push(
          { x: L - p, y: M - 2 },
          { x: L - p * 0.5, y: B + p * 0.8 },
          { x: L + w * 0.5, y: B + p * 1.05 },
          { x: R + p * 0.7, y: B + p * 0.5 },
          { x: R + p, y: M },
          { x: R + p * 0.6, y: T - p * 0.8 },
          { x: L + w * 0.5, y: T - p * 1.05 },
          { x: L - p * 0.4, y: T - p * 0.6 },
          { x: L - p * 1.15, y: M + 3 },
        );
        tieAt.push({ el: knotOf(a), idx: pts.length - 1 });
        pts.push({ x: rx, y: B + 70, v: true });
        if (!wrapAt && a.matches(".ct-tie")) wrapAt = { s: s0, e: pts.length - 1, y0: T - 70, y1: B + 70, bend: amp * 0.35 };
        lastY = B + 70;
      } else if (kind === "end") {
        const ex = (b.l + b.r) / 2, ey = b.t;
        rail(lastY, ey - 60);
        pts.push({ x: ex, y: ey - 60, v: true }, { x: ex, y: ey, v: true });
        tieAt.push({ el: a, idx: pts.length - 1 });
        ended = true;
        break;
      }
    }
    if (!ended) { rail(lastY, H); pts.push({ x: rx, y: H, v: true }); }

    // Hermite curve through the points, as cubic Béziers; vertical points get a vertical tangent
    const tangent = (i) => {
      const p0 = pts[i - 1] || { x: pts[i].x, y: pts[i].y - 120 };
      const p2 = pts[i + 1] || { x: pts[i].x, y: pts[i].y + 120 };
      return pts[i].v ? { x: 0, y: Math.max(240, Math.abs(p2.y - p0.y) / 2) } : { x: (p2.x - p0.x) / 2, y: (p2.y - p0.y) / 2 };
    };
    const tans = pts.map((_, i) => tangent(i));
    const f = (v) => v.toFixed(1);
    let dd = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    const segStart = [];
    const X = [pts[0].x], Y = [pts[0].y], Ls = [0];
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      // Handles never longer than half the segment, so short stretches (through a knot) never overshoot
      const cap = Math.hypot(b.x - a.x, b.y - a.y) * 0.5;
      const h = (t) => { const l = Math.hypot(t.x, t.y) / 3; const k = l > cap ? cap / l : 1; return { x: (t.x / 3) * k, y: (t.y / 3) * k }; };
      const h1 = h(tans[i]), h2 = h(tans[i + 1]);
      const c1 = { x: a.x + h1.x, y: a.y + h1.y };
      const c2 = { x: b.x - h2.x, y: b.y - h2.y };
      dd += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(b.x)} ${f(b.y)}`;
      segStart.push(acc);
      // Sample the segment ourselves: fast, and the lengths match the dash pattern (pathLength)
      let px = a.x, py = a.y;
      for (let k = 1; k <= SUB; k++) {
        const t = k / SUB, u = 1 - t;
        const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
        const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
        acc += Math.hypot(x - px, y - py);
        X.push(x); Y.push(y); Ls.push(acc);
        px = x; py = y;
      }
    }
    segStart.push(acc);

    // How far down the reader must be for each sample to be drawn: the highest point reached so far.
    // Where the line stops going down (the crossing to the big knot, the loop round the button),
    // that stretch is spread over the screen's worth of scroll just before it, so it is drawn, not dropped in.
    const N = Y.length;
    const L = Float64Array.from(Ls);
    const Rch = new Float64Array(N);
    let mx = -Infinity;
    for (let i = 0; i < N; i++) { mx = Math.max(mx, Y[i]); Rch[i] = mx; }
    const D = vh * 0.15;
    for (let i = 1; i < N;) {
      if (Rch[i] > Rch[i - 1] + 0.01) { i++; continue; }
      let j = i;
      while (j + 1 < N && Rch[j + 1] <= Rch[i] + 0.01) j++;
      if (L[j] - L[i - 1] > 40) {
        const v = Rch[i];
        let i0 = i - 1;
        while (i0 > 0 && Rch[i0 - 1] >= v - D) i0--;
        const a = Rch[i0], l0 = L[i0], l1 = L[j];
        for (let k = i0; k <= j; k++) Rch[k] = a + ((v - a) * (L[k] - l0)) / (l1 - l0 || 1);
      }
      i = j + 1;
    }

    // Proximity grid for the sway
    const g = new Map();
    for (let i = 0; i < N; i++) {
      const key = Math.floor(Y[i] / CELL) * 64 + Math.min(63, Math.max(0, Math.floor(X[i] / CELL)));
      const cell = g.get(key);
      if (cell) cell.push(i); else g.set(key, [i]);
    }

    // The loop untwisted: each of its samples has a partner on a gently bowed vertical line between the
    // loop's two ends, at the same fraction of length. Both shapes share their ends, so the line never breaks.
    let LR = null;
    if (wrapAt) {
      const i0 = wrapAt.s * SUB, i1 = wrapAt.e * SUB, span = L[i1] - L[i0] || 1;
      const bx = new Float64Array(i1 - i0 + 1), by = new Float64Array(i1 - i0 + 1);
      for (let j = i0; j <= i1; j++) {
        const u = (L[j] - L[i0]) / span;
        bx[j - i0] = rx + wrapAt.bend * Math.sin(Math.PI * u);
        by[j - i0] = wrapAt.y0 + (wrapAt.y1 - wrapAt.y0) * u;
      }
      LR = { i0, i1, bx, by };
    }

    const prevTied = new Map(ties.map((t) => [t.el, t.tied]));
    const prevPulseFrom = pulse ? pulse.from : 0;
    const oldTotal = total;

    // ---- commit ----
    total = acc; d = dd; docH = H;
    lens = L; xs = Float64Array.from(X); ys = Float64Array.from(Y); reach = Rch; grid = g; loopR = LR;
    ties = tieAt.filter((t) => t.el).map((t) => ({ el: t.el, len: segStart[t.idx], i: t.idx * SUB, tied: prevTied.get(t.el) || false }));

    // ---- writes ----
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = `${W}px`;
    svg.style.height = `${H}px`;
    path.setAttribute("d", d);
    path.setAttribute("pathLength", total.toFixed(2));
    endSway();
    if (sentFloor) sentFloor = sentLength();
    drawLoop();
    if (pulse) {
      // The page often reflows right after sending: keep the light where it was, on the new line
      const tie = pulseTie();
      pulse.from = tie ? tie.len : (prevPulseFrom / (oldTotal || 1)) * total;
      for (const p of [pulse.a, pulse.b]) { p.setAttribute("d", d); p.setAttribute("pathLength", total.toFixed(2)); }
    }
    dirty = true;
    paint();
  }

  /* ---------- drawing ---------- */
  // How much thread the reader has drawn (cached scroll values only)
  function readerLength() {
    if (still) return total;
    return Math.max(sentFloor, scrollLength());
  }
  function scrollLength() {
    if (sy + vh >= docH - 2) return total; // the end of the page ties everything
    const Yr = sy + vh * READ;
    const N = reach.length;
    if (!N || reach[0] > Yr) return 0;
    let lo = 0, hi = N - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (reach[mid] <= Yr) lo = mid; else hi = mid - 1; }
    if (lo >= N - 1) return total;
    const span = reach[lo + 1] - reach[lo];
    const t = span > 0 ? Math.min(1, (Yr - reach[lo]) / span) : 0;
    return lens[lo] + (lens[lo + 1] - lens[lo]) * t;
  }

  function paint() {
    dirty = false;
    drawn = readerLength() * arrive;
    if (sway.on && lens[sway.i1] > drawn) endSway();
    // Gaps in the drawn line where an overlay stands in for it (the sway, the loop untwisting);
    // each overlay meets the line exactly at both ends
    const gaps = [];
    if (sway.on) gaps.push([lens[sway.i0], lens[sway.i1]]);
    if (loopR && loopK > 0) gaps.push([lens[loopR.i0], lens[loopR.i1]]);
    if (gaps.length) {
      gaps.sort((p, q) => p[0] - q[0]);
      const arr = [];
      let pos = 0;
      for (const [g0, g1] of gaps) {
        if (g0 >= drawn) break;
        arr.push(Math.max(0, g0 - pos), g1 - g0);
        pos = g1;
      }
      const rest = drawn - pos;
      // never leave a zero-length dash: with round caps it would draw a dot
      if (rest > 0.5) arr.push(rest, total * 2 + 2);
      else arr[arr.length - 1] += total * 2 + 2;
      path.style.strokeDasharray = arr.join(" ");
      path.style.strokeDashoffset = "0";
    } else {
      path.style.strokeDasharray = `${total} ${total + 2}`;
      path.style.strokeDashoffset = String(total - drawn);
    }
    for (const t of ties) {
      const tied = drawn >= t.len - 1;
      if (tied === t.tied) continue;
      t.tied = tied;
      t.el.dataset.knot = tied ? "tied" : "waiting";
      if (!tied) continue;
      if (t.el.id) (followersOf.get(t.el.id) || []).forEach((el) => el.classList.remove("is-waiting"));
      // One small tug, the first time only
      if (!still && !tugged.has(t.el)) {
        tugged.add(t.el);
        t.el.classList.add("is-tying");
        t.el.addEventListener("animationend", () => t.el.classList.remove("is-tying"), { once: true });
      }
    }
  }

  /* ---------- the one clock ---------- */
  let raf = 0, last = 0;
  const wake = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); };
  const easeArrive = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  // Leaves the knot slowly enough to be seen, rushes up the page, settles at the top
  const easePulse = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - 8 * (1 - t) ** 4);
  // Unhurried at both ends, like a thread let go of
  const easeLoop = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

  function tick(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    let busy = false;

    if (arriveT < 1) {
      arriveT = Math.min(1, arriveT + dt / 1.6);
      arrive = easeArrive(arriveT);
      dirty = true;
      busy = arriveT < 1;
    }

    if (sway.on) {
      // Damped spring, a few substeps for stability
      for (let k = 0; k < 4; k++) {
        const h = dt / 4;
        sway.v += (-OMEGA * OMEGA * sway.x - 2 * ZETA * OMEGA * sway.v) * h;
        sway.x += sway.v * h;
      }
      sway.x = Math.max(-SWAY_PEAK, Math.min(SWAY_PEAK, sway.x));
      if (Math.abs(sway.x) < 0.05 && Math.abs(sway.v) < 0.5) endSway();
      else { drawSway(); busy = true; }
    }

    if (loopT < 1) {
      loopT = Math.min(1, loopT + (dt * 1000) / loopDur);
      loopK = loopFrom + (loopTo - loopFrom) * easeLoop(loopT);
      drawLoop();
      dirty = true;
      busy = loopT < 1;
    }

    if (pulse) {
      pulse.t += (dt * 1000) / PULSE_MS;
      if (pulse.t >= 1) endPulse();
      else { stepPulse(); busy = true; }
    }

    if (dirty) paint();
    // something started during this frame may already have asked for the next one (wake)
    if (busy && !raf) raf = requestAnimationFrame(tick);
    else if (!raf) last = 0;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; last = 0; }
    else wake();
  });

  /* ---------- sway ---------- */
  function nearest(x, y, max) {
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let best = -1, bd = max * max;
    for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        if (gx < 0 || gx > 63) continue;
        const cell = grid.get(gy * 64 + gx);
        if (!cell) continue;
        for (const i of cell) {
          const dx = xs[i] - x, dy = ys[i] - y, dd = dx * dx + dy * dy;
          if (dd < bd) { bd = dd; best = i; }
        }
      }
    }
    return best < 0 ? null : { i: best, d: Math.sqrt(bd) };
  }

  function pluck(i, push) {
    if (lens[i] + SWAY_R > drawn) return; // only thread already drawn
    if (!sway.on || (Math.abs(sway.x) < 1.5 && Math.abs(sway.v) < 20)) {
      const N = lens.length;
      let i0 = i, i1 = i;
      while (i0 > 1 && lens[i] - lens[i0] < SWAY_R) i0--;
      while (i1 < N - 2 && lens[i1] - lens[i] < SWAY_R) i1++;
      if (lens[i1] - lens[i] < SWAY_R * 0.6 || lens[i] - lens[i0] < SWAY_R * 0.6) return; // too near an end
      if (loopR && loopK > 0 && i1 >= loopR.i0 && i0 <= loopR.i1) return; // the loop is not where the line is now
      const m = i1 - i0 + 1;
      sway.nx = new Float64Array(m); sway.ny = new Float64Array(m); sway.w = new Float64Array(m);
      // Normal at the centre, oriented to point right on a falling line; the others follow it
      let cxn = -(ys[i + 1] - ys[i - 1]), cyn = xs[i + 1] - xs[i - 1];
      if (cxn < 0) { cxn = -cxn; cyn = -cyn; }
      for (let k = 0; k < m; k++) {
        const j = i0 + k;
        let nx = -(ys[j + 1] - ys[j - 1]), ny = xs[j + 1] - xs[j - 1];
        const l = Math.hypot(nx, ny) || 1;
        nx /= l; ny /= l;
        if (nx * cxn + ny * cyn < 0) { nx = -nx; ny = -ny; }
        sway.nx[k] = nx; sway.ny[k] = ny;
        const u = (lens[j] - lens[i]) / SWAY_R; // -1..1
        sway.w[k] = 0.5 + 0.5 * Math.cos(Math.PI * Math.max(-1, Math.min(1, u)));
      }
      const cl = Math.hypot(cxn, cyn) || 1;
      sway.cn = { x: cxn / cl, y: cyn / cl };
      sway.i0 = i0; sway.i1 = i1;
      if (!sway.on) { sway.on = true; sway.x = 0; sway.v = 0; dirty = true; }
    }
    const vn = push.x * sway.cn.x + push.y * sway.cn.y;
    sway.v = Math.max(-V_MAX, Math.min(V_MAX, sway.v + vn));
    wake();
  }

  function drawSway() {
    const { i0, i1, nx, ny, w, x } = sway;
    let p = "";
    let px = 0, py = 0;
    for (let k = 0, j = i0; j <= i1; k++, j++) {
      const qx = xs[j] + nx[k] * w[k] * x, qy = ys[j] + ny[k] * w[k] * x;
      if (!k) p = `M${qx.toFixed(1)} ${qy.toFixed(1)}`;
      else p += ` Q${px.toFixed(1)} ${py.toFixed(1)} ${((px + qx) / 2).toFixed(1)} ${((py + qy) / 2).toFixed(1)}`;
      px = qx; py = qy;
    }
    p += ` L${px.toFixed(1)} ${py.toFixed(1)}`;
    swayPath.setAttribute("d", p);
  }

  function endSway() {
    if (!sway.on) return;
    sway.on = false; sway.x = 0; sway.v = 0;
    swayPath.removeAttribute("d");
    dirty = true;
  }

  // Mouse and pen sway it by moving across; touch only plucks on pointerdown (scrolling never sways it)
  let wasNear = false, lastX = 0, lastY = 0, lastT = 0;
  const nearKnots = new Set();
  function knotsNear(x, y) {
    for (const t of ties) {
      const near = t.tied && Math.hypot(xs[t.i] - x, ys[t.i] - y) < 72;
      if (near === nearKnots.has(t.el)) continue;
      if (near) nearKnots.add(t.el); else nearKnots.delete(t.el);
      t.el.classList.toggle("is-near", near);
    }
  }
  addEventListener("pointermove", (e) => {
    if (still || e.pointerType === "touch") return;
    const x = e.clientX + sx, y = e.clientY + sy, t = e.timeStamp;
    let vx = 0, vy = 0;
    if (lastT && t - lastT < 120 && t > lastT) { vx = ((x - lastX) * 1000) / (t - lastT); vy = ((y - lastY) * 1000) / (t - lastT); }
    lastX = x; lastY = y; lastT = t;
    knotsNear(x, y);
    const hit = nearest(x, y, 80);
    if (!hit || hit.d > 56) { wasNear = false; return; }
    if (hit.d < 28 && !wasNear) {
      wasNear = true;
      pluck(hit.i, { x: vx * 0.3, y: vy * 0.3 });
    }
  }, { passive: true });
  addEventListener("pointerdown", (e) => {
    if (still) return;
    const x = e.clientX + sx, y = e.clientY + sy;
    const hit = nearest(x, y, 56);
    if (!hit) return;
    // A pluck: pushed away from the finger
    const s = Math.sign((xs[hit.i] - x) || 1);
    pluck(hit.i, { x: s * V_MAX * 0.9, y: 0 });
  }, { passive: true });

  /* ---------- pulse: a message travels up the thread ---------- */
  function pulseTie() {
    const k = document.querySelector(".ct-tie [data-thread-knot]");
    return ties.find((t) => t.el === k) || null;
  }
  function startPulse() {
    if (still || !total) return;
    const tie = pulseTie();
    if (!tie) return;
    if (pulse) endPulse();
    const mk = (cls) => {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("class", cls);
      p.setAttribute("d", d);
      p.setAttribute("pathLength", total.toFixed(2));
      p.style.strokeDasharray = `${PULSE_SEG} ${total * 2 + PULSE_SEG}`;
      return p;
    };
    pulse = { t: 0, from: tie.len, a: mk("thread-pulse-halo"), b: mk("thread-pulse") };
    svg.append(pulse.a, pulse.b);
    lightKnot(tie.el);
    paint();
    stepPulse();
    wake();
  }
  function stepPulse() {
    const { t, from, a, b } = pulse;
    const head = from - (from + PULSE_SEG) * easePulse(t); // dash start, from the button knot to past the top
    const op = Math.min(1, t / 0.08, (1 - t) / 0.12);
    for (const p of [a, b]) { p.style.strokeDashoffset = String(-head); p.style.opacity = op.toFixed(3); }
    // The light has left the loop round the button: let the loop go
    if (loopPending && loopR && head + PULSE_SEG <= lens[loopR.i0]) loosen();
    for (const k of ties) {
      if (k.len < from - 1 && head <= k.len && !pulse.lit?.has(k.el)) {
        (pulse.lit ||= new Set()).add(k.el);
        lightKnot(k.el);
      }
    }
  }
  function endPulse() {
    if (!pulse) return;
    pulse.a.remove(); pulse.b.remove();
    pulse = null;
    if (loopPending) loosen();
  }
  function lightKnot(el) {
    el.classList.add("is-lit");
    setTimeout(() => el.classList.remove("is-lit"), 1400);
  }

  /* ---------- the loop round the button: untwists after sending, ties again for another word ---------- */
  // Drawn through the end of the loop, wherever the reader is: a sent message ties the knot at the button
  function sentLength() {
    const t = pulseTie();
    return Math.max(t ? t.len + 1 : 0, loopR ? lens[loopR.i1] + 1 : 0);
  }
  function drawLoop() {
    if (!loopR || loopK <= 0) { loopPath.removeAttribute("d"); return; }
    const { i0, i1, bx, by } = loopR, k = loopK, u = 1 - k;
    let p = "";
    for (let j = i0; j <= i1; j++) {
      const x = xs[j] * u + bx[j - i0] * k, y = ys[j] * u + by[j - i0] * k;
      p += `${j === i0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    loopPath.setAttribute("d", p);
  }
  function setLoop(to) {
    if (still) {
      loopK = loopTo = to; loopT = 1;
      drawLoop(); paint();
      return;
    }
    endSway();
    loopFrom = loopK; loopTo = to; loopT = 0;
    loopDur = Math.max(1, LOOP_MS * Math.abs(to - loopFrom));
    wake();
  }
  function loosen() {
    loopPending = false;
    if (loopTo !== 1 || loopK !== 1) setLoop(1);
  }
  // The acknowledgement is showing in place of the form (not the plain fallback, where the button stays)
  const formGone = () => {
    const thanks = document.querySelector("#contact .ct-thanks");
    return !!thanks && !thanks.hidden;
  };
  document.addEventListener("fildevie:message-sent", () => {
    sentFloor = Math.max(sentFloor, sentLength());
    startPulse();
    if (!loopR || !formGone()) return;
    loopPending = true;
    if (!pulse) loosen(); // reduced motion: no light to wait for
    paint();
  });
  document.addEventListener("fildevie:message-reset", () => {
    loopPending = false;
    if (loopK > 0 || loopTo !== 0) setLoop(0);
  });

  /* ---------- reduced motion, live ---------- */
  mqReduce.addEventListener("change", () => {
    still = fil || mqReduce.matches;
    root.classList.toggle("thread-still", still);
    endSway();
    endPulse();
    arriveT = 1; arrive = 1;
    if (loopT < 1) { loopT = 1; loopK = loopTo; drawLoop(); }
    if (still) {
      allFollowers.forEach((el) => el.classList.remove("is-waiting"));
      ties.forEach((t) => t.el.classList.remove("is-tying", "is-near", "is-lit"));
      nearKnots.clear();
    }
    paint();
  });

  /* ---------- keeping it anchored ---------- */
  let buildTimer = 0;
  const scheduleBuild = () => {
    if (buildTimer) return;
    buildTimer = setTimeout(() => { buildTimer = 0; build(); }, 0);
  };
  addEventListener("scroll", () => { sx = scrollX; sy = scrollY; dirty = true; wake(); }, { passive: true });
  addEventListener("resize", scheduleBuild);
  addEventListener("load", scheduleBuild);
  // Runs after layout and before paint, so the line never lags a reflow by a frame
  new ResizeObserver(() => build()).observe(document.body);
  if (document.fonts) document.fonts.ready.then(scheduleBuild).catch(() => {});
  build();
  if (!still) wake(); // the thread unspools from the top edge as the page opens

  // Other scripts can ask for a rebuild after changing the page (the shop renders late)
  window.FDV = Object.assign(window.FDV || {}, { rebuildThread: scheduleBuild });
})();
