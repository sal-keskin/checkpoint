/* CHECKPOINT LAB — interface: controls, headline panels, paired replay, queue chart, exports. */
(function () {
  'use strict';
  const M = self.CheckpointLab, B = self.Benchmarks, X = M.CORRIDOR;
  const $ = id => document.getElementById(id);

  const state = { p: M.defaultParams(), res: null, frame: 0, playing: false, lastTs: 0, raf: 0 };

  // ---------- formatting ----------
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const fmt = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (n, d) => (n < 0 ? '−' : '') + fmt(Math.abs(n), d);
  const tl = n => '₺' + fmtInt(n);
  const usd = n => 'US$' + fmt(n, n < 100 ? 2 : 0);
  const mmss = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- controls ----------
  const PRIMARY = [
    { key: 'arrivalRate', label: 'Traffic', min: 300, max: 2400, step: 100, unit: 'veh/h' },
    { key: 'selectedFraction', label: 'Inspected share', min: 0, max: 50, step: 1, unit: '%', scale: 100 },
    { key: 'bays', label: 'Inspection bays', min: 1, max: 6, step: 1, unit: '' },
    { key: 'serviceMean', label: 'Inspection time, mean', min: 20, max: 240, step: 10, unit: 's' },
    { key: 'durationMin', label: 'Checkpoint duration', min: 5, max: 120, step: 5, unit: 'min' },
    { key: 'overflow', label: 'When bays and pocket are full', type: 'select', options: [['block', 'Hold the through lane'], ['skip', 'Release unserved']] },
  ];
  const MORE = [
    { key: 'screeningSpeed', label: 'Screening speed', min: 10, max: 60, step: 5, unit: 'km/h' },
    { key: 'screeningHeadway', label: 'Screening headway', min: 2, max: 10, step: 0.5, unit: 's/veh' },
    { key: 'pocket', label: 'Waiting pocket', min: 0, max: 6, step: 1, unit: 'slots' },
    { key: 'heavyShare', label: 'Heavy vehicles', min: 0, max: 30, step: 1, unit: '%', scale: 100 },
    { key: 'seed', label: 'Random seed', min: 1, max: 30, step: 1, unit: '' },
    { key: 'vot', label: 'Value of time', min: 50, max: 600, step: 10, unit: '₺/person-h', price: true },
    { key: 'petrol', label: 'Petrol price', type: 'number', step: 0.1, unit: '₺/L', price: true },
    { key: 'diesel', label: 'Diesel price', type: 'number', step: 0.1, unit: '₺/L', price: true },
    { key: 'lpg', label: 'LPG price', type: 'number', step: 0.1, unit: '₺/L', price: true },
    { key: 'electricity', label: 'Electricity price', type: 'number', step: 0.1, unit: '₺/kWh', price: true },
    { key: 'fx', label: 'Exchange rate', type: 'number', step: 0.001, unit: '₺ per US$', price: true },
  ];
  function getVal(c) { const v = c.price ? state.p.prices[c.key] : state.p[c.key]; return c.scale ? v * c.scale : v; }
  function setVal(c, v) {
    if (c.type === 'select') { state.p[c.key] = v; return; }
    v = Number(v); if (!isFinite(v)) return;
    if (c.scale) v = v / c.scale;
    if (c.price) state.p.prices[c.key] = v; else state.p[c.key] = v;
  }
  function buildControls(list, host) {
    host.innerHTML = '';
    for (const c of list) {
      const wrap = document.createElement('div'); wrap.className = 'ctl';
      const id = 'ctl-' + c.key;
      const lab = document.createElement('label'); lab.htmlFor = id;
      lab.innerHTML = `<span>${c.label}</span><span class="val" id="${id}-val"></span>`;
      wrap.appendChild(lab);
      let input;
      if (c.type === 'select') {
        input = document.createElement('select'); input.id = id;
        for (const [v, t] of c.options) { const o = document.createElement('option'); o.value = v; o.textContent = t; input.appendChild(o); }
        input.value = state.p[c.key];
      } else {
        input = document.createElement('input'); input.id = id;
        input.type = c.type === 'number' ? 'number' : 'range';
        if (c.min !== undefined) { input.min = c.min; input.max = c.max; }
        input.step = c.step; input.value = getVal(c);
      }
      input.addEventListener('input', () => { if (c.type !== 'select') showVal(c, input.value); });
      input.addEventListener('change', () => { setVal(c, input.value); showVal(c, getVal(c)); run(); });
      wrap.appendChild(input);
      host.appendChild(wrap);
      showVal(c, getVal(c));
    }
  }
  function showVal(c, v) {
    const el = $('ctl-' + c.key + '-val'); if (!el) return;
    if (c.type === 'select') { el.textContent = ''; return; }
    const n = Number(v);
    el.textContent = (c.type === 'number' ? fmt(n, c.step < 0.01 ? 3 : 2) : fmt(n, Number.isInteger(c.step) ? 0 : 1)) + (c.unit ? ' ' + c.unit : '');
  }
  function syncControls() {
    for (const c of PRIMARY.concat(MORE)) { const el = $('ctl-' + c.key); if (!el) continue; el.value = c.type === 'select' ? state.p[c.key] : getVal(c); showVal(c, getVal(c)); }
  }

  // ---------- run ----------
  function run() {
    $('computing').hidden = false;
    $('status').textContent = 'Computing baseline and checkpoint runs…';
    stopPlay();
    setTimeout(() => {
      const t0 = performance.now();
      try {
        state.res = M.runPaired(state.p);
      } catch (e) {
        $('status').textContent = 'The run failed: ' + e.message; $('computing').hidden = true; return;
      }
      const ms = Math.round(performance.now() - t0);
      const r = state.res;
      $('status').textContent = `${fmtInt(r.acc.tot.n)} vehicles paired · ${r.cp.incomplete ? 'queue did NOT clear in the horizon' : 'queue cleared at ' + mmss(r.cp.queueClearedAt)} · ${ms} ms`;
      state.frame = 0;
      renderAll();
      $('computing').hidden = true;
    }, 30);
  }

  function renderAll() {
    renderCost(); renderPollution(); renderStrip(); renderChecks(); renderAssumptions();
    const n = state.res.cp.frames.length;
    $('scrub').max = Math.max(0, n - 1); $('scrub').value = state.frame;
    drawReplay(); drawQueueChart();
    $('csvOut').value = '';
  }

  // ---------- cost panel ----------
  function renderCost() {
    const a = state.res.acc, pr = state.p.prices;
    $('costBig').innerHTML = `${tl(a.combinedTRY)}<small>≈ ${usd(a.usd(a.combinedTRY))}</small>`;
    const items = [
      ['Petrol', a.energyTRY.petrol, `${sgn(a.tot.dL.petrol, 1)} L`],
      ['Diesel', a.energyTRY.diesel, `${sgn(a.tot.dL.diesel, 1)} L`],
      ['LPG', a.energyTRY.lpg, `${sgn(a.tot.dL.lpg, 1)} L`],
      ['Electricity', a.energyTRY.electricity, `${sgn(a.tot.dKwh, 1)} kWh`],
      ['Time value', a.timeTRY, `${fmt(a.personHours, 1)} person-h`, true],
    ];
    const max = Math.max(1, ...items.map(i => Math.abs(i[1])));
    $('costBars').innerHTML = items.map(i =>
      `<div class="bar${i[3] ? ' time' : ''}"><span class="name">${i[0]}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.abs(i[1]) / max * 44)}%"></div><span class="lbl">${i[1] < 0 ? '−' : ''}${tl(Math.abs(i[1]))} · ${usd(a.usd(Math.abs(i[1])))} <span style="color:var(--muted)">${i[2]}</span></span></div></div>`
    ).join('');
    $('costLine').innerHTML = `Energy <b>${tl(a.energyTotalTRY)}</b> at dated retail prices (an expenditure) · time <b>${tl(a.timeTRY)}</b> at ₺${fmtInt(pr.vot)} per person-hour (a valuation, not an invoice) · <b>₺${fmt(a.perVehicleTRY, 2)}</b> per affected vehicle.`;
    $('votLine').innerHTML = 'If time were worth ' + a.votSensitivity.map(s => `₺${s.vot}/h: <b>${tl(s.totalTRY)}</b>`).join(' · ') + '. Excludes wear, pollution damage, crashes and enforcement costs or benefits.';
  }

  // ---------- pollution panel ----------
  function renderPollution() {
    const a = state.res.acc, t = a.tot, inc = a.increase, cx = a.context;
    const up = v => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 0) + '% vs the same vehicles on a free road';
    const tiles = [
      { n: sgn(t.dCO2 / 1000, 1), u: 'kg CO₂', l: 'Extra carbon dioxide', d: up(inc.co2), main: true },
      { n: sgn(t.dNOx, 0), u: 'g NOₓ', l: 'Nitrogen oxides', d: `${inc.nox >= 0 ? '+' : '−'}${fmt(Math.abs(inc.nox), 0)}%` },
      { n: sgn(t.dPM, 1), u: 'g exhaust PM', l: 'Particulate matter', d: `${inc.pm >= 0 ? '+' : '−'}${fmt(Math.abs(inc.pm), 0)}%` },
      { n: sgn(t.dL.petrol + t.dL.diesel + t.dL.lpg, 1), u: `L fuel · ${sgn(t.dKwh, 1)} kWh`, l: 'Extra fuel and electricity', d: `${inc.fuel >= 0 ? '+' : '−'}${fmt(Math.abs(inc.fuel), 0)}% fuel` },
      { n: fmt(a.exposurePersonHours, 1), u: 'person-hours', l: 'Extra time in slow traffic at the checkpoint', d: 'exposure proxy' },
    ];
    $('polTiles').innerHTML = tiles.map(x => `<div class="tile${x.main ? ' main' : ''}"><div class="n${x.main ? ' main' : ''}">${x.n}</div><div class="u">${x.u}</div><div class="l">${x.l}</div><div class="d">${x.d}</div></div>`).join('');
    const lines = [
      ['CO₂', `one average petrol car driving <b>${fmtInt(cx.carKm)} km</b> · <b>${fmt(cx.householdDays, 0)} days</b> of a household's electricity · what <b>${fmt(cx.treeYears, 1)} trees</b> take up in a year`],
      ['NOₓ', `a Euro 6 diesel car driving <b>${fmtInt(cx.euro6DieselKm)} km</b> at its 80 mg/km limit · an older diesel driving <b>${fmtInt(cx.olderDieselKm)} km</b> at 0.5 g/km`],
      ['PM', `a car driving <b>${fmtInt(cx.euroPmKm)} km</b> at the 4.5 mg/km Euro 5/6 limit, exhaust only`],
      ['Time', `travel time <b>+${fmt(inc.travel, 0)}%</b>, emissions about <b>+${fmt(inc.co2, 0)}%</b>: idling and creeping burn less per second than cruising, so pollution grows more slowly than delay`],
    ];
    $('context').innerHTML = lines.map(l => `<li><b>${l[0]}</b><span>${l[1]}</span></li>`).join('');
  }

  // ---------- results strip ----------
  function renderStrip() {
    const r = state.res, a = r.acc, s = r.cp.stats;
    const complete = !r.cp.incomplete && s.remaining === 0;
    const items = [
      [fmt(a.vehicleHours, 1), 'extra vehicle-hours'],
      [fmt(a.personHours, 1), 'extra person-hours'],
      [`${fmt(a.meanDelayS, 0)} s`, `mean extra delay · 95th pct ${fmt(a.p95DelayS, 0)} s`],
      [`${s.maxQueue}`, `vehicles queued at peak · tail ${fmtInt(s.maxTailM)} m`],
      [r.cp.queueClearedAt !== null ? mmss(r.cp.queueClearedAt) : '—', `queue clears · restriction ends ${mmss(r.cp.D)}`],
      [`${s.serviced} / ${s.selected}`, `inspections completed / selected · ${s.unserved} unserved · ${s.overflow} overflow`],
      [`${sgn(a.tot.dBrakeKJ / 1000, 1)} MJ`, 'friction braking, wear mass unestimated'],
      [`<span class="flag ${complete ? 'ok' : 'bad'}">${complete ? 'COMPLETE' : 'INCOMPLETE'}</span>`, `${fmtInt(a.tot.n)} vehicles paired by id · ${s.blockedEntries} delayed entries${complete ? '' : ' · queue did not clear within 90 min'}`],
    ];
    $('strip').innerHTML = items.map(i => `<div class="st"><div class="n">${i[0]}</div><div class="l">${i[1]}</div></div>`).join('');
  }

  // ---------- checks & assumptions ----------
  function renderChecks() {
    const r = state.res, s = r.cp.stats;
    const qa = B.pointQueue(1200, 900, 30, 1800), kb = B.kinematicSlowdown();
    const e1 = B.integrateRate(12.5, 1.0, 600), e2 = B.integrateRate(12.5, 0.2, 600);
    const items = [
      [Math.abs(qa.qMax - 150) < 1e-9 && Math.abs(qa.vehicleHours - 56.25) < 1e-9, `Queue benchmark: point-queue module gives ${qa.qMax} vehicles and ${qa.vehicleHours} vehicle-hours`],
      [Math.abs(kb.baselineS - 80) < 0.005 && Math.abs(kb.slowdownS - 102.82) < 0.005, `Kinematic benchmark: ${kb.baselineS.toFixed(2)} s baseline, ${kb.slowdownS.toFixed(2)} s slowdown`],
      [Math.abs(e1 - e2) < 1e-6, `Emission units: a constant rate integrates to ${e1.toFixed(0)} mg at both 1.0 s and 0.2 s steps`],
      [s.intended === s.entered && s.entered === s.completed && s.remaining === 0, `Vehicle conservation: ${s.intended} intended, ${s.entered} entered, ${s.completed} completed, ${s.remaining} remaining`],
      [r.cp.order.length === r.base.order.length, `Paired matching: ${r.cp.order.length} manifest ids present in both runs`],
      [s.selected === s.serviced + s.unserved, `Inspection accounting: ${s.selected} selected = ${s.serviced} completed + ${s.unserved} unserved`],
    ];
    $('checks').innerHTML = items.map(i => `<li class="${i[0] ? '' : 'bad'}">${i[1]}</li>`).join('');
  }
  function renderAssumptions() {
    const csv = M.assumptionsCsv(state.p);
    const rows = csv.split('\n').slice(1).map(l => l.match(/"((?:[^"]|"")*)"/g).map(x => x.slice(1, -1).replace(/""/g, '"')));
    $('assumeTable').querySelector('tbody').innerHTML = rows.map(r =>
      `<tr><td class="mono">${r[0]}</td><td class="mono">${r[1]}</td><td>${r[2]}</td><td><span class="badge ${r[3].toLowerCase()}">${r[3]}</span></td><td>${r[4]}</td></tr>`).join('');
  }

  // ---------- replay ----------
  const road = $('road');
  function stopPlay() { state.playing = false; $('play').textContent = 'Play'; if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; }
  function togglePlay() {
    if (!state.res) return;
    if (state.playing) { stopPlay(); return; }
    if (state.frame >= state.res.cp.frames.length - 1) state.frame = 0;
    state.playing = true; $('play').textContent = 'Pause'; state.lastTs = 0;
    state.raf = requestAnimationFrame(tick);
  }
  function tick(ts) {
    if (!state.playing) return;
    if (state.lastTs) {
      const speed = Number($('speed').value);
      state.frame += (ts - state.lastTs) / 1000 * speed / 0.5;
      const last = state.res.cp.frames.length - 1;
      if (state.frame >= last) { state.frame = last; stopPlay(); }
      $('scrub').value = Math.floor(state.frame);
      drawReplay();
    }
    state.lastTs = ts;
    if (state.playing) state.raf = requestAnimationFrame(tick);
  }

  function drawReplay() {
    if (!state.res) return;
    const dpr = window.devicePixelRatio || 1;
    const W = road.clientWidth, H = road.clientHeight;
    if (road.width !== Math.round(W * dpr) || road.height !== Math.round(H * dpr)) { road.width = Math.round(W * dpr); road.height = Math.round(H * dpr); }
    const g = road.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const paper = css('--road-ink'), roadC = css('--road'), dash = css('--road-dash');
    g.fillStyle = roadC; g.fillRect(0, 0, W, H);

    const fi = Math.min(Math.floor(state.frame), state.res.cp.frames.length - 1);
    const fc = state.res.cp.frames[fi];
    const fb = state.res.base.frames[Math.min(fi, state.res.base.frames.length - 1)];
    const t = fc.t;
    $('clock').innerHTML = `t = <b>${mmss(t)}</b> · restriction <b>${fc.cpOn ? 'ON' : 'OFF'}</b> · queue <b>${fc.q}</b>${fc.tail !== null ? ` · tail ${fmtInt(X.gate - fc.tail)} m upstream` : ''}`;

    const winLen = Math.min(620, Math.max(300, W / 1.6));
    const x0 = X.gate - winLen * 0.66, s = W / winLen;
    const px = x => (x - x0) * s;
    const man = state.res.manifest.vehicles;
    const stripH = (H - 34) / 2;
    g.font = '11px ' + css('--mono');

    function strip(frame, y0, isCp, title, sub) {
      const roadTop = y0 + 42, roadH = Math.min(50, stripH - 70), mid = roadTop + roadH / 2;
      // plane
      g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, roadTop - 1, W, roadH + 2);
      g.fillStyle = roadC; g.fillRect(0, roadTop, W, roadH);
      g.strokeStyle = dash; g.lineWidth = 1; g.setLineDash([12, 10]);
      g.beginPath(); g.moveTo(0, roadTop + 0.5); g.lineTo(W, roadTop + 0.5); g.moveTo(0, roadTop + roadH - 0.5); g.lineTo(W, roadTop + roadH - 0.5); g.stroke();
      g.setLineDash([]);
      // titles
      g.fillStyle = paper; g.font = '600 12px ' + css('--font'); g.fillText(title, 10, y0 + 15);
      g.font = '11px ' + css('--mono'); g.fillStyle = 'rgba(242,239,232,0.6)'; g.fillText(sub, 10 + g.measureText(title).width * 1.15 + 14, y0 + 15);
      if (!isCp) { g.fillStyle = 'rgba(242,239,232,0.5)'; g.fillText('→ travel direction', W - 118, y0 + 15); }

      if (isCp) {
        // screening zone and cones
        const zx = px(X.zoneStart), zw = px(X.zoneEnd) - zx;
        g.fillStyle = frame.cpOn ? 'rgba(216,86,34,0.22)' : 'rgba(216,86,34,0.08)'; g.fillRect(zx, roadTop, zw, roadH);
        g.fillStyle = frame.cpOn ? css('--orange') : 'rgba(216,86,34,0.4)';
        for (let x = X.zoneStart; x <= X.zoneEnd; x += 12) { const cx = px(x); g.beginPath(); g.moveTo(cx, roadTop + 3); g.lineTo(cx - 3, roadTop + 9); g.lineTo(cx + 3, roadTop + 9); g.closePath(); g.fill(); }
        // gate
        g.strokeStyle = css('--yellow'); g.lineWidth = 2; g.beginPath(); g.moveTo(px(X.gate) + 0.5, roadTop - 6); g.lineTo(px(X.gate) + 0.5, roadTop + roadH + 6); g.stroke();
        g.fillStyle = css('--yellow'); g.font = '10px ' + css('--mono'); g.fillText('screening', px(X.gate) - 26, roadTop + roadH + 18);
        // bays block above the road
        const bx = px(X.bayEntry), bw = px(X.rejoin) - bx, by = y0 + 21, bh = roadTop - by - 5;
        g.fillStyle = css('--green'); g.fillRect(bx, by, bw, bh);
        const nb = state.p.bays, slotW = (bw - 6) / nb;
        for (let i = 0; i < nb; i++) {
          const sx = bx + 3 + i * slotW, b = frame.bays[i];
          g.fillStyle = 'rgba(242,239,232,0.85)'; g.fillRect(sx + 2, by + 3, slotW - 4, bh - 6);
          if (b) {
            const L = M.CLASSES[b.cls].len * s;
            g.fillStyle = b.state === 'rejoin' ? css('--yellow') : css('--grey');
            g.fillRect(sx + 4, by + bh / 2 - 3, Math.min(L, slotW - 8), 6);
            g.fillStyle = '#252525'; g.font = '9px ' + css('--mono');
            g.fillText(b.state === 'rejoin' ? 'merge' : b.state === 'service' ? Math.ceil(b.remaining) + 's' : 'rsv', sx + 4, by + bh - 6);
          }
        }
        g.fillStyle = paper; g.font = '600 9px ' + css('--font'); g.fillText('BAYS', bx + bw + 6, by + 9);
        // pocket
        if (state.p.pocket > 0) {
          const pw = Math.min(60, bx - px(X.zoneEnd) - 8);
          g.fillStyle = 'rgba(143,144,139,0.45)'; g.fillRect(bx - pw - 4, by + bh - 10, pw, 8);
          g.fillStyle = paper; g.font = '9px ' + css('--mono'); g.fillText(`pocket ${frame.pocket.length}/${state.p.pocket}`, bx - pw - 4, by + bh - 13);
        }
      }
      // vehicles
      const vh = roadH * 0.42;
      for (let i = 0; i < frame.ids.length; i++) {
        const id = frame.ids[i], m = man[id];
        const len = M.CLASSES[m.cls].len, xe = px(frame.xs[i]), lw = Math.max(2, len * s);
        if (xe < -lw || xe - lw > W) continue;
        g.fillStyle = css('--grey');
        g.fillRect(xe - lw, mid - vh / 2, lw, vh);
        const st = frame.st[i];
        if (st === 1 || st === 2) {
          g.strokeStyle = st === 2 ? css('--orange') : css('--yellow'); g.lineWidth = 2;
          g.strokeRect(xe - lw - 1, mid - vh / 2 - 1, lw + 2, vh + 2);
          g.fillStyle = css('--yellow'); g.font = '9px ' + css('--mono'); g.fillText('#' + id, xe - lw, mid + vh / 2 + 11);
        }
      }
      // queue tail
      if (frame.tail !== null) {
        const tx = px(frame.tail);
        g.fillStyle = css('--yellow'); g.font = '10px ' + css('--mono');
        if (tx > 4) {
          g.fillRect(tx - 1, roadTop - 8, 2, roadH + 16);
          g.fillText(`queue tail · ${fmtInt(X.gate - frame.tail)} m · ${mmss(frame.t)}`, Math.max(4, tx - 70), roadTop + roadH + 18);
        } else {
          g.fillText(`◄ queue tail ${fmtInt(X.gate - frame.tail)} m upstream · ${frame.q} vehicles · ${mmss(frame.t)}`, 10, roadTop + roadH + 18);
        }
      }
      return roadTop + roadH;
    }

    strip(fb, 6, false, 'BASELINE', 'same vehicles, no checkpoint');
    const bottom = strip(fc, 6 + stripH + 10, true, 'CHECKPOINT', fc.cpOn ? 'restriction active' : 'restriction ended, queue clearing');
    // corridor minimap
    const my = H - 12, ms = W / X.length;
    g.fillStyle = 'rgba(242,239,232,0.18)'; g.fillRect(0, my, W, 4);
    if (fc.tail !== null) { g.fillStyle = css('--orange'); g.fillRect(fc.tail * ms, my, (X.gate - fc.tail) * ms, 4); }
    g.fillStyle = css('--yellow'); g.fillRect(X.gate * ms - 1, my - 2, 2, 8);
    g.strokeStyle = 'rgba(242,239,232,0.6)'; g.lineWidth = 1; g.strokeRect(x0 * ms + 0.5, my - 3.5, winLen * ms, 11);
    g.fillStyle = 'rgba(242,239,232,0.6)'; g.font = '9px ' + css('--mono');
    g.fillText('0 m', 2, my - 5); g.fillText('corridor 4,500 m · window shown', W - 170, my - 5);
    void bottom;
  }

  // ---------- queue chart ----------
  const qc = $('queueChart'), tip = $('tip');
  let chartGeom = null;
  function drawQueueChart() {
    if (!state.res) return;
    const dpr = window.devicePixelRatio || 1;
    const W = qc.clientWidth, H = qc.clientHeight;
    qc.width = Math.round(W * dpr); qc.height = Math.round(H * dpr);
    const g = qc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const ser = state.res.cp.series, D = state.res.cp.D;
    const tMax = Math.max(ser[ser.length - 1].t, D * 1.2), qMax = Math.max(10, ...ser.map(s => s.q));
    const yTop = Math.ceil(qMax * 1.15 / 10) * 10;
    const L = 44, R = 16, T = 14, Bm = 30;
    const xs = t => L + (t / tMax) * (W - L - R), ys = q => T + (1 - q / yTop) * (H - T - Bm);
    chartGeom = { xs, ys, tMax, L, R, W };
    const muted = css('--muted'), line = css('--line'), fg = css('--fg');
    g.font = '11px ' + css('--mono'); g.fillStyle = muted; g.strokeStyle = line; g.lineWidth = 1;
    const yStep = yTop <= 50 ? 10 : yTop <= 120 ? 20 : yTop <= 300 ? 50 : 100;
    for (let q = 0; q <= yTop; q += yStep) { const y = Math.round(ys(q)) + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.textAlign = 'right'; g.fillText(String(q), L - 6, y + 4); }
    const xStep = tMax / 60 > 90 ? 30 : tMax / 60 > 40 ? 10 : 5;
    g.textAlign = 'center';
    for (let m = 0; m <= tMax / 60; m += xStep) { const x = Math.round(xs(m * 60)) + 0.5; g.fillText(String(m), x, H - Bm + 16); }
    g.fillText('minutes since the restriction starts', (L + W - R) / 2, H - 4);
    g.save(); g.translate(12, (T + H - Bm) / 2); g.rotate(-Math.PI / 2); g.fillText('vehicles in queue', 0, 0); g.restore();
    // restriction end
    g.setLineDash([4, 4]); g.strokeStyle = muted; g.beginPath(); g.moveTo(Math.round(xs(D)) + 0.5, T); g.lineTo(Math.round(xs(D)) + 0.5, H - Bm); g.stroke(); g.setLineDash([]);
    g.textAlign = 'left'; g.fillStyle = fg; g.fillText('restriction ends', xs(D) + 6, T + 10);
    // area + line
    const orange = css('--orange');
    g.beginPath(); g.moveTo(xs(ser[0].t), ys(0));
    for (const s of ser) g.lineTo(xs(s.t), ys(s.q));
    g.lineTo(xs(ser[ser.length - 1].t), ys(0)); g.closePath();
    g.fillStyle = 'rgba(216,86,34,0.22)'; g.fill();
    g.beginPath(); for (let i = 0; i < ser.length; i++) { const s = ser[i]; if (i) g.lineTo(xs(s.t), ys(s.q)); else g.moveTo(xs(s.t), ys(s.q)); }
    g.strokeStyle = orange; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    // peak label
    let pk = ser[0]; for (const s of ser) if (s.q > pk.q) pk = s;
    g.fillStyle = orange; g.beginPath(); g.arc(xs(pk.t), ys(pk.q), 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = fg; g.textAlign = xs(pk.t) > W * 0.45 ? 'right' : 'left';
    g.fillText(`peak ${pk.q} vehicles at ${mmss(pk.t)}`, xs(pk.t) + (xs(pk.t) > W * 0.45 ? -8 : 8), ys(pk.q) - 6);
    if (state.res.cp.queueClearedAt !== null) { g.textAlign = 'right'; g.fillStyle = muted; g.fillText(`queue clears at ${mmss(state.res.cp.queueClearedAt)}`, W - R, ys(0) - 8); }
  }
  qc.addEventListener('pointermove', e => {
    if (!chartGeom || !state.res) return;
    const rect = qc.getBoundingClientRect(), x = e.clientX - rect.left;
    const t = (x - chartGeom.L) / (chartGeom.W - chartGeom.L - chartGeom.R) * chartGeom.tMax;
    const ser = state.res.cp.series;
    let best = ser[0]; for (const s of ser) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
    tip.hidden = false; tip.textContent = `${mmss(best.t)} · ${best.q} vehicles${best.tail !== null ? ' · tail ' + fmtInt(X.gate - best.tail) + ' m' : ''}`;
    tip.style.left = (chartGeom.xs(best.t) + qc.offsetLeft) + 'px'; tip.style.top = (chartGeom.ys(best.q) + qc.offsetTop) + 'px';
  });
  qc.addEventListener('pointerleave', () => { tip.hidden = true; });

  // ---------- exports ----------
  function copyText(txt) {
    const done = ok => { $('status').textContent = ok ? 'Copied to clipboard.' : 'Clipboard refused; the text is selected, press Ctrl/Cmd+C.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => done(true), () => { $('csvOut').select(); done(false); });
    else { $('csvOut').select(); done(false); }
  }
  $('csvPaired').addEventListener('click', () => { if (state.res) $('csvOut').value = M.pairedCsv(state.res.acc); });
  $('csvAssume').addEventListener('click', () => { $('csvOut').value = M.assumptionsCsv(state.p); });
  $('copyCsv').addEventListener('click', () => { if (!$('csvOut').value) $('csvOut').value = M.pairedCsv(state.res.acc); copyText($('csvOut').value); });

  // ---------- wiring ----------
  $('play').addEventListener('click', togglePlay);
  $('scrub').addEventListener('input', () => { stopPlay(); state.frame = Number($('scrub').value); drawReplay(); });
  $('reset').addEventListener('click', () => { state.p = M.defaultParams(); syncControls(); run(); });
  window.addEventListener('resize', () => { drawReplay(); drawQueueChart(); });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', () => { drawReplay(); drawQueueChart(); });
  new MutationObserver(() => { drawReplay(); drawQueueChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  buildControls(PRIMARY, $('controls'));
  buildControls(MORE, $('controls-more'));
  run();
})();
