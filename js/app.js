/* CHECKPOINT LAB — interface: scenario sentence with option chips, presets, headline panels,
   elevated paired replay, queue chart, exports. Model runs in a worker when the browser allows it. */
(function () {
  'use strict';
  const M = self.CheckpointLab, B = self.Benchmarks, X = M.CORRIDOR;
  const $ = id => document.getElementById(id);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { p: M.defaultParams(), res: null, frame: 0, playing: false, lastTs: 0, raf: 0, pending: 0, openChip: null };

  // ---------- formatting ----------
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const fmt = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const sgn = (n, d) => (n < 0 ? '−' : '') + fmt(Math.abs(n), d);
  const tl = n => '₺' + fmtInt(n);
  const tlk = n => Math.abs(n) >= 10000 ? '₺' + fmt(n / 1000, 1) + 'k' : tl(n);
  const usd = n => 'US$' + fmt(n, n < 100 ? 2 : 0);
  const mmss = s => { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- parameter chips: predefined, literature-informed options ----------
  const pct = v => fmt(v * 100, 0) + ' %';
  const CHIPS = {
    traffic: {
      title: 'Traffic', fmt: p => `${fmtInt(p.arrivalRate)} veh/h`, get: p => p.arrivalRate, set: (p, v) => { p.arrivalRate = v; },
      step: { min: 200, max: 2000, step: 100, unit: 'veh/h' },
      options: [
        { v: 400, l: 'Quiet rural road', n: 'Order of 5,000 vehicles a day per direction. KGM maps give daily counts; peak flows must come from interval counts.' },
        { v: 800, l: 'Moderate intercity', n: 'Off-peak flow on a well-used two-lane highway.' },
        { v: 1200, l: 'Busy intercity · starter', n: 'Handout starter value: a peak-hour flow for a divided intercity road.' },
        { v: 1700, l: 'Near capacity', n: 'The HCM directional capacity of a two-lane highway is about 1,700 passenger cars per hour. Above this, queues form even without a checkpoint.' },
      ],
    },
    heavy: {
      title: 'Heavy vehicles', fmt: p => pct(p.heavyShare), get: p => p.heavyShare * 100, set: (p, v) => { p.heavyShare = v / 100; },
      step: { min: 0, max: 40, step: 1, unit: '%' }, scale: 100,
      options: [
        { v: 3, l: 'Urban arterial', n: 'Trucks mostly banned or routed elsewhere.' },
        { v: 7, l: 'Intercity · starter', n: 'Handout starter value.' },
        { v: 15, l: 'Freight route', n: 'KGM counts put heavy shares of 10 to 20 % on trunk roads between industrial regions.' },
        { v: 30, l: 'Port or industrial access', n: 'Access roads to ports, quarries and logistics parks.' },
      ],
    },
    duration: {
      title: 'Checkpoint duration', fmt: p => `${p.durationMin} min`, get: p => p.durationMin, set: (p, v) => { p.durationMin = v; },
      step: { min: 5, max: 180, step: 5, unit: 'min' },
      options: [
        { v: 15, l: 'Short stop', n: 'A brief operation; the queue clears quickly.' },
        { v: 30, l: 'Half hour · starter', n: 'Handout benchmark duration.' },
        { v: 60, l: 'One hour', n: 'Typical planned roadside operation.' },
        { v: 120, l: 'Two hours', n: 'Extended operation; the queue may reach the corridor entry.' },
      ],
    },
    speed: {
      title: 'Screening speed', fmt: p => `${p.screeningSpeed} km/h`, get: p => p.screeningSpeed, set: (p, v) => { p.screeningSpeed = v; },
      step: { min: 5, max: 60, step: 5, unit: 'km/h' },
      options: [
        { v: 10, l: 'Walking pace', n: 'Officer looks into every vehicle.' },
        { v: 20, l: 'Slow roll · starter', n: 'Handout starter value.' },
        { v: 30, l: 'Drive-through', n: 'Camera or plate-reader screening; vehicles barely slow.' },
      ],
    },
    headway: {
      title: 'Screening headway', fmt: p => `${fmt(p.screeningHeadway, p.screeningHeadway % 1 ? 1 : 0)} s`, get: p => p.screeningHeadway, set: (p, v) => { p.screeningHeadway = v; },
      step: { min: 1, max: 12, step: 0.5, unit: 's' },
      options: [
        { v: 3, l: 'Fast glance', n: 'Caps the screening stream at 1,200 vehicles an hour.' },
        { v: 4, l: 'Look and wave · starter', n: 'Handout value: a 4-second headway limits one stream to 900 vehicles an hour.' },
        { v: 6, l: 'Document glance', n: 'Caps the stream at 600 an hour; a queue forms at most traffic levels.' },
      ],
      calc: (p, v) => `stream capacity ${fmtInt(3600 / v)}/h vs ${fmtInt(p.arrivalRate)}/h arriving`,
    },
    share: {
      title: 'Share selected for inspection', fmt: p => pct(p.selectedFraction), get: p => p.selectedFraction * 100, set: (p, v) => { p.selectedFraction = v / 100; },
      step: { min: 0, max: 60, step: 1, unit: '%' },
      options: [
        { v: 2, l: 'Random spot check', n: 'One in fifty vehicles pulled aside.' },
        { v: 10, l: 'One in ten · starter', n: 'Handout starter value.' },
        { v: 25, l: 'Targeted operation', n: 'One in four; bays fill unless service is short.' },
        { v: 50, l: 'Every second vehicle', n: 'Close to stopping everyone; expect overflow.' },
      ],
      calc: (p, v) => `${fmtInt(p.arrivalRate * v / 100)} inspections requested per hour`,
    },
    inspection: {
      title: 'Inspection type', fmt: p => `${inspName(p)} (${fmtInt(p.serviceMean)} s)`, get: p => p.serviceMean, set: (p, v) => { p.serviceMean = v; },
      step: { min: 10, max: 900, step: 10, unit: 's' },
      options: [
        { v: 30, l: 'Document check', n: 'Licence and registration at the window. Sobriety and ID checkpoints typically hold a vehicle for 30 to 60 seconds.', apply: p => { p.serviceMean = 30; p.serviceCv = 0.5; } },
        { v: 60, l: 'Standard check · starter', n: 'Handout starter: lognormal, mean 60 s, CV 0.5.', apply: p => { p.serviceMean = 60; p.serviceCv = 0.5; } },
        { v: 180, l: 'Vehicle search', n: 'Boot and cabin search; a few minutes with high variability (CV 0.8).', apply: p => { p.serviceMean = 180; p.serviceCv = 0.8; } },
        { v: 420, l: 'Thorough search', n: 'Border-style secondary inspection, several minutes (CV 0.8).', apply: p => { p.serviceMean = 420; p.serviceCv = 0.8; } },
      ],
      calc: (p, v) => `bay capacity ${fmtInt(p.bays * 3600 / v)}/h for ${fmtInt(p.arrivalRate * p.selectedFraction)}/h requested`,
    },
    bays: {
      title: 'Inspection bays', fmt: p => `${p.bays} bay${p.bays > 1 ? 's' : ''}`, get: p => p.bays, set: (p, v) => { p.bays = v; },
      step: { min: 1, max: 8, step: 1, unit: 'bays' },
      options: [1, 2, 3, 4].map(v => ({ v, l: `${v} bay${v > 1 ? 's' : ''}`, n: v === 3 ? 'Handout starter value.' : '' })),
      calc: (p, v) => { const u = p.arrivalRate * p.selectedFraction / (v * 3600 / p.serviceMean); return `nominal utilisation ${fmt(u * 100, 0)} %${u >= 1 ? ' · no spare capacity' : ''}`; },
    },
    pocket: {
      title: 'Waiting pocket', fmt: p => `${p.pocket} waiting slot${p.pocket === 1 ? '' : 's'}`, get: p => p.pocket, set: (p, v) => { p.pocket = v; },
      step: { min: 0, max: 8, step: 1, unit: 'slots' },
      options: [{ v: 0, l: 'No pocket', n: 'A selected vehicle with no free bay blocks the lane or is released.' }, { v: 2, l: 'Two slots · starter', n: '' }, { v: 4, l: 'Four slots', n: 'A dedicated waiting area off the through lane.' }],
    },
    overflow: {
      title: 'When bays and pocket are full', fmt: p => p.overflow === 'block' ? 'holds the through lane' : 'releases vehicles unserved', get: p => p.overflow, set: (p, v) => { p.overflow = v; },
      options: [{ v: 'block', l: 'Hold the through lane', n: 'The selected vehicle waits at the bay entry; everyone behind waits with it.' }, { v: 'skip', l: 'Release unserved', n: 'Selection is suspended while no space is free; fewer inspections, shorter queue.' }],
    },
    vot: {
      title: 'Value of travel time', fmt: p => `₺${fmtInt(p.prices.vot)} per person-hour`, get: p => p.prices.vot, set: (p, v) => { p.prices.vot = v; },
      step: { min: 50, max: 800, step: 10, unit: '₺/h' },
      options: [{ v: 100, l: 'Low', n: 'Handout sensitivity case.' }, { v: 200, l: 'Starter', n: 'Handout scenario value; not an official appraisal rate.' }, { v: 400, l: 'High', n: 'Handout sensitivity case, closer to business travel values.' }],
    },
    prices: { title: 'Fuel, electricity and exchange rate', fmt: () => 'dated retail prices', custom: true },
  };
  function inspName(p) { const m = p.serviceMean; return m <= 40 ? 'document check' : m <= 90 ? 'standard check' : m <= 300 ? 'vehicle search' : 'thorough search'; }

  const SENTENCE = 'On a {traffic} road with {heavy} heavy vehicles, the checkpoint runs for {duration}, screening at {speed}, one vehicle every {headway}. It selects {share} of vehicles for a {inspection} in {bays} with {pocket}; when all are full it {overflow}. Time is valued at {vot}, energy at {prices}.';

  const PRESETS = [
    { name: 'Handout starter', apply: () => {} },
    { name: 'Quiet rural road', apply: p => { p.arrivalRate = 400; p.bays = 2; } },
    { name: 'Peak intercity', apply: p => { p.arrivalRate = 1700; p.selectedFraction = 0.05; p.serviceMean = 45; p.durationMin = 60; } },
    { name: 'Freight corridor', apply: p => { p.arrivalRate = 900; p.heavyShare = 0.30; p.selectedFraction = 0.15; p.serviceMean = 120; p.durationMin = 60; p.pocket = 3; } },
    { name: 'Intensive search', apply: p => { p.selectedFraction = 0.25; p.serviceMean = 180; p.serviceCv = 0.8; p.bays = 4; p.pocket = 4; p.durationMin = 60; } },
    { name: 'Urban arterial', apply: p => { p.arrivalRate = 1000; p.heavyShare = 0.03; p.bays = 2; p.serviceMean = 40; p.screeningSpeed = 10; p.screeningHeadway = 5; } },
  ];
  function presetParams(pr) { const p = M.defaultParams(); pr.apply(p); return p; }
  function sig(p) { const q = clone(p); delete q.seed; delete q.record; delete q.dt; delete q.prices; delete q.maxAfterMin; return JSON.stringify(q); }

  function renderPresets() {
    const cur = sig(state.p);
    $('presets').innerHTML = PRESETS.map((pr, i) => `<button type="button" class="preset" data-i="${i}" aria-pressed="${sig(presetParams(pr)) === cur}">${pr.name}</button>`).join('');
  }
  $('presets').addEventListener('click', e => {
    const b = e.target.closest('.preset'); if (!b) return;
    const seed = state.p.seed, prices = state.p.prices;
    state.p = presetParams(PRESETS[Number(b.dataset.i)]); state.p.seed = seed; state.p.prices = prices;
    closePop(); renderSentence(); run();
  });

  function renderSentence() {
    $('sentence').innerHTML = SENTENCE.replace(/\{(\w+)\}/g, (_, k) => `<button type="button" class="chip" data-chip="${k}" aria-expanded="false" aria-haspopup="dialog">${CHIPS[k].fmt(state.p)}</button>`);
    renderPresets();
  }
  $('sentence').addEventListener('click', e => {
    const c = e.target.closest('.chip'); if (!c) return;
    if (state.openChip === c.dataset.chip) closePop(); else openPop(c.dataset.chip, c);
  });

  // ---------- popover ----------
  const pop = $('pop');
  function closePop() {
    pop.hidden = true; state.openChip = null;
    document.querySelectorAll('.chip[aria-expanded="true"]').forEach(c => c.setAttribute('aria-expanded', 'false'));
  }
  function openPop(key, chipEl) {
    const c = CHIPS[key], p = state.p;
    state.openChip = key;
    document.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-expanded', String(x.dataset.chip === key)));
    let html = `<h4>${c.title}<button type="button" data-close aria-label="Close">×</button></h4>`;
    if (c.custom) {
      html += `<div class="prices">
        <label for="pr-petrol">Petrol ₺/L <span class="badge sourced">Sourced</span></label><input id="pr-petrol" type="number" step="0.1" value="${p.prices.petrol}">
        <label for="pr-diesel">Diesel ₺/L <span class="badge sourced">Sourced</span></label><input id="pr-diesel" type="number" step="0.1" value="${p.prices.diesel}">
        <label for="pr-lpg">LPG ₺/L <span class="badge sourced">Sourced</span></label><input id="pr-lpg" type="number" step="0.1" value="${p.prices.lpg}">
        <label for="pr-electricity">Electricity ₺/kWh <span class="badge assumed">Assumed</span></label><input id="pr-electricity" type="number" step="0.1" value="${p.prices.electricity}">
        <label for="pr-fx">₺ per US$ <span class="badge sourced">Sourced</span></label><input id="pr-fx" type="number" step="0.001" value="${p.prices.fx}">
      </div><p class="note cap">Petrol Ofisi Ankara retail page, VAT inclusive, accessed 25 Oct 2026; TCMB indicative selling rate via e-Devlet, 23 Oct 2026. Prices change the cost panel only, so they apply at once.</p>`;
    } else {
      const cur = c.get(p);
      html += `<div class="opts">` + c.options.map((o, i) => {
        const on = o.v === cur || (c.scale && Math.abs(o.v - cur) < 1e-9);
        const val = typeof o.v === 'number' ? fmtInt(o.v) + (c.step ? ' ' + c.step.unit : '') : '';
        return `<button type="button" class="opt" data-i="${i}" aria-pressed="${on}"><span class="ol">${o.l}</span><span class="ov">${val}</span>${o.n ? `<span class="on">${o.n}</span>` : ''}${c.calc ? `<span class="on">${c.calc(p, o.v)}</span>` : ''}<span class="os" data-sweep="${i}"></span></button>`;
      }).join('') + `</div>`;
      if (c.step) html += `<div class="stepper"><button type="button" data-step="-1" aria-label="Decrease">−</button><input type="number" id="stepval" min="${c.step.min}" max="${c.step.max}" step="${c.step.step}" value="${cur}" aria-label="${c.title}"><button type="button" data-step="1" aria-label="Increase">+</button></div><p class="note cap" style="margin:0">Any value between ${c.step.min} and ${c.step.max} ${c.step.unit}. Each option shows the simulated cost and extra CO₂ it would give.</p>`;
    }
    pop.innerHTML = html;
    pop.hidden = false;
    const band = pop.offsetParent || pop.parentElement;
    const left = Math.min(chipEl.offsetLeft, band.clientWidth - pop.offsetWidth - 12);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = (chipEl.offsetTop + chipEl.offsetHeight + 6) + 'px';
    if (!c.custom) requestSweeps(key);
    const first = pop.querySelector('.opt[aria-pressed="true"], input, button'); if (first) first.focus();
  }
  pop.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { closePop(); return; }
    const key = state.openChip; if (!key) return;
    const c = CHIPS[key];
    const o = e.target.closest('.opt');
    if (o) { const opt = c.options[Number(o.dataset.i)]; if (opt.apply) opt.apply(state.p); else c.set(state.p, opt.v); closePop(); renderSentence(); run(); return; }
    const st = e.target.closest('[data-step]');
    if (st) { const inp = $('stepval'); let v = Number(inp.value) + Number(st.dataset.step) * c.step.step; v = Math.min(c.step.max, Math.max(c.step.min, v)); inp.value = +v.toFixed(3); c.set(state.p, v); renderSentence(); keepOpen(key); run(); }
  });
  pop.addEventListener('change', e => {
    const key = state.openChip; if (!key) return;
    const c = CHIPS[key];
    if (e.target.id === 'stepval') { let v = Number(e.target.value); if (!isFinite(v)) return; v = Math.min(c.step.max, Math.max(c.step.min, v)); c.set(state.p, v); renderSentence(); keepOpen(key); run(); }
    if (e.target.id && e.target.id.startsWith('pr-')) {
      const k = e.target.id.slice(3), v = Number(e.target.value); if (!isFinite(v) || v <= 0) return;
      state.p.prices[k] = v;
      if (state.res) { state.res.acc = M.account(state.res.base, state.res.cp, state.p); renderCost(); renderAssumptions(); }
    }
  });
  function keepOpen(key) { const chip = document.querySelector(`.chip[data-chip="${key}"]`); if (chip) chip.setAttribute('aria-expanded', 'true'); state.openChip = key; const el = $('stepval'); if (el) el.focus(); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) closePop(); });
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.chip')) closePop(); });

  // ---------- workers ----------
  let mainWorker = null, sweepWorker = null;
  try { mainWorker = new Worker('js/worker.js'); sweepWorker = new Worker('js/worker.js'); } catch (e) { mainWorker = sweepWorker = null; }
  if (mainWorker) {
    mainWorker.onerror = () => { mainWorker = null; sweepWorker = null; run(); };
    mainWorker.onmessage = e => { const d = e.data; if (d.id !== state.pending) return; if (d.ok) gotResult(d.result); else failed(d.error); };
  }
  const sweepCache = new Map(), sweepQueue = [];
  let sweepBusy = false, sweepId = 0;
  if (sweepWorker) sweepWorker.onmessage = e => {
    const job = sweepQueue.shift(); sweepBusy = false;
    if (job && e.data.ok) { sweepCache.set(job.key, e.data.summary); paintSweep(job); }
    pumpSweeps();
  };
  function pumpSweeps() { if (!sweepWorker || sweepBusy || !sweepQueue.length) return; sweepBusy = true; sweepWorker.postMessage({ id: ++sweepId, params: sweepQueue[0].params, summary: true }); }
  function requestSweeps(key) {
    const c = CHIPS[key]; if (!c.options) return;
    c.options.forEach((o, i) => {
      const q = clone(state.p); if (o.apply) o.apply(q); else c.set(q, o.v);
      const same = sig(q) === sig(state.p) && state.res;
      q.record = false; q.dt = 0.25;
      const job = { key: sig(q) + '|' + q.seed, params: q, chip: key, i };
      if (same) { paintSweep(job, { cost: state.res.acc.combinedTRY, co2: state.res.acc.tot.dCO2, incomplete: state.res.cp.incomplete }); return; }
      if (sweepCache.has(job.key)) { paintSweep(job); return; }
      if (!sweepWorker) return;
      const el = pop.querySelector(`[data-sweep="${i}"]`); if (el) el.textContent = 'computing…';
      sweepQueue.push(job); pumpSweeps();
    });
  }
  function paintSweep(job, s) {
    if (state.openChip !== job.chip) return;
    s = s || sweepCache.get(job.key); if (!s) return;
    const el = pop.querySelector(`[data-sweep="${job.i}"]`); if (!el) return;
    el.textContent = `≈ ${tlk(s.cost)} · ${sgn(s.co2 / 1000, 0)} kg CO₂${s.incomplete ? ' · queue does not clear' : ''}`;
  }

  // ---------- run ----------
  function run() {
    $('computing').hidden = false;
    $('status').textContent = 'Computing baseline and checkpoint runs…';
    const id = ++state.pending, params = clone(state.p);
    if (mainWorker) { mainWorker.postMessage({ id, params }); return; }
    setTimeout(() => { if (id !== state.pending) return; try { gotResult(M.runPaired(params)); } catch (e) { failed(e.message); } }, 30);
  }
  function failed(msg) { $('status').textContent = 'The run failed: ' + msg; $('computing').hidden = true; }
  function gotResult(r) {
    const oldT = state.res ? state.res.cp.frames[Math.min(Math.floor(state.frame), state.res.cp.frames.length - 1)].t : null;
    const wasPlaying = state.playing;
    state.res = r;
    const n = r.cp.frames.length;
    if (oldT !== null) { let k = 0; while (k < n - 1 && r.cp.frames[k].t < oldT) k++; state.frame = k; }
    else state.frame = reduced ? Math.floor(n * 0.4) : 0;
    $('status').textContent = `${fmtInt(r.acc.tot.n)} vehicles paired · ${r.cp.incomplete ? 'queue did NOT clear within the horizon' : 'queue cleared at ' + mmss(r.cp.queueClearedAt)} · ${r.cp.stats.selected} inspections selected`;
    renderAll();
    $('computing').hidden = true;
    if (!reduced && (wasPlaying || !state.raf)) startPlay();
  }
  function renderAll() {
    renderCost(); renderPollution(); renderStrip(); renderChecks(); renderAssumptions();
    $('scrub').max = Math.max(0, state.res.cp.frames.length - 1); $('scrub').value = Math.floor(state.frame);
    drawReplay(); drawQueueChart();
    $('csvOut').value = '';
  }

  // ---------- cost panel ----------
  function renderCost() {
    const a = state.res.acc, pr = state.p.prices, U = x => usd(x / a.fx);
    $('costBig').innerHTML = `${tl(a.combinedTRY)}<small>≈ ${U(a.combinedTRY)}</small>`;
    const items = [
      ['Petrol', a.energyTRY.petrol, `${sgn(a.tot.dL.petrol, 1)} L`],
      ['Diesel', a.energyTRY.diesel, `${sgn(a.tot.dL.diesel, 1)} L`],
      ['LPG', a.energyTRY.lpg, `${sgn(a.tot.dL.lpg, 1)} L`],
      ['Electricity', a.energyTRY.electricity, `${sgn(a.tot.dKwh, 1)} kWh`],
      ['Time value', a.timeTRY, `${fmt(a.personHours, 1)} person-h`, true],
    ];
    const max = Math.max(1, ...items.map(i => Math.abs(i[1])));
    $('costBars').innerHTML = items.map(i =>
      `<div class="bar${i[3] ? ' time' : ''}"><span class="name">${i[0]}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.abs(i[1]) / max * 44)}%"></div><span class="lbl">${i[1] < 0 ? '−' : ''}${tl(Math.abs(i[1]))} · ${U(Math.abs(i[1]))} <span style="color:var(--muted)">${i[2]}</span></span></div></div>`
    ).join('');
    $('costLine').innerHTML = `Energy <b>${tl(a.energyTotalTRY)}</b> at dated retail prices (an expenditure) · time <b>${tl(a.timeTRY)}</b> at ₺${fmtInt(pr.vot)} per person-hour (a valuation, not an invoice) · <b>₺${fmt(a.perVehicleTRY, 2)}</b> per affected vehicle.`;
    $('votLine').innerHTML = 'If time were worth ' + a.votSensitivity.map(s => `₺${s.vot}/h: <b>${tl(s.totalTRY)}</b>`).join(' · ') + '. Excludes wear, pollution damage, crashes and enforcement costs or benefits.';
  }

  // ---------- pollution panel ----------
  function renderPollution() {
    const a = state.res.acc, t = a.tot, inc = a.increase, cx = a.context;
    const pc = v => (v >= 0 ? '+' : '−') + fmt(Math.abs(v), 0) + '%';
    const tiles = [
      { n: sgn(t.dCO2 / 1000, 1), u: 'kg CO₂', l: 'Extra carbon dioxide', d: pc(inc.co2) + ' vs the same vehicles on a free road', main: true },
      { n: sgn(t.dNOx, 0), u: 'g NOₓ', l: 'Nitrogen oxides', d: pc(inc.nox) },
      { n: sgn(t.dPM, 1), u: 'g exhaust PM', l: 'Particulate matter', d: pc(inc.pm) },
      { n: sgn(t.dL.petrol + t.dL.diesel + t.dL.lpg, 1), u: `L fuel · ${sgn(t.dKwh, 1)} kWh`, l: 'Extra fuel and electricity', d: pc(inc.fuel) + ' fuel' },
      { n: fmt(a.exposurePersonHours, 1), u: 'person-hours', l: 'Extra time in slow traffic at the checkpoint', d: 'exposure proxy' },
    ];
    $('polTiles').innerHTML = tiles.map(x => `<div class="tile${x.main ? ' main' : ''}"><div class="n${x.main ? ' main' : ''}">${x.n}</div><div class="u">${x.u}</div><div class="l">${x.l}</div><div class="d">${x.d}</div></div>`).join('');
    const lines = [
      ['CO₂', `one average petrol car driving <b>${fmtInt(cx.carKm)} km</b> · <b>${fmt(cx.householdDays, 0)} days</b> of a household's electricity · what <b>${fmt(cx.treeYears, 1)} trees</b> take up in a year`],
      ['NOₓ', `a Euro 6 diesel car driving <b>${fmtInt(cx.euro6DieselKm)} km</b> at its 80 mg/km limit · an older diesel driving <b>${fmtInt(cx.olderDieselKm)} km</b> at 0.5 g/km`],
      ['PM', `a car driving <b>${fmtInt(cx.euroPmKm)} km</b> at the 4.5 mg/km Euro 5/6 limit, exhaust only`],
      ['Time', `travel time <b>+${fmt(inc.travel, 0)}%</b>, emissions about <b>${pc(inc.co2)}</b>: idling and creeping burn less per second than cruising, so pollution grows more slowly than delay`],
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

  // ---------- elevated paired replay ----------
  const road = $('road');
  const DIMS = { car: [1.8, 1.5], van: [2.0, 2.2], truck: [2.5, 3.6], bus: [2.5, 3.4] };
  function startPlay() { state.playing = true; $('play').textContent = 'Pause'; state.lastTs = 0; if (!state.raf) state.raf = requestAnimationFrame(tick); }
  function stopPlay() { state.playing = false; $('play').textContent = 'Play'; if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; }
  function tick(ts) {
    state.raf = 0;
    if (!state.playing || !state.res) return;
    if (state.lastTs) {
      const speed = Number($('speed').value);
      state.frame += Math.min(0.1, (ts - state.lastTs) / 1000) * speed / 0.5;
      const last = state.res.cp.frames.length - 1;
      if (state.frame >= last) state.frame = 0;          // loop
      $('scrub').value = Math.floor(state.frame);
      drawReplay();
    }
    state.lastTs = ts;
    state.raf = requestAnimationFrame(tick);
  }
  function indexOf(frame) {
    if (!frame._idx) { frame._idx = new Map(); for (let i = 0; i < frame.ids.length; i++) frame._idx.set(frame.ids[i], i); }
    return frame._idx;
  }

  function drawReplay() {
    if (!state.res) return;
    const dpr = window.devicePixelRatio || 1;
    const W = road.clientWidth, H = road.clientHeight;
    if (road.width !== Math.round(W * dpr) || road.height !== Math.round(H * dpr)) { road.width = Math.round(W * dpr); road.height = Math.round(H * dpr); }
    const g = road.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const C = { road: css('--road'), roadInk: css('--road-ink'), fg: css('--fg'), muted: css('--muted'), green: css('--green'), orange: css('--orange'),
      yellow: css('--yellow'), grey: css('--grey'), line: css('--line'), mono: css('--mono'), font: css('--font') };

    const framesC = state.res.cp.frames, framesB = state.res.base.frames;
    const fi = Math.min(Math.floor(state.frame), framesC.length - 1), frac = state.frame - fi;
    const fc = framesC[fi], fcn = framesC[Math.min(fi + 1, framesC.length - 1)];
    const bi = Math.min(fi, framesB.length - 1);
    const fb = framesB[bi], fbn = framesB[Math.min(bi + 1, framesB.length - 1)];
    $('clock').innerHTML = `t = <b>${mmss(fc.t)}</b> · restriction <b>${fc.cpOn ? 'ON' : 'OFF'}</b> · queue <b>${fc.q}</b>${fc.tail !== null ? ` · tail ${fmtInt(X.gate - fc.tail)} m upstream` : ''}`;

    // geometry: x along the road (m), y lateral (m, away from viewer), z up (m). Lateral scale is exaggerated for legibility.
    const winLen = Math.min(260, Math.max(120, (W - 40) / 4.5));
    const x0 = X.gate - winLen * 0.52, s = (W - 36) / winLen, L = s * 2.4;
    const man = state.res.manifest.vehicles;
    const stripH = (H - 16) / 2;

    function strip(frame, next, yBase, isCp, title, sub) {
      const P = (x, y, z) => [8 + (x - x0) * s + y * L * 0.6, yBase - y * L * 0.5 - z * L * 0.8];
      const poly = (pts, fill, stroke) => { g.beginPath(); pts.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); } };
      const box = (xr, len, yc, w, h, col, selected, label) => {
        const y0 = yc - w / 2, y1 = yc + w / 2, x1 = xr + len;
        poly([P(xr, y0, 0), P(x1, y0, 0), P(x1, y0, h), P(xr, y0, h)], col[1]);
        poly([P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, h), P(x1, y0, h)], col[2]);
        poly([P(xr, y0, h), P(x1, y0, h), P(x1, y1, h), P(xr, y1, h)], col[0], selected ? C.yellow : null);
        if (selected) { g.lineWidth = 2; g.strokeStyle = C.yellow; g.stroke(); }
        if (label) { const q = P(xr, y1, h + 1.2); g.fillStyle = C.yellow; g.font = '10px ' + C.mono; g.fillText(label, q[0], q[1]); }
      };
      const xl = x0 - 10, xr = x0 + winLen + 10;
      // far planting: cypresses at fixed positions
      g.fillStyle = C.green;
      for (let x = Math.floor(xl / 37) * 37; x < xr; x += 37) {
        const off = ((x * 7919) % 11) - 5, hgt = 5 + ((x * 31) % 3);
        const b = P(x + off, 12.5, 0), tpt = P(x + off, 12.5, hgt);
        g.globalAlpha = 0.75; poly([[b[0] - 2.2, b[1]], [b[0] + 2.2, b[1]], tpt], C.green); g.globalAlpha = 1;
      }
      // bays and pocket (off-lane, behind the road)
      if (isCp) {
        poly([P(X.bayEntry - 2, 8.3, 0), P(X.rejoin + 2, 8.3, 0), P(X.rejoin + 2, 12.3, 0), P(X.bayEntry - 2, 12.3, 0)], C.green);
        const nb = state.p.bays, slot = (X.rejoin - X.bayEntry) / nb;
        for (let i = 0; i < nb; i++) {
          const sx = X.bayEntry + i * slot + 1;
          poly([P(sx, 9, 0.02), P(sx + slot - 2, 9, 0.02), P(sx + slot - 2, 11.6, 0.02), P(sx, 11.6, 0.02)], 'rgba(242,239,232,0.85)');
        }
        const lab = P(X.rejoin + 4, 10, 0); g.fillStyle = C.fg; g.font = '600 9px ' + C.font; g.fillText('BAYS', lab[0], lab[1]);
        if (state.p.pocket > 0) {
          poly([P(X.zoneEnd + 4, 8.3, 0), P(X.bayEntry - 6, 8.3, 0), P(X.bayEntry - 6, 11.3, 0), P(X.zoneEnd + 4, 11.3, 0)], 'rgba(143,144,139,0.45)');
          const pl = P(X.zoneEnd + 4, 12.3, 0); g.fillStyle = C.muted; g.font = '9px ' + C.mono; g.fillText(`pocket ${frame.pocket.length}/${state.p.pocket}`, pl[0], pl[1]);
        }
      }
      // road
      poly([P(xl, 0, 0), P(xr, 0, 0), P(xr, 7, 0), P(xl, 7, 0)], C.road);
      g.strokeStyle = 'rgba(242,239,232,0.55)'; g.lineWidth = 1;
      for (const y of [0.6, 6.4]) { const a = P(xl, y, 0.01), b = P(xr, y, 0.01); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      if (isCp) {
        poly([P(X.zoneStart, 0.6, 0.01), P(X.zoneEnd, 0.6, 0.01), P(X.zoneEnd, 6.4, 0.01), P(X.zoneStart, 6.4, 0.01)], frame.cpOn ? 'rgba(216,86,34,0.28)' : 'rgba(216,86,34,0.10)');
        g.fillStyle = frame.cpOn ? C.orange : 'rgba(216,86,34,0.45)';
        for (let x = X.zoneStart; x <= X.zoneEnd; x += 10) for (const y of [0.9, 6.1]) { const b = P(x, y, 0), t = P(x, y, 0.9); poly([[b[0] - 2, b[1]], [b[0] + 2, b[1]], t], g.fillStyle); }
      }
      // vehicles: far lane objects first (bays, pocket), then the lane
      if (isCp) {
        const nb = state.p.bays, slot = (X.rejoin - X.bayEntry) / nb;
        frame.bays.forEach((b, i) => {
          if (!b) return;
          const len = M.CLASSES[b.cls].len, d = DIMS[b.cls];
          box(X.bayEntry + i * slot + 2, Math.min(len, slot - 4), 10.3, d[0], d[1], b.state === 'rejoin' ? ['#E6C77A', C.yellow, '#B08A2E'] : ['#A9AAA5', C.grey, '#6E6F6B'], false,
            b.state === 'service' ? Math.ceil(b.remaining) + 's' : b.state === 'rejoin' ? 'merge' : '');
        });
        frame.pocket.forEach((v, i) => { const len = M.CLASSES[v.cls].len, d = DIMS[v.cls]; box(X.bayEntry - 8 - (i + 1) * (len + 2), len, 9.8, d[0], d[1], ['#A9AAA5', C.grey, '#6E6F6B'], false, ''); });
      }
      const nextIdx = indexOf(next);
      const order = [];
      for (let i = 0; i < frame.ids.length; i++) order.push(i);
      for (const i of order) {
        const id = frame.ids[i], m = man[id];
        let x = frame.xs[i];
        const j = nextIdx.get(id);
        if (j !== undefined) { const dx = next.xs[j] - x; if (dx > -1 && dx < 40) x += dx * frac; }
        const len = M.CLASSES[m.cls].len, d = DIMS[m.cls];
        if (x < xl || x - len > xr) continue;
        const st = frame.st[i];
        box(x - len, len, 3.5, d[0], d[1], st === 2 ? ['#E89A78', C.orange, '#9E3F19'] : ['#A9AAA5', C.grey, '#6E6F6B'], st === 1 || st === 2, (st === 1 || st === 2) ? '#' + id : '');
      }
      // screening gantry
      if (isCp) {
        const col = frame.cpOn ? C.yellow : 'rgba(255,189,73,0.35)';
        g.strokeStyle = col; g.lineWidth = 2;
        for (const y of [-0.6, 7.6]) { const a = P(X.gate, y, 0), b = P(X.gate, y, 5.2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
        const a = P(X.gate, -0.6, 5.2), b = P(X.gate, 7.6, 5.2); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        g.fillStyle = col; g.font = '600 9px ' + C.font; g.fillText('KONTROL', b[0] + 4, b[1] + 3);
      }
      // queue tail
      if (frame.tail !== null) {
        g.fillStyle = C.yellow; g.font = '10px ' + C.mono;
        if (frame.tail > xl) {
          const a = P(frame.tail, 7.4, 0), b = P(frame.tail, 7.4, 4);
          g.fillRect(a[0] - 1, b[1], 2, a[1] - b[1]);
          g.fillText(`queue tail · ${fmtInt(X.gate - frame.tail)} m`, Math.max(8, b[0] - 60), b[1] - 4);
        } else {
          const a = P(xl, 7.4, 2.4);
          g.fillText(`◄ queue tail ${fmtInt(X.gate - frame.tail)} m upstream · ${frame.q} vehicles`, 10, a[1] - 4);
        }
      }
      // titles
      g.fillStyle = C.fg; g.font = '600 12px ' + C.font; g.fillText(title, 10, yBase - stripH + 22);
      g.font = '11px ' + C.mono; g.fillStyle = C.muted; g.fillText(sub, 10 + g.measureText(title).width * 1.2 + 12, yBase - stripH + 22);
    }

    strip(fb, fbn, stripH - 10, false, 'BASELINE', 'same vehicles, no checkpoint');
    strip(fc, fcn, 2 * stripH - 12, true, 'CHECKPOINT', fc.cpOn ? 'restriction active' : 'restriction ended, queue clearing');
    // corridor minimap
    const my = H - 9, ms = W / X.length;
    g.fillStyle = 'rgba(143,144,139,0.35)'; g.fillRect(0, my, W, 4);
    if (fc.tail !== null) { g.fillStyle = C.orange; g.fillRect(fc.tail * ms, my, (X.gate - fc.tail) * ms, 4); }
    g.fillStyle = C.yellow; g.fillRect(X.gate * ms - 1, my - 2, 2, 8);
    g.strokeStyle = C.muted; g.lineWidth = 1; g.strokeRect(x0 * ms + 0.5, my - 3.5, winLen * ms, 11);
    g.fillStyle = C.muted; g.font = '9px ' + C.mono; g.textAlign = 'right'; g.fillText('corridor 4,500 m · lateral scale exaggerated', W - 4, my - 5); g.textAlign = 'left';
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
    g.setLineDash([4, 4]); g.strokeStyle = muted; g.beginPath(); g.moveTo(Math.round(xs(D)) + 0.5, T); g.lineTo(Math.round(xs(D)) + 0.5, H - Bm); g.stroke(); g.setLineDash([]);
    g.textAlign = 'left'; g.fillStyle = fg; g.fillText('restriction ends', xs(D) + 6, T + 10);
    const orange = css('--orange');
    g.beginPath(); g.moveTo(xs(ser[0].t), ys(0));
    for (const s of ser) g.lineTo(xs(s.t), ys(s.q));
    g.lineTo(xs(ser[ser.length - 1].t), ys(0)); g.closePath();
    g.fillStyle = 'rgba(216,86,34,0.22)'; g.fill();
    g.beginPath(); for (let i = 0; i < ser.length; i++) { const s = ser[i]; if (i) g.lineTo(xs(s.t), ys(s.q)); else g.moveTo(xs(s.t), ys(s.q)); }
    g.strokeStyle = orange; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    let pk = ser[0]; for (const s of ser) if (s.q > pk.q) pk = s;
    g.fillStyle = orange; g.beginPath(); g.arc(xs(pk.t), ys(pk.q), 3.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = fg; g.textAlign = xs(pk.t) > W * 0.45 ? 'right' : 'left';
    g.fillText(`peak ${pk.q} vehicles at ${mmss(pk.t)}`, xs(pk.t) + (xs(pk.t) > W * 0.45 ? -8 : 8), ys(pk.q) - 6);
    if (state.res.cp.queueClearedAt !== null) { g.textAlign = 'right'; g.fillStyle = muted; g.fillText(`queue clears at ${mmss(state.res.cp.queueClearedAt)}`, W - R, ys(0) - 8); }
    // replay cursor
    const fr = state.res.cp.frames[Math.min(Math.floor(state.frame), state.res.cp.frames.length - 1)];
    g.strokeStyle = fg; g.lineWidth = 1; g.globalAlpha = 0.5; g.beginPath(); g.moveTo(Math.round(xs(fr.t)) + 0.5, T); g.lineTo(Math.round(xs(fr.t)) + 0.5, H - Bm); g.stroke(); g.globalAlpha = 1;
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
  qc.addEventListener('click', e => {
    if (!chartGeom || !state.res) return;
    const rect = qc.getBoundingClientRect(), t = (e.clientX - rect.left - chartGeom.L) / (chartGeom.W - chartGeom.L - chartGeom.R) * chartGeom.tMax;
    const fr = state.res.cp.frames; let k = 0; while (k < fr.length - 1 && fr[k].t < t) k++;
    state.frame = k; $('scrub').value = k; drawReplay(); drawQueueChart();
  });

  // ---------- exports ----------
  function copyText(txt) {
    const done = ok => { $('status').textContent = ok ? 'Copied to clipboard.' : 'Clipboard refused; the text is selected, press Ctrl/Cmd+C.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => done(true), () => { $('csvOut').select(); done(false); });
    else { $('csvOut').select(); done(false); }
  }
  $('csvPaired').addEventListener('click', () => { if (state.res) $('csvOut').value = M.pairedCsv(state.res.acc); });
  $('csvAssume').addEventListener('click', () => { $('csvOut').value = M.assumptionsCsv(state.p); });
  $('copyCsv').addEventListener('click', () => { if (!$('csvOut').value && state.res) $('csvOut').value = M.pairedCsv(state.res.acc); copyText($('csvOut').value); });

  // ---------- wiring ----------
  $('play').addEventListener('click', () => { if (!state.res) return; if (state.playing) stopPlay(); else startPlay(); });
  $('scrub').addEventListener('input', () => { stopPlay(); state.frame = Number($('scrub').value); drawReplay(); drawQueueChart(); });
  $('reset').addEventListener('click', () => { state.p = M.defaultParams(); closePop(); renderSentence(); run(); });
  $('shuffle').addEventListener('click', () => { state.p.seed = (state.p.seed % 30) + 1; closePop(); run(); });
  let resizeT = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { drawReplay(); drawQueueChart(); closePop(); }, 80); });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (mq.addEventListener) mq.addEventListener('change', () => { drawReplay(); drawQueueChart(); });
  new MutationObserver(() => { drawReplay(); drawQueueChart(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (state.playing) { stopPlay(); state.playing = true; } } else if (state.playing && !state.raf) { state.lastTs = 0; state.raf = requestAnimationFrame(tick); } });

  renderSentence();
  run();
})();
