/* The thread: one unbroken line for the whole page.
   A single path is built over the whole document from the elements marked data-thread, in page order:
     data-thread="knot"   the line passes straight down through it, and ties it when it gets there.
                          With data-thread-span="<selector>" it leaves the gutter at that box's top,
                          crosses to the knot, and comes back to the gutter at its bottom.
     data-thread="wrap"   the line goes once around the button inside, then ties [data-thread-knot].
     data-thread="end"    the line ends at its top, and ties it.
   A knot with data-thread-hold keeps the line at its own x until the next knot, instead of going back
   to the gutter: that is how the accompaniment's steps are strung one to the next.
   data-thread="around" the line leaves the gutter and curves round the element's box (side left|right,
                          data-thread-clear for the clearance, data-thread-enclose to take in its children),
                          checked in build() so no sample falls in text; otherwise it stays in the gutter.
   data-thread-tie="overhand|figure8|rail" draws a real knot (generated points, part of the same path)
                          at that element, sized by data-thread-knot-size (-narrow); if the knot cannot
                          clear the text it slides along the rail, then falls back to the icon
                          (data-thread-bead). A knot gives one small cinch the first time it is tied.
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
  // Draw pacing of knots and detours (fractions of the viewport height, see docs/thread-route.md)
  const KNOT_PRE = 0.15, KNOT_POST = 0.15;
  const DETOUR_MIN = 0.25, DETOUR_RATE = 2, DETOUR_LEAD = 0.35;
  const DETOUR_LAG = 0.5, TIP_LO = 0.1, TIP_HI = 0.95;
  const LEG_RATE = 2.2;     // px of line per px of scroll on the legs of a knot tied between them (K3)
  const HOLD_DROP = 28;     // px the held line keeps going below a step's text before it steps sideways
  const CINCH_MS = 700;     // a knot pulls tight once, when tied

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
  const cinchPath = document.createElementNS(NS, "path"); // a knot being pulled tight, once
  cinchPath.setAttribute("class", "thread-cinch");
  svg.append(path, loopPath, swayPath, cinchPath);
  document.body.append(probe, svg);
  const root = document.documentElement;
  root.classList.add("thread-live");
  root.classList.toggle("thread-still", still);

  const knotOf = (a) => (a.dataset.thread === "wrap" ? a.querySelector("[data-thread-knot]") : a.dataset.thread === "around" && !a.dataset.threadTie ? null : a);
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
  let ties = [];                   // { el, len, i, tied, g }: g = the knot's own samples when the line draws it
  let knotR = [];                  // the samples of the knots the line draws: rigid, they never sway
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
  const cinch = { on: false, t: 0, i0: 0, i1: 0, cx: 0, cy: 0, w: null };
  // 0: tied round the button, 1: untwisted into the line
  let loopK = 0, loopFrom = 0, loopTo = 0, loopT = 1, loopDur = LOOP_MS, loopPending = false;

  // Seeded jitter: the same hand-drawn line on every visit
  const jitter = (i) => { const s = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s) - 0.5; };
  const pageBox = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left + sx, r: r.right + sx, t: r.top + sy, b: r.bottom + sy, w: r.width, h: r.height };
  };

  /* ---------- the route: knots and detours (docs/thread-route.md) ---------- */
  // Knot glyphs, drawn by the line itself as fixed cubics. Unit size, travelling downward, origin at the
  // centre, entry (0,-28) and exit (0,28) with vertical tangents; each segment is [c1x,c1y,c2x,c2y,x,y].
  const GLYPH = {
    overhand: { w: 24.2, hw: 12.2, segs: [[0, -19, -12, -17, -12, -6], [-12, 6, 4, 11, 10, 4], [15, -2, 11, -14, 1, -13], [-7, -12, -8, -3, -3, 3], [0, 8, 0, 15, 0, 28]] },
    figure8: { w: 26, hw: 13, segs: [[0, -20, 13, -21, 13, -12], [13, -3, -13, -2, -13, 8], [-13, 18, 13, 18, 13, 8], [13, -2, -12, -4, -12, -12], [-12, -20, -2, -20, 0, -12], [2, -2, 0, 12, 0, 28]] },
  };
  const TEXT_SEL = "h1,h2,h3,p,li,blockquote,figcaption,label,input,textarea,select,button,a,dt,dd,.cqr-a,.cqr-b";
  const PIC_SEL = "figure,[data-slot='photo']";
  const secOf = (el) => el.closest("section, footer, header");
  const slideOffs = [0];
  for (let o = 8; o <= 120; o += 8) slideOffs.push(-o);
  for (let o = 8; o <= 120; o += 8) slideOffs.push(o);
  const invArrive = (u) => (u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2));
  const QUARTER = 0.5523;
  const debug = new URLSearchParams(location.search).get("fil") === "debug";

  // Where the points go: the same line as always, plus knots and detours. Pure; build() measures, this computes.
  function layout(boxes, lvl, env) {
    const { W, H, rx, obst } = env;
    const amp = W >= 1024 ? 12 : 7;
    let n = 0;
    const lean = (y) => amp * (Math.sin(y / 170 + 0.6) * 0.7 + Math.sin(y / 63) * 0.2 + jitter(n++) * 0.25);
    const pts = [{ x: rx, y: 0, v: true }];
    const tieAt = [], feats = [], fallback = new Set();
    let wrapAt = null, lastY = 0, ended = false, baseX = rx;
    const rail = (y0, y1) => {
      const span = y1 - y0;
      if (span < STEP * 1.2) return;
      const k = Math.round(span / STEP);
      const sway = baseX === rx ? 1 : 0.35;
      for (let i = 1; i < k; i++) { const y = y0 + (span * i) / k; pts.push({ x: baseX + lean(y) * sway, y }); }
    };
    const through = (cx, cy, R) => pts.push({ x: cx, y: cy - R, v: true }, { x: cx, y: cy, v: true }, { x: cx, y: cy + R, v: true });
    const glyph = (type, cx, cy, S) => {
      const G = GLYPH[type], k = S / G.w, T = (x, y) => ({ x: cx + x * k, y: cy + y * k });
      const p0 = pts.length;
      pts.push({ x: cx, y: cy - 28 * k, v: true });
      for (const s of G.segs) pts.push({ ...T(s[4], s[5]), fx: [T(s[0], s[1]), T(s[2], s[3])] });
      pts[pts.length - 1].v = true;
      return { p0, p1: pts.length - 1, k, hw: G.hw * k };
    };
    const sizeOf = (a, narrow) => {
      const v = narrow && a.dataset.threadKnotSizeNarrow ? +a.dataset.threadKnotSizeNarrow : +a.dataset.threadKnotSize || 48;
      return Math.min(70, Math.max(40, v));
    };
    const gRange = (g) => ({ i0: g.p0 * SUB, i1: g.p1 * SUB });
    const lvOf = (a) => lvl.get(a) || 0;
    // The first position of the slide rule whose entry is below the line so far (the line never goes back up)
    const slide = (a, type, S, idx, cy) => {
      const k = S / GLYPH[type].w;
      let i = idx;
      while (slideOffs[i] !== undefined && cy + slideOffs[i] - 28 * k < lastY + 4) i++;
      if (i !== idx) lvl.set(a, (lvl.get(a) || 0) + (i - idx));
      return slideOffs[i] === undefined ? null : cy + slideOffs[i];
    };
    // A knot tied on the rail
    const railKnot = (e, type, cx, cy, S, idx) => {
      const y = slide(e.a, type, S, idx, cy);
      if (y === null) { fallback.add(e.a); return false; }
      const k = S / GLYPH[type].w;
      rail(lastY, y - 28 * k - 30);
      pts.push({ x: rx, y: y - 28 * k - 30, v: true });
      const g = glyph(type, cx, y, S);
      tieAt.push({ el: e.a, idx: g.p1, g });
      // A knot tied beside a picture (the phone's route round the Nathalie photo) is checked against that picture
      // with the usual 8 px: the picture holds the anchor, so tooClose would otherwise skip it
      const beside = e.kind === "around" ? { skip: e.a, extra: [{ l: e.b.l, r: e.b.r, t: e.b.t, b: e.b.b, c: 8 }] } : null;
      feats.push({ a: e.a, kind: "knot", sec: e.sec, k: gRange(g), i0: g.p0 * SUB, i1: g.p1 * SUB, ...beside });
      lastY = y + 28 * k;
      baseX = rx;
      return true;
    };

    // A detour round an element: left or right of it, or all round (enclose)
    const detour = (e) => {
      const { a, b } = e;
      const side = a.dataset.threadSide || "left";
      const type = a.dataset.threadTie;
      const clearAttr = +a.dataset.threadClear || 28;
      const inSec = obst.filter((o) => o.sec === e.sec && !a.contains(o.el));
      const key = a;
      let L, B, p0, p1, knot = null, extra;
      const leg = (x, y0, y1) => {
        const m = Math.ceil((y1 - y0) / STEP);
        for (let i = 1; i < m; i++) { const y = y0 + ((y1 - y0) * i) / m; pts.push({ x: x + lean(y) * 0.35, y, v: true }); }
      };
      if (side === "enclose") {
        if (!e.lis || !e.lis.length) return false;
        const U = { l: Math.min(...e.lis.map((q) => q.l)), r: Math.max(...e.lis.map((q) => q.r)), t: Math.min(...e.lis.map((q) => q.t)), b: Math.max(...e.lis.map((q) => q.b)) };
        const c = Math.max(24, clearAttr), R = 40;
        const tr = U.t - c;
        L = Math.max(lastY, tr - 48);
        const belowT = Math.min(Infinity, ...inSec.filter((o) => o.t >= U.b - 1).map((o) => o.t));
        const gap = belowT - U.b;
        const yb = U.b + Math.min(c, gap / 2);
        const Rx = U.r + c, Sx = U.l;
        if (Rx - Sx < 200 || yb - tr < 2 * R + 40) return false;
        B = yb + 60;
        rail(lastY, L);
        pts.push({ x: rx, y: L, v: true });
        p0 = pts.length - 1;
        pts.push({ x: rx + (Sx - rx) * 0.4, y: L + (tr - L) * 0.6 }, { x: Sx, y: tr, hz: true });
        for (let x = Sx + STEP; x < Rx - R - 20; x += STEP) pts.push({ x, y: tr + jitter(n++) * 3 });
        pts.push({ x: Rx - R, y: tr }, { x: Rx - R + 28.3, y: tr + 11.7 }, { x: Rx, y: tr + R, v: true });
        leg(Rx, tr + R, yb - R);
        pts.push({ x: Rx, y: yb - R, v: true }, { x: Rx - 11.7, y: yb - 11.7 }, { x: Rx - R, y: yb });
        for (let x = Rx - R - STEP; x > Sx + 20; x -= STEP) pts.push({ x, y: yb + jitter(n++) * 3 });
        pts.push({ x: Sx, y: yb, hz: true });
        pts.push({ x: rx + (Sx - rx) * 0.6, y: yb + 9 }, { x: rx + (Sx - rx) * 0.25, y: yb + 36 }, { x: rx, y: B, v: true });
        p1 = pts.length - 1;
        extra = [{ ...U, c: 24 }];
      } else {
        const dir = side === "right" ? 1 : -1;
        const S = type ? sizeOf(a, false) : 0;
        const hw = type ? GLYPH[type].hw * (S / GLYPH[type].w) : 0;
        const legX = dir < 0 ? b.l - (type ? clearAttr : Math.max(24, clearAttr)) - hw : b.r + (type ? clearAttr : Math.max(24, clearAttr)) + hw;
        const lo = Math.min(rx, legX) - 24, hi = Math.max(rx, legX) + 24;
        const hX = Math.abs(legX - rx), hc = Math.max(70, Math.min(150, hX * 0.3));
        const above = Math.max(lastY, ...inSec.filter((o) => o.t < b.t && o.r > lo && o.l < hi).map((o) => o.b));
        L = Math.max(lastY, above + 24, b.t - 64);
        const yA = L + hc;
        // the group: the element plus the captions that hang under it, aligned with its edge
        let gb = b.b;
        for (let grew = true; grew;) {
          grew = false;
          for (const o of inSec) if (!o.pic && Math.abs((dir < 0 ? o.l - b.l : o.r - b.r)) < 6 && o.t >= b.t && o.t <= gb + 60 && o.b > gb) { gb = o.b; grew = true; }
        }
        const belowT = Math.min(Infinity, ...inSec.filter((o) => o.t >= gb - 1).map((o) => o.t));
        B = Math.min(gb + 48, belowT - 24);
        const Rs = Math.min(gb - 0.25 * (gb - b.t), B - hc);
        if (Rs < yA + 60 || !isFinite(B)) return false;
        rail(lastY, L);
        pts.push({ x: rx, y: L, v: true });
        p0 = pts.length - 1;
        pts.push({ x: rx + (legX - rx) / 3, y: L + hc * 0.35 }, { x: rx + ((legX - rx) * 2) / 3, y: L + hc * 0.75 }, { x: legX, y: yA, v: true });
        const cy = b.t + b.h / 2, k = type ? S / GLYPH[type].w : 0;
        if (type && cy - 28 * k >= yA + 20 && cy + 28 * k <= Rs - 20) {
          leg(legX, yA, cy - 28 * k);
          const g = glyph(type, legX, cy, S);
          knot = gRange(g);
          tieAt.push({ el: a, idx: g.p1, g });
          leg(legX, cy + 28 * k, Rs);
        } else leg(legX, yA, Rs);
        pts.push({ x: legX, y: Rs, v: true });
        const dy = B - Rs;
        pts.push({ x: rx + ((legX - rx) * 2) / 3, y: Rs + dy * 0.25 }, { x: rx + (legX - rx) / 3, y: Rs + dy * 0.65 }, { x: rx, y: B, v: true });
        p1 = pts.length - 1;
        extra = [{ l: b.l, r: b.r, t: b.t, b: b.b, c: 8 }];
      }
      feats.push({ a: key, kind: "detour", sec: e.sec, skip: a, extra, k: knot, i0: p0 * SUB, i1: p1 * SUB, L, B });
      lastY = B;
      baseX = rx;
      return true;
    };

    let holdY = null;
    for (const e of boxes) {
      const { a, kind, b, span, btn, holdB } = e;
      if (!b.w && !b.h) continue;     // hidden
      if (b.t < lastY - 1) continue;  // never loop back up the page
      // A held line drops straight down past its whole step before it leaves for the next anchor
      if (holdY !== null) {
        // …and a little past it: the sideways step to the next knot starts 28 px below the step's last line
        holdY = Math.min(holdY + HOLD_DROP, Math.max(holdY, b.t - 12));
        if (holdY > lastY) { rail(lastY, holdY); pts.push({ x: baseX, y: holdY, v: true }); lastY = holdY; }
        holdY = null;
        baseX = rx;
      }
      const tie = a.dataset.threadTie;
      if (kind === "around") {
        const min = +a.dataset.threadMin || 1024;
        let lv = lvOf(a);
        if (W >= min && lv === 0) { if (!detour(e)) { lvl.set(a, 1); lv = 1; } else continue; }
        if (W >= min && lv === 0) continue;
        if (tie && a.dataset.threadTieNarrow === "rail") railKnot(e, tie, rx, b.t + b.h / 2, sizeOf(a, true), Math.max(0, lv - (W >= min ? 1 : 0)));
      } else if (kind === "knot") {
        const cx = (b.l + b.r) / 2, cy = (b.t + b.b) / 2, R = Math.min(b.h / 2, 26);
        if (span && tie) {
          // K3: the crossing, refined: legs run through the gap, the knot is tied between them
          let lv = lvOf(a);
          // The gap is measured between the text itself (the boxes of the lines above and below), not from
          // the span: a line box bleeds a few px into the span, and the 24 px clearance counts from the text.
          const here = env.obst.filter((o) => o.sec === e.sec && !o.pic && o.l < cx && o.r > cx && !o.el.contains(a));
          const gapT = Math.max(span.t, ...here.filter((o) => o.b <= cy + 1).map((o) => o.b));
          const gapB = Math.min(span.b, ...here.filter((o) => o.t >= cy - 1).map((o) => o.t));
          const gap = gapB - gapT, gc = (gapT + gapB) / 2;
          let type = lv === 0 ? tie : "overhand";
          let S = lv === 0 ? Math.min(+a.dataset.threadKnotSize || 64, (26 * (gap / 2 - 24 - 16)) / 28) : 40;
          if (lv === 0 && S < 40) { lvl.set(a, 1); lv = 1; type = "overhand"; S = 40; }
          if (debug) console.info(`[thread] K3 gap ${gap.toFixed(1)} (${gapT.toFixed(1)}..${gapB.toFixed(1)}) S ${S.toFixed(1)} lvl ${lv}`);
          if (lv < 2) {
            const k = S / GLYPH[type].w, r = 16, cy = gc;
            const yIn = cy - 28 * k - r, yOut = cy + 28 * k + r, ey = cy + 28 * k;
            // The legs leave the gutter just short of the text's left edge: the bend happens outside the title
            const textL = Math.min(cx - r - 40, ...env.obst.filter((o) => o.sec === e.sec && o.b > yIn - 60 && o.t < yOut + 60 && o.l > rx).map((o) => o.l));
            const xc = Math.max(rx + 24, textL - 28);
            rail(lastY, yIn - 64);
            pts.push({ x: rx, y: yIn - 64, v: true });
            const p0 = pts.length - 1;
            pts.push({ x: xc, y: yIn, hz: true }, { x: cx - r, y: yIn, hz: true });
            const g = glyph(type, cx, cy, S);
            pts[g.p0].fx = [{ x: cx - r + QUARTER * r, y: yIn }, { x: cx, y: yIn + r - QUARTER * r }];
            pts.push({ x: cx - r, y: yOut, hz: true, fx: [{ x: cx, y: ey + QUARTER * r }, { x: cx - r + QUARTER * r, y: yOut }] });
            pts.push({ x: xc, y: yOut, hz: true }, { x: rx, y: yOut + 64, v: true });
            tieAt.push({ el: a, idx: g.p1, g });
            feats.push({ a, kind: "knot", sec: e.sec, k: gRange(g), i0: p0 * SUB, i1: (pts.length - 1) * SUB });
            lastY = yOut + 64;
          } else {
            const yT = lv === 2 ? gapT + 24 : span.t, yB = lv === 2 ? gapB - 24 : span.b;
            rail(lastY, yT);
            pts.push({ x: rx, y: yT, v: true });
            const p0 = pts.length - 1;
            through(cx, cy, R);
            tieAt.push({ el: a, idx: pts.length - 2 });
            pts.push({ x: rx, y: yB, v: true });
            if (lv === 2) feats.push({ a, kind: "knot", sec: e.sec, k: null, i0: p0 * SUB, i1: (pts.length - 1) * SUB });
            lastY = yB;
            fallback.add(a);
          }
          baseX = rx;
        } else if (span) {
          rail(lastY, span.t);
          pts.push({ x: rx, y: span.t, v: true });
          through(cx, cy, R);
          tieAt.push({ el: a, idx: pts.length - 2 });
          pts.push({ x: rx, y: span.b, v: true });
          lastY = span.b;
          baseX = rx;
        } else if (tie) {
          if (railKnot(e, tie, rx, cy, sizeOf(a, W < 768), lvOf(a))) { /* tied by the line */ } else {
            rail(lastY, cy - R);
            through(cx, cy, R);
            tieAt.push({ el: a, idx: pts.length - 2 });
            lastY = cy + R;
          }
          baseX = rx;
        } else {
          rail(lastY, cy - R);
          through(cx, cy, R);
          tieAt.push({ el: a, idx: pts.length - 2 });
          lastY = cy + R;
          if (holdB !== null) { baseX = cx; holdY = holdB; } else baseX = rx;
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
        );
        let done = false;
        if (tie) {
          const S = sizeOf(a, W < 768), k = S / GLYPH[tie].w, cx = L - 24 - GLYPH[tie].hw * k;
          const y = slide(a, tie, S, lvOf(a), M);
          if (y !== null) {
            const g = glyph(tie, cx, y, S);
            tieAt.push({ el: knotOf(a), idx: g.p1, g });
            feats.push({ a, kind: "knot", sec: e.sec, k: gRange(g), i0: g.p0 * SUB, i1: g.p1 * SUB });
            pts.push({ x: rx, y: B + 70, v: true });
            done = true;
          }
        }
        if (!done) {
          pts.push({ x: L - p * 1.15, y: M + 3 });
          tieAt.push({ el: knotOf(a), idx: pts.length - 1 });
          pts.push({ x: rx, y: B + 70, v: true });
          fallback.add(knotOf(a));
        }
        if (!wrapAt && a.matches(".ct-tie")) wrapAt = { s: s0, e: pts.length - 1, y0: T - 70, y1: B + 70, bend: amp * 0.35 };
        lastY = B + 70;
      } else if (kind === "end") {
        const ex = (b.l + b.r) / 2, ey = b.t;
        if (tie) {
          const S = sizeOf(a, W < 768), k = S / GLYPH[tie].w;
          const y = slide(a, tie, S, lvOf(a), (b.t + b.b) / 2);
          if (y !== null) {
            rail(lastY, y - 28 * k - 40);
            pts.push({ x: ex, y: y - 28 * k - 40, v: true });
            const g = glyph(tie, ex, y, S);
            tieAt.push({ el: a, idx: g.p1, g });
            feats.push({ a, kind: "knot", sec: e.sec, k: gRange(g), i0: g.p0 * SUB, i1: g.p1 * SUB });
            ended = true;
            break;
          }
          fallback.add(a);
        }
        rail(lastY, ey - 60);
        pts.push({ x: ex, y: ey - 60, v: true }, { x: ex, y: ey, v: true });
        tieAt.push({ el: a, idx: pts.length - 1 });
        ended = true;
        break;
      }
    }
    if (!ended) { rail(lastY, H); pts.push({ x: rx, y: H, v: true }); }
    return { pts, tieAt, feats, wrapAt, fallback, amp };
  }

  // Hermite curve through the points, as cubic Béziers; vertical points get a vertical tangent.
  // Points with `fx` use their own fixed controls (the knots and the turns into them).
  function sampleCurve(pts) {
    const tangent = (i) => {
      const p0 = pts[i - 1] || { x: pts[i].x, y: pts[i].y - 120 };
      const p2 = pts[i + 1] || { x: pts[i].x, y: pts[i].y + 120 };
      if (pts[i].hz) return { x: Math.sign(p2.x - p0.x || 1) * Math.max(240, Math.abs(p2.x - p0.x) / 2), y: 0 };
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
      let c1, c2;
      if (b.fx) { c1 = b.fx[0]; c2 = b.fx[1]; } else {
        // Handles never longer than half the segment, so short stretches (through a knot) never overshoot
        const cap = Math.hypot(b.x - a.x, b.y - a.y) * 0.5;
        const h = (t) => { const l = Math.hypot(t.x, t.y) / 3; const k = l > cap ? cap / l : 1; return { x: (t.x / 3) * k, y: (t.y / 3) * k }; };
        const h1 = h(tans[i]), h2 = h(tans[i + 1]);
        c1 = { x: a.x + h1.x, y: a.y + h1.y };
        c2 = { x: b.x - h2.x, y: b.y - h2.y };
      }
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
    return { dd, segStart, X, Y, Ls, acc };
  }

  // Does a stretch of the line keep its distance from the text and pictures of its section?
  function tooClose(f, S, env) {
    // (a heading that holds the anchor, like the title round K3's gap, is measured by its lines instead)
    const near = env.obst.filter((o) => o.sec === f.sec && !(f.skip && f.skip.contains(o.el)) && !o.el.contains(f.a));
    const boxes = f.extra ? near.concat(f.extra.map((q) => ({ ...q, pic: false }))) : near;
    for (let i = f.i0; i <= f.i1; i++) {
      const x = S.X[i], y = S.Y[i];
      if (x < 8 || x > env.W - 8) return "viewport edge";
      for (const o of boxes) {
        const c = (o.c || (o.pic ? 8 : 24)) - 0.5;
        const dx = Math.max(o.l - x, 0, x - o.r), dy = Math.max(o.t - y, 0, y - o.b);
        if (dx * dx + dy * dy < c * c) return `${Math.round(Math.hypot(dx, dy))}px from ${o.el ? o.el.tagName.toLowerCase() + (o.el.className ? "." + String(o.el.className).split(" ")[0] : "") : "its element"}`;
      }
    }
    return "";
  }

  // The window of scroll over which a detour is drawn: linear in arc length, at most DETOUR_RATE px of line per
  // px of scroll where the screen allows it, with the tip kept inside the band. Returns null: draw it as plain gutter.
  function placeDetour(f, S) {
    const a = f.i0, b = f.i1, L = S.Ls;
    const yL = S.Y[a], yB = S.Y[b], desc = yB - yL;
    const kn = f.k, kl = kn ? L[kn.i1] - L[kn.i0] : 0;
    const C = new Float64Array(b - a + 1);
    const extra = kn ? 0.3 * vh * DETOUR_RATE : 0;
    for (let k = a + 1; k <= b; k++) {
      const plain = L[k] - L[a];
      if (kn && k > kn.i0 && k <= kn.i1) {
        const u = (L[k] - L[kn.i0]) / (kl || 1);
        C[k - a] = L[kn.i0] - L[a] + (kl + extra) * invArrive(u);
      } else C[k - a] = kn && k > kn.i1 ? plain + extra : plain;
    }
    const tot = C[b - a];
    for (let r = DETOUR_RATE; r <= 3.001; r += 0.05) {
      const span = Math.max(desc + DETOUR_MIN * vh, tot / r);
      const lo = yL - DETOUR_LEAD * vh, hi = yB + DETOUR_LAG * vh - span;
      if (hi < lo) continue;
      const mid = Math.min(hi, Math.max(lo, (yL + yB) / 2 - span / 2));
      for (let d = 0; d <= hi - lo + 8; d += 8) {
        for (const sgn of d ? [1, -1] : [1]) {
          const Ws = mid + sgn * d;
          if (Ws < lo || Ws > hi) continue;
          let ok = true;
          for (let k = a; k <= b; k += 4) {
            const tip = READ * vh + S.Y[k] - (Ws + (span * C[k - a]) / tot);
            if (tip < TIP_LO * vh || tip > TIP_HI * vh) { ok = false; break; }
          }
          if (ok) return { Ws, span, C, tot, a, b };
        }
      }
    }
    return null;
  }

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
        sec: secOf(a),
        b: pageBox(a),
        span: span ? pageBox(span) : null,
        btn: kind === "wrap" ? pageBox(a.querySelector("button, a") || a) : null,
        holdB: "threadHold" in a.dataset ? pageBox(a.closest(a.dataset.threadHold || "li") || a).b : null,
        lis: kind === "around" && a.dataset.threadSide === "enclose" ? [...a.querySelectorAll("li")].map(pageBox) : null,
      };
    });
    // The text and pictures the line must keep away from
    const obst = [];
    if (anchors.some((a) => a.dataset.thread === "around" || a.dataset.threadTie)) {
      document.querySelectorAll(`${TEXT_SEL},${PIC_SEL}`).forEach((el) => {
        if (el.closest(".page-thread, .rail-probe, svg")) return;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        // Text that is arriving (a fade and a short rise, set with `translate`) is measured where it will rest,
        // not where the rise holds it for now: otherwise the route is checked against a box a few px too low
        let rise = 0;
        if (el.matches("[data-fade],[data-fade-after]")) {
          const tr = getComputedStyle(el).translate;
          if (tr && tr !== "none") rise = parseFloat(tr.split(" ")[1]) || 0;
        }
        obst.push({ el, sec: secOf(el), pic: el.matches(PIC_SEL), l: r.left + sx, r: r.right + sx, t: r.top + sy - rise, b: r.bottom + sy - rise });
      });
    }

    // ---- pure computation ----
    const env = { W, H, rx, obst };
    const lvl = new Map();
    let R, S;
    for (let pass = 0; pass < 90; pass++) {
      R = layout(boxes, lvl, env);
      S = sampleCurve(R.pts);
      let why = "", bad = null;
      for (const f of R.feats) {
        why = tooClose(f, S, env);
        if (!why && f.kind === "detour") { f.win = placeDetour(f, S); if (!f.win) why = "pacing does not fit this screen"; }
        if (why) { bad = f; break; }
      }
      if (!bad) break;
      if (debug) console.info("[thread]", bad.kind, bad.a.getAttribute("class") || bad.a.tagName, "lvl", lvl.get(bad.a) || 0, "->", why);
      lvl.set(bad.a, (lvl.get(bad.a) || 0) + 1);
    }
    const { pts, tieAt, wrapAt, fallback, feats } = R;
    const { dd, segStart, X, Y, Ls, acc } = S;

    // How far down the reader must be for each sample to be drawn: the highest point reached so far.
    // Where the line stops going down (the loop round the button), that stretch is spread over the
    // screen's worth of scroll just before it, so it is drawn, not dropped in.
    const N = Y.length;
    const L = Float64Array.from(Ls);
    const Rch = new Float64Array(N);
    let mx = -Infinity;
    for (let i = 0; i < N; i++) { mx = Math.max(mx, Y[i]); Rch[i] = mx; }
    const RM = Rch.slice();
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

    // Knots and detours get their own windows of scroll (see docs/thread-route.md, draw pacing)
    const fixed = new Uint8Array(N);
    const lim = H - vh * 0.4 - 4;
    const ramps = (i0, i1, ref0, w0, ref1, w1) => {
      const d0 = Math.max(0, ref0 - w0), d1 = Math.max(0, w1 - ref1);
      const P = w0 - d0, Q = ref1 + 2 * d1;
      for (let k = i0 - 1; k >= 0 && !fixed[k] && Y[k] >= P; k--) Rch[k] = Math.min(Rch[k], P + (Math.min(Y[k], ref0) - P) / 2);
      for (let k = i1 + 1; k < N && !fixed[k] && Y[k] <= Q; k++) Rch[k] = Math.max(Rch[k], w1 + (Math.max(Y[k], ref1) - ref1) / 2);
    };
    // A knot tied between two legs (K3) gets one window over leg + glyph + leg: the legs run level, so they
    // are spread over the scroll by arc length at LEG_RATE px of line per px of scroll, not by page y
    const knotWindow = (g, f) => {
      const legs = f && (f.i0 < g.i0 || f.i1 > g.i1);
      const Lin = legs ? L[g.i0] - L[f.i0] : 0, Lout = legs ? L[f.i1] - L[g.i1] : 0;
      const inS = Lin / LEG_RATE, outS = Lout / LEG_RATE;
      const ref0 = Math.max(Y[g.i0], g.i0 > 0 ? RM[g.i0 - 1] : 0), ref1 = RM[g.i1];
      let w0 = ref0 - KNOT_PRE * vh, w1 = ref1 + KNOT_POST * vh;
      const over = w1 + outS - lim;
      if (over > 0) { w0 -= over; w1 -= over; }
      const span = L[g.i1] - L[g.i0] || 1;
      for (let k = g.i0; k <= g.i1; k++) { Rch[k] = w0 + invArrive((L[k] - L[g.i0]) / span) * (w1 - w0); fixed[k] = 1; }
      if (!legs) { ramps(g.i0, g.i1, ref0, w0, ref1, w1); return; }
      for (let k = f.i0; k < g.i0; k++) { Rch[k] = w0 - inS + (inS * (L[k] - L[f.i0])) / (Lin || 1); fixed[k] = 1; }
      for (let k = g.i1 + 1; k <= f.i1; k++) { Rch[k] = w1 + (outS * (L[k] - L[g.i1])) / (Lout || 1); fixed[k] = 1; }
      ramps(f.i0, f.i1, Math.max(Y[f.i0], f.i0 > 0 ? RM[f.i0 - 1] : 0), w0 - inS, RM[f.i1], w1 + outS);
    };
    for (const f of feats) {
      if (f.kind === "detour" && f.win) {
        const { Ws, span, C, tot, a, b } = f.win;
        for (let k = a; k <= b; k++) { Rch[k] = Ws + (span * C[k - a]) / tot; fixed[k] = 1; }
        ramps(a, b, Y[a], Ws, Y[b], Ws + span);
      } else if (f.kind === "knot" && f.k) knotWindow(f.k, f);
    }
    for (let k = N - 2; k >= 0; k--) if (!fixed[k] && Rch[k] > Rch[k + 1]) Rch[k] = Rch[k + 1];
    for (let k = 1; k < N; k++) if (Rch[k] < Rch[k - 1]) Rch[k] = Rch[k - 1];

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
    ties = tieAt.filter((t) => t.el).map((t) => ({
      el: t.el, len: segStart[t.idx], tied: prevTied.get(t.el) || false,
      i: t.g ? Math.round((t.g.p0 + t.g.p1) / 2) * SUB : t.idx * SUB,
      g: t.g ? { i0: t.g.p0 * SUB, i1: t.g.p1 * SUB } : null,
    }));
    knotR = ties.filter((t) => t.g).map((t) => t.g);

    // ---- writes ----
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = `${W}px`;
    svg.style.height = `${H}px`;
    path.setAttribute("d", d);
    path.setAttribute("pathLength", total.toFixed(2));
    // A knot the line could not tie keeps its own small icon
    anchors.forEach((a) => { const k = knotOf(a); if (k) k.classList.toggle("thread-bead", fallback.has(k) || fallback.has(a)); });
    endSway();
    endCinch();
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
    if (cinch.on && !(loopR && loopK > 0 && cinch.i1 >= loopR.i0 && cinch.i0 <= loopR.i1)) gaps.push([lens[cinch.i0], lens[cinch.i1]]);
    if (gaps.length) {
      gaps.sort((p, q) => p[0] - q[0]);
      const arr = [];
      let pos = 0;
      for (const [g0, g1] of gaps) {
        if (g0 < pos) continue; // an overlay already covers it
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
      if (!tied) {
        // The reader scrolled back above the knot: it is no longer being tied, so its cinch ends
        if (cinch.on && t.g && t.g.i0 === cinch.i0) { endCinch(); wake(); }
        continue;
      }
      if (t.el.id) (followersOf.get(t.el.id) || []).forEach((el) => el.classList.remove("is-waiting"));
      // One small tug, the first time only
      if (!still && !tugged.has(t.el)) {
        tugged.add(t.el);
        if (t.g) startCinch(t);
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

    if (cinch.on) {
      cinch.t += (dt * 1000) / CINCH_MS;
      if (cinch.t >= 1) endCinch();
      else { drawCinch(); busy = true; }
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
      // Knots are rigid: the sway stops at a knot's edge (its weight falls to zero there) and never starts on one
      let ra = SWAY_R, rb = SWAY_R;
      for (const g of knotR) {
        if (i >= g.i0 && i <= g.i1) return;
        if (g.i1 < i && g.i1 >= i0) { i0 = g.i1; ra = lens[i] - lens[i0]; }
        else if (g.i0 > i && g.i0 <= i1) { i1 = g.i0; rb = lens[i1] - lens[i]; }
      }
      if (ra < 40 || rb < 40) return;
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
        const u = (lens[j] - lens[i]) / (j < i ? ra : rb); // -1..1
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

  /* ---------- the cinch: a knot the line has drawn is pulled tight once, when it is tied ---------- */
  // The keyframes of thread-tie, inverted (the knot is pulled in, overshoots a hair, rests), eased as CSS would
  const KF = [[0, 1], [0.35, 0.9], [0.65, 1.03], [1, 1]];
  const bez = (x) => {
    const cx = 3 * 0.34, bx = 3 * (0.64 - 0.34) - cx, ax = 1 - cx - bx;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = ((ax * t + bx) * t + cx) * t - x, de = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-5 || !de) break;
      t -= e / de;
    }
    t = Math.min(1, Math.max(0, t));
    const cy = 3 * 1.3, by = 3 * (1 - 1.3) - cy, ay = 1 - cy - by;
    return ((ay * t + by) * t + cy) * t;
  };
  const cinchScale = (p) => {
    for (let i = 1; i < KF.length; i++) {
      if (p <= KF[i][0]) { const u = (p - KF[i - 1][0]) / (KF[i][0] - KF[i - 1][0]); return KF[i - 1][1] + (KF[i][1] - KF[i - 1][1]) * bez(u); }
    }
    return 1;
  };
  function startCinch(t) {
    const { i0, i1 } = t.g;
    const cy = ys[t.i];
    if (cy < sy || cy > sy + vh) return; // tied out of sight (a jump): no motion off-screen
    let cx = 0, cyy = 0;
    for (let j = i0; j <= i1; j++) { cx += xs[j]; cyy += ys[j]; }
    cx /= i1 - i0 + 1; cyy /= i1 - i0 + 1;
    const span = lens[i1] - lens[i0] || 1;
    const w = new Float64Array(i1 - i0 + 1);
    for (let j = i0; j <= i1; j++) {
      const u = (lens[j] - lens[i0]) / span, e = Math.min(u, 1 - u) / 0.25;
      w[j - i0] = e >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * e); // the legs stay pinned
    }
    Object.assign(cinch, { on: true, t: 0, i0, i1, cx, cy: cyy, w });
    dirty = true;
    wake();
  }
  function drawCinch() {
    const { i0, i1, cx, cy, w } = cinch;
    const s = cinchScale(cinch.t);
    let p = "";
    for (let j = i0; j <= i1; j++) {
      const k = 1 + (s - 1) * w[j - i0];
      p += `${j === i0 ? "M" : "L"}${(cx + (xs[j] - cx) * k).toFixed(1)} ${(cy + (ys[j] - cy) * k).toFixed(1)}`;
    }
    cinchPath.setAttribute("d", p);
  }
  function endCinch() {
    if (!cinch.on) return;
    cinch.on = false;
    cinchPath.removeAttribute("d");
    dirty = true;
  }

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
    endCinch();
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
  // A language swap can move boxes without changing the body's height, which the observer would miss
  document.addEventListener("fildevie:locale-changed", scheduleBuild);
  addEventListener("load", scheduleBuild);
  // Runs after layout and before paint, so the line never lags a reflow by a frame
  new ResizeObserver(() => build()).observe(document.body);
  if (document.fonts) document.fonts.ready.then(scheduleBuild).catch(() => {});
  build();
  if (!still) wake(); // the thread unspools from the top edge as the page opens

  // Other scripts can ask for a rebuild after changing the page (the shop renders late)
  window.FDV = Object.assign(window.FDV || {}, { rebuildThread: scheduleBuild });
})();
