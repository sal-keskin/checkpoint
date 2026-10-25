/* CHECKPOINT LAB — browser traffic, energy and accounting model.
   Evidence labels used throughout:
     SOURCED   dated price or exchange-rate reference
     ASSUMED   scenario input chosen for the demonstration
     SIMULATED model output of this uncalibrated prototype
   Nothing here is calibrated to an observed Turkish checkpoint. */
(function (root) {
  'use strict';

  const G = 9.81, RHO_AIR = 1.2;
  const S0 = 2.0;          // m, standstill gap (ASSUMED)
  const T_HEADWAY = 1.2;   // s, desired time headway (ASSUMED)

  // ---------- assumptions register (exported with every result) ----------
  const ASSUMPTIONS = [];
  function A(key, value, unit, status, note) {
    ASSUMPTIONS.push({ key, value, unit, status, note });
    return value;
  }

  const PRICES_DEFAULT = {
    fx: A('fx_try_per_usd', 49.654, 'TRY per US$', 'SOURCED', 'TCMB indicative USD selling rate via e-Devlet, 23 Oct 2026'),
    petrol: A('price_petrol', 77.30, 'TRY/L', 'SOURCED', 'Petrol Ofisi Ankara page, VAT-inclusive, accessed 25 Oct 2026'),
    diesel: A('price_diesel', 97.90, 'TRY/L', 'SOURCED', 'same page and access date'),
    lpg: A('price_lpg', 41.29, 'TRY/L', 'SOURCED', 'same page and access date'),
    electricity: A('price_electricity', 5.00, 'TRY/kWh', 'ASSUMED', 'planning value, not a verified tariff'),
    vot: A('value_of_time', 200, 'TRY per person-hour', 'ASSUMED', 'scenario value, not an official appraisal rate'),
  };

  const X = {
    length: A('corridor_length', 4500, 'm', 'ASSUMED', 'single lane, one direction; 3,200 m of upstream storage'),
    gate: 3200,
    zoneStart: 3100,
    zoneEnd: 3220,
    bayEntry: 3240,
    rejoin: 3310,
    exposureFrom: 2600,
  };
  A('screening_zone', '3100-3220', 'm', 'ASSUMED', 'reduced-speed taper around the screening point at 3,200 m');
  A('bay_geometry', 'entry 3240 / rejoin 3310', 'm', 'ASSUMED', 'off-lane bays; a bay is held until the vehicle has merged back');
  A('exposure_zone', '2600-3310, below 30 km/h', 'm', 'ASSUMED', 'proxy for person-time spent in slow traffic near the checkpoint');

  const CLASSES = {
    car:   { len: 4.5, mass: 1400,  aMax: 1.5, bComf: 2.0, cdA: 0.65, cr: 0.012, vDes: 90, vSd: 6, occ: [0.55, 0.30, 0.10, 0.05], svcMult: 1.0 },
    van:   { len: 5.5, mass: 2400,  aMax: 1.2, bComf: 2.0, cdA: 1.20, cr: 0.012, vDes: 85, vSd: 5, occ: [0.75, 0.20, 0.05, 0.00], svcMult: 1.2, fuel: 'diesel' },
    truck: { len: 12,  mass: 18000, aMax: 0.7, bComf: 1.5, cdA: 5.00, cr: 0.008, vDes: 80, vSd: 4, occ: [0.90, 0.10, 0.00, 0.00], svcMult: 1.8, fuel: 'diesel_hd', heavy: true },
    bus:   { len: 12,  mass: 14000, aMax: 0.9, bComf: 1.5, cdA: 4.50, cr: 0.009, vDes: 85, vSd: 4, occFixed: 25, svcMult: 1.5, fuel: 'diesel_hd', heavy: true },
  };
  A('vehicle_classes', 'car / van / truck / bus', '', 'ASSUMED', 'length, mass, drag area, rolling resistance, acceleration limits per class');
  A('occupancy', 'car mean 1.65, van 1.3, truck 1.1, bus 25', 'persons', 'ASSUMED', 'drawn per vehicle from the manifest stream, independent of delay');

  const FUELS = {
    petrol:    { kind: 'ice', density: 0.745, lhv: 43.0, eta: 0.26, idleGps: 0.18, co2PerL: 2.31, noxPerKg: 1.0,  pmPerKg: 0.02 },
    diesel:    { kind: 'ice', density: 0.832, lhv: 42.6, eta: 0.33, idleGps: 0.25, co2PerL: 2.68, noxPerKg: 8.0,  pmPerKg: 0.15 },
    diesel_hd: { kind: 'ice', density: 0.832, lhv: 42.6, eta: 0.36, idleGps: 0.60, co2PerL: 2.68, noxPerKg: 12.0, pmPerKg: 0.25 },
    lpg:       { kind: 'ice', density: 0.540, lhv: 46.0, eta: 0.24, idleGps: 0.15, co2PerL: 1.51, noxPerKg: 1.0,  pmPerKg: 0.01 },
    electric:  { kind: 'ev',  etaMotor: 0.85, regen: 0.60, etaCharge: 0.90, idleKw: 0.3 },
  };
  A('fuel_model', 'wheel-power model', '', 'ASSUMED', 'P_wheel = (m·a + m·g·Cr + ½ρ·CdA·v²)·v; fuel = idle + P⁺/(η·LHV). Not HBEFA4 or PHEMlight');
  A('co2_factors', 'petrol 2.31, diesel 2.68, LPG 1.51', 'kg per L', 'ASSUMED', 'tailpipe only; electricity-production emissions excluded');
  A('nox_factors', 'petrol/LPG 1, diesel car 8, heavy diesel 12', 'g per kg fuel', 'ASSUMED', 'fleet-average real-driving order of magnitude, not emission-class mapped');
  A('pm_factors', 'petrol 0.02, LPG 0.01, diesel 0.15, heavy diesel 0.25', 'g per kg fuel', 'ASSUMED', 'exhaust PM only; brake and tyre wear are not converted to grams');
  A('electricity_boundary', 'purchased kWh at 90% charging efficiency', '', 'ASSUMED', 'battery-side energy divided by charging efficiency; regeneration 60% of negative wheel power');
  A('car_following', 'IDM, s0 2 m, T 1.2 s', '', 'ASSUMED', 'Intelligent Driver Model, no lane changing, single lane');
  A('simulation_step', 0.2, 's', 'ASSUMED', 'Euler integration; replay sampled every 0.5 s');
  A('service_time', 'lognormal, class multiplier', 's', 'ASSUMED', 'mean and CV from the scenario; trucks ×1.8, buses ×1.5, vans ×1.2');
  A('selection', 'independent uniform draw per vehicle', '', 'ASSUMED', 'pre-assigned in the manifest and reused across layouts');
  A('horizon', 'until the queue has been clear for 30 s', '', 'ASSUMED', 'arrivals stop afterwards; the run is flagged incomplete if the queue has not cleared 90 min after the restriction');

  // ---------- context references for the pollution panel ----------
  const CONTEXT = {
    carCo2GPerKm: A('ctx_car_co2', 150, 'g CO2 per km', 'ASSUMED', 'real-world average petrol car, used to express extra CO2 as kilometres driven'),
    householdCo2KgPerDay: A('ctx_household_co2', 3.3, 'kg CO2 per day', 'ASSUMED', 'household electricity, about 220 kWh/month at 0.45 kg CO2 per kWh grid intensity'),
    treeCo2KgPerYear: A('ctx_tree_co2', 22, 'kg CO2 per tree-year', 'ASSUMED', 'commonly quoted uptake of one mature tree; varies widely by species and climate'),
    euro6DieselNoxMgPerKm: A('ctx_euro6_nox', 80, 'mg NOx per km', 'SOURCED', 'Euro 6 diesel passenger-car type-approval limit (Regulation (EC) 715/2007)'),
    olderDieselNoxGPerKm: A('ctx_older_diesel_nox', 0.5, 'g NOx per km', 'ASSUMED', 'real-world order of magnitude for a Euro 4-5 diesel car'),
    euroPmMgPerKm: A('ctx_euro_pm', 4.5, 'mg PM per km', 'SOURCED', 'Euro 5/6 particulate mass limit for passenger cars'),
  };

  // ---------- random streams ----------
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(r) {
    const u = 1 - r(), v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function lognormalFromZ(mean, cv, z) {
    const s2 = Math.log(1 + cv * cv);
    return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * z);
  }

  // ---------- scenario parameters ----------
  function defaultParams() {
    return {
      arrivalRate: 1200,        // veh/h
      selectedFraction: 0.10,
      bays: 3,
      pocket: 2,                // waiting slots before bays
      serviceMean: 60,          // s
      serviceCv: 0.5,
      durationMin: 30,          // restriction active period
      screeningSpeed: 20,       // km/h
      screeningHeadway: 4,      // s per vehicle through the screening point
      overflow: 'block',        // 'block' (hold the through lane) or 'skip' (release unserved)
      heavyShare: 0.07,         // trucks + buses (5:2)
      carFuelMix: { petrol: 0.40, diesel: 0.30, lpg: 0.20, electric: 0.10 },
      seed: 1,
      dt: 0.2,
      maxAfterMin: 90,
      record: true,
      prices: Object.assign({}, PRICES_DEFAULT),
    };
  }

  // ---------- manifest ----------
  function makeVehicle(id, intended, rA, rI, p) {
    const u = rA();
    const h = p.heavyShare;
    let cls;
    if (u < h * 5 / 7) cls = 'truck';
    else if (u < h) cls = 'bus';
    else if (u < h + (1 - h) * 0.08) cls = 'van';
    else cls = 'car';
    const C = CLASSES[cls];
    let fuel;
    if (cls === 'car') {
      const m = p.carFuelMix, f = rA();
      let acc = 0; fuel = 'petrol';
      for (const k of ['petrol', 'diesel', 'lpg', 'electric']) { acc += m[k]; if (f < acc) { fuel = k; break; } }
    } else fuel = C.fuel;
    const vDes = Math.max(40, C.vDes + C.vSd * normal(rA)) / 3.6;
    let occ;
    if (C.occFixed) occ = C.occFixed;
    else {
      const f = rA(); let acc = 0; occ = 1;
      for (let i = 0; i < C.occ.length; i++) { acc += C.occ[i]; if (f < acc) { occ = i + 1; break; } }
    }
    return { id, intended, cls, fuel, vDes, occ, selU: rI(), svcZ: normal(rI) };
  }

  function makeManifest(p) {
    const rArr = rng(p.seed * 1000 + 1), rAttr = rng(p.seed * 1000 + 2), rInsp = rng(p.seed * 1000 + 3);
    const meanH = 3600 / p.arrivalRate, minH = 1.6;
    let t = 0, n = 0;
    const vehicles = [];
    const man = {
      vehicles, frozen: false,
      next() {
        t += n === 0 ? rArr() * meanH : minH + (-Math.log(1 - rArr())) * Math.max(0.1, meanH - minH);
        const v = makeVehicle(n++, t, rAttr, rInsp, p);
        vehicles.push(v);
        return v;
      },
    };
    return man;
  }

  // ---------- car following ----------
  function idm(v, C, v0, gap, dv) {
    const sStar = S0 + Math.max(0, v * T_HEADWAY + v * dv / (2 * Math.sqrt(C.aMax * C.bComf)));
    const free = 1 - Math.pow(v / Math.max(v0, 0.5), 4);
    const inter = gap > 0.1 ? (sStar / gap) * (sStar / gap) : 1e3;
    return C.aMax * (free - inter);
  }

  function serviceSeconds(v, p) {
    return lognormalFromZ(p.serviceMean * v.C.svcMult, p.serviceCv, v.m.svcZ);
  }

  // ---------- one scenario run ----------
  function runScenario(p, manifest, checkpoint) {
    const dt = p.dt, D = p.durationMin * 60;
    const vz = p.screeningSpeed / 3.6, hS = p.screeningHeadway;
    const frameEvery = Math.max(1, Math.round(0.5 / dt));
    const seriesEvery = Math.max(1, Math.round(5 / dt));
    const recFrom = X.gate - 700, recTo = X.rejoin + 200;

    const lane = [];                        // ordered front (largest x) to back
    const bays = [];
    for (let i = 0; i < p.bays; i++) bays.push({ veh: null, state: 'free', tEnd: 0, tStart: 0 });
    const pocket = [], rejoinQ = [];
    const results = new Map(), order = [];
    let reservedPocket = 0;
    let t = 0, step = 0, gateLast = -1e9, pending = 0;
    let canGenerate = !manifest.frozen;
    let clearSince = -1, incomplete = false, queueClearedAt = null, arrivalsClosedAt = null;
    const stats = { intended: 0, entered: 0, completed: 0, remaining: 0, selected: 0, serviced: 0, unserved: 0,
      overflow: 0, pocketUsed: 0, blockedEntries: 0, maxQueue: 0, maxTailM: 0, serviceSeconds: 0, waitSeconds: 0, negativeDelays: 0 };
    const blockedIds = new Set();
    const series = [], frames = [];
    let offLane = 0;                       // vehicles in bays, pocket or waiting to rejoin

    function rt(m) {
      const C = CLASSES[m.cls];
      return { m, id: m.id, C, F: FUELS[m.fuel], len: C.len, mass: C.mass, x: 0, v: 0, a: 0,
        state: 'lane', passed: false, selected: false, unserved: false, reserved: null, bayIdx: -1,
        entry: 0, exit: 0, fuelG: 0, battWh: 0, brakeJ: 0, expS: 0, svcS: 0, waitS: 0, serviced: false };
    }

    function tryEnter(m) {
      const C = CLASSES[m.cls];
      const last = lane[lane.length - 1];
      const v = rt(m);
      if (last) {
        const vEnt = Math.min(m.vDes, last.v + 2);
        const gap = (last.x - last.len) - C.len;
        if (gap < S0 + vEnt * T_HEADWAY) return false;
        v.v = vEnt;
      } else v.v = m.vDes;
      v.x = C.len;
      v.entry = t;
      lane.push(v);
      stats.entered++;
      return true;
    }

    function assignResource(v) {
      for (let i = 0; i < bays.length; i++) {
        if (bays[i].state === 'free') { bays[i].state = 'reserved'; bays[i].veh = v; v.reserved = 'bay'; v.bayIdx = i; return true; }
      }
      if (pocket.length + reservedPocket < p.pocket) { v.reserved = 'pocket'; reservedPocket++; return true; }
      return false;
    }

    function freeBay(i) { bays[i].veh = null; bays[i].state = 'free'; bays[i].tEnd = 0; }

    function startService(i, v) {
      bays[i].veh = v; bays[i].state = 'service'; bays[i].tStart = t;
      bays[i].tEnd = t + serviceSeconds(v, p);
      v.state = 'service'; v.bayIdx = i;
    }

    function energyStep(v, vMean, aAct) {
      const F = v.F, C = v.C;
      const P = (v.mass * aAct + v.mass * G * C.cr + 0.5 * RHO_AIR * C.cdA * vMean * vMean) * vMean;
      if (F.kind === 'ice') {
        v.fuelG += F.idleGps * dt;
        if (P > 0) v.fuelG += P / F.eta / (F.lhv * 1e6) * 1000 * dt;
        else v.brakeJ += -P * dt;
      } else {
        let battW = F.idleKw * 1000;
        if (P > 0) battW += P / F.etaMotor;
        else { battW += P * F.regen; v.brakeJ += -P * (1 - F.regen) * dt; }
        v.battWh += battW * dt / 3600;
      }
    }
    function idleStep(v) {
      if (v.F.kind === 'ice') v.fuelG += v.F.idleGps * dt;
      else v.battWh += v.F.idleKw * 1000 * dt / 3600;
      v.expS += dt;
    }

    function finish(v) {
      const F = v.F;
      const fuelL = F.kind === 'ice' ? v.fuelG / 1000 / F.density : 0;
      const fuelKg = F.kind === 'ice' ? v.fuelG / 1000 : 0;
      results.set(v.id, {
        id: v.id, cls: v.m.cls, fuel: v.m.fuel, occ: v.m.occ,
        intended: v.m.intended, entry: v.entry, exit: v.exit,
        travel: v.exit - v.m.intended, entryDelay: v.entry - v.m.intended,
        fuelL, kwh: F.kind === 'ev' ? Math.max(0, v.battWh) / 1000 / F.etaCharge : 0,
        co2: F.kind === 'ice' ? fuelL * F.co2PerL * 1000 : 0,       // g
        nox: F.kind === 'ice' ? fuelKg * F.noxPerKg : 0,           // g
        pm: F.kind === 'ice' ? fuelKg * F.pmPerKg : 0,             // g
        brakeKJ: v.brakeJ / 1000, expS: v.expS, svcS: v.svcS, waitS: v.waitS,
        selected: v.selected, serviced: v.serviced, unserved: v.unserved,
      });
      order.push(v.id);
      stats.completed++;
    }

    function isClear() {
      if (offLane > 0) return false;
      for (let i = 0; i < lane.length; i++) {
        const v = lane[i];
        if (v.state === 'wait') return false;
        if (v.x < X.rejoin && v.v < 0.5 * v.m.vDes) return false;
      }
      return true;
    }

    const hardCap = D + (p.maxAfterMin + 60) * 60;

    for (;;) {
      const cpOn = checkpoint && t < D;

      // ---- arrivals (manifest order; intended entry preserved, delayed entry logged)
      for (;;) {
        if (pending >= manifest.vehicles.length) {
          if (!canGenerate) break;
          manifest.next();
        }
        const m = manifest.vehicles[pending];
        if (m.intended > t) break;
        if (tryEnter(m)) pending++;
        else { if (!blockedIds.has(m.id)) { blockedIds.add(m.id); stats.blockedEntries++; } break; }
      }

      // ---- accelerations
      const n = lane.length;
      for (let i = 0; i < n; i++) {
        const v = lane[i], C = v.C;
        let v0 = v.m.vDes;
        if (cpOn) {
          if (!v.passed) { if (v.x >= X.zoneStart) v0 = Math.min(v0, vz); }
          else if (v.x < X.zoneEnd) v0 = Math.min(v0, vz);
        }
        if (v.reserved && v.x < X.bayEntry) v0 = Math.min(v0, vz);
        let gap = 1e9, dv = 0;
        if (i > 0) { const L = lane[i - 1]; gap = L.x - L.len - v.x; dv = v.v - L.v; }
        let a = idm(v.v, C, v0, gap, dv);
        if (cpOn && !v.passed && v.x < X.zoneStart && v.v > vz) {
          const d = X.zoneStart - v.x;
          const req = (v.v * v.v - vz * vz) / (2 * d);
          if (req >= C.bComf) a = Math.min(a, -req);
        }
        if (cpOn && !v.passed) {
          // screening point: one vehicle per headway; pace the approach to the opening time
          const tOpen = gateLast + hS - t;
          const d = X.gate - v.x;
          if (tOpen > 0 && d > 0) {
            const vTarget = d / (tOpen + dt);
            if (v.v > vTarget) a = Math.min(a, Math.max(-C.bComf, -(v.v - vTarget) / 1.0));
            // hard stop line only when the vehicle is clearly too fast to be paced
            if (tOpen > 0.6 && v.v > 1.3 * vTarget + 0.5) a = Math.min(a, idm(v.v, C, v0, X.gate + 1.7 - v.x, v.v));
          }
        }
        if (v.state === 'wait') a = Math.min(a, idm(v.v, C, v0, X.bayEntry - v.x, v.v));
        v.a = Math.max(a, -9);
      }

      // ---- integrate, energy, gate crossings, bay entry
      for (let i = 0; i < lane.length; i++) {
        const v = lane[i];
        const vNew = Math.max(0, v.v + v.a * dt);
        const vMean = 0.5 * (v.v + vNew), aAct = (vNew - v.v) / dt;
        v.x += vMean * dt;
        energyStep(v, vMean, aAct);
        v.v = vNew;
        if (v.x >= X.exposureFrom && v.x <= X.rejoin && vMean < 8.33) v.expS += dt;
        if (v.state === 'wait') v.waitS += dt;
        if (!v.passed && v.x >= X.gate) {
          v.passed = true;
          if (cpOn) {
            if (p.debug) (stats.gateCross || (stats.gateCross = [])).push(t);
            gateLast = t;
            if (v.m.selU < p.selectedFraction) {
              v.selected = true; stats.selected++;
              if (!assignResource(v)) {
                stats.overflow++;
                if (p.overflow === 'block') v.state = 'wait';
                else { v.unserved = true; stats.unserved++; }
              }
            }
          }
        }
        if (v.state === 'wait' && v.v < 0.05 && v.x >= X.bayEntry - S0 - 1) {
          if (assignResource(v)) { v.state = 'lane'; }
        }
      }
      // remove vehicles entering a bay or the pocket (iterate backwards for splice safety)
      for (let i = lane.length - 1; i >= 0; i--) {
        const v = lane[i];
        if (v.reserved && v.x >= X.bayEntry - 1) {
          lane.splice(i, 1);
          v.brakeJ += 0.5 * v.mass * v.v * v.v;   // final stop inside the bay
          v.v = 0; v.x = X.bayEntry;
          offLane++;
          if (v.reserved === 'bay') startService(v.bayIdx, v);
          else { pocket.push(v); v.state = 'pocket'; reservedPocket--; stats.pocketUsed++; }
          v.reserved = null;
        }
      }

      // ---- bays, pocket, rejoin
      for (let i = 0; i < bays.length; i++) {
        const b = bays[i];
        if (b.state === 'service' && t >= b.tEnd) {
          b.state = 'rejoin'; b.veh.state = 'rejoin'; b.veh.serviced = true; stats.serviced++;
          stats.serviceSeconds += b.tEnd - b.tStart; b.veh.svcS = b.tEnd - b.tStart;
          rejoinQ.push(b.veh);
        }
        if (b.state === 'free' && pocket.length > 0) startService(i, pocket.shift());
      }
      for (const b of bays) if (b.veh && b.veh.state !== 'lane') idleStep(b.veh);
      for (const v of pocket) idleStep(v);
      if (rejoinQ.length > 0) {
        const v = rejoinQ[0];
        let k = 0;
        while (k < lane.length && lane[k].x >= X.rejoin) k++;
        const leaderOk = k === 0 || (lane[k - 1].x - lane[k - 1].len - X.rejoin) >= S0 + 1;
        let followerOk = true;
        if (k < lane.length) {
          const f = lane[k];
          const need = S0 + f.v * 1.0 + Math.max(0, f.v - 4) * Math.max(0, f.v - 4) / (2 * f.C.bComf);
          followerOk = (X.rejoin - v.len - f.x) >= need;
        }
        if (leaderOk && followerOk) {
          rejoinQ.shift();
          freeBay(v.bayIdx);
          v.bayIdx = -1; v.state = 'lane'; v.x = X.rejoin; v.v = 4;
          lane.splice(k, 0, v);
          offLane--;
        } else v.waitS += dt;
      }

      // ---- exits
      while (lane.length && lane[0].x - lane[0].len > X.length) {
        const v = lane.shift();
        v.exit = t;
        finish(v);
      }

      // ---- queue series and replay frames
      if (step % seriesEvery === 0 || step % frameEvery === 0) {
        let q = 0, tail = Infinity;
        for (let i = 0; i < lane.length; i++) {
          const v = lane[i];
          if (v.x < X.gate && v.v < 0.5 * v.m.vDes) { q++; if (v.x < tail) tail = v.x; }
        }
        if (q > stats.maxQueue) stats.maxQueue = q;
        if (q > 0 && X.gate - tail > stats.maxTailM) stats.maxTailM = X.gate - tail;
        if (step % seriesEvery === 0) series.push({ t, q, tail: q ? tail : null });
        if (p.record && step % frameEvery === 0) {
          const ids = [], xs = [], vs = [], st = [];
          for (let i = 0; i < lane.length; i++) {
            const v = lane[i];
            if (v.x < recFrom || v.x - v.len > recTo) continue;
            ids.push(v.id); xs.push(v.x); vs.push(v.v);
            st.push(v.state === 'wait' ? 2 : (v.selected ? 1 : 0));
          }
          frames.push({
            t, cpOn, q, tail: q ? tail : null,
            ids: Uint16Array.from(ids), xs: Float32Array.from(xs), vs: Float32Array.from(vs), st: Uint8Array.from(st),
            bays: bays.map(b => b.veh ? { id: b.veh.id, state: b.state, remaining: Math.max(0, b.tEnd - t), cls: b.veh.m.cls } : null),
            pocket: pocket.map(v => ({ id: v.id, cls: v.m.cls })),
          });
        }
      }

      t += dt; step++;

      // ---- horizon rules
      if (canGenerate && t >= D + 60) {
        if (step % Math.round(1 / dt) === 0) {
          if (isClear()) { if (clearSince < 0) clearSince = t; }
          else clearSince = -1;
          if (clearSince >= 0 && t - clearSince >= 30) {
            canGenerate = false; manifest.frozen = true; queueClearedAt = clearSince; arrivalsClosedAt = t;
          }
        }
        if (canGenerate && t >= D + p.maxAfterMin * 60) {
          canGenerate = false; manifest.frozen = true; incomplete = true; arrivalsClosedAt = t;
        }
      }
      if (!canGenerate && pending >= manifest.vehicles.length && lane.length === 0 && offLane === 0) break;
      if (t > hardCap) { incomplete = true; break; }
    }

    // unfinished vehicles (only when the hard cap stopped the run)
    stats.remaining = lane.length + offLane + (manifest.vehicles.length - pending);
    stats.intended = manifest.vehicles.length;
    return { results, order, stats, series, frames, incomplete, queueClearedAt, arrivalsClosedAt, tEnd: t, D, checkpoint };
  }

  // ---------- paired accounting ----------
  function percentile(sorted, q) {
    if (!sorted.length) return 0;
    const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  function account(base, cp, p) {
    const pr = p.prices;
    const rows = [];
    const tot = { n: 0, dT: 0, personS: 0, dL: { petrol: 0, diesel: 0, lpg: 0 }, dKwh: 0, dCO2: 0, dNOx: 0, dPM: 0, dBrakeKJ: 0,
      dExpPersonS: 0, negative: 0, selected: 0, serviced: 0, unserved: 0, byClass: {} };
    const dTs = [];
    for (const id of cp.order) {
      const c = cp.results.get(id), b = base.results.get(id);
      if (!b) continue;
      const fuelKey = c.fuel === 'diesel_hd' ? 'diesel' : c.fuel;
      const r = {
        id, cls: c.cls, fuel: fuelKey, occ: c.occ,
        dT: c.travel - b.travel, dL: c.fuelL - b.fuelL, dKwh: c.kwh - b.kwh,
        dCO2: c.co2 - b.co2, dNOx: c.nox - b.nox, dPM: c.pm - b.pm, dBrakeKJ: c.brakeKJ - b.brakeKJ,
        dExpS: c.expS - b.expS, selected: c.selected, serviced: c.serviced, unserved: c.unserved,
      };
      rows.push(r); dTs.push(r.dT);
      tot.n++; tot.dT += r.dT; tot.personS += r.dT * r.occ;
      if (fuelKey in tot.dL) tot.dL[fuelKey] += r.dL;
      tot.dKwh += r.dKwh; tot.dCO2 += r.dCO2; tot.dNOx += r.dNOx; tot.dPM += r.dPM; tot.dBrakeKJ += r.dBrakeKJ;
      tot.dExpPersonS += r.dExpS * r.occ;
      if (r.dT < 0) tot.negative++;
      if (r.selected) tot.selected++;
      if (r.serviced) tot.serviced++;
      if (r.unserved) tot.unserved++;
      const bc = tot.byClass[c.cls] || (tot.byClass[c.cls] = { n: 0, dT: 0 });
      bc.n++; bc.dT += r.dT;
    }
    dTs.sort((a, b) => a - b);
    // the same cohort on the free road, for "simulated vs free-flow" comparison
    const baseTot = { fuelL: 0, kwh: 0, co2: 0, nox: 0, pm: 0, travelS: 0, brakeKJ: 0 };
    for (const id of cp.order) {
      const b = base.results.get(id); if (!b) continue;
      baseTot.fuelL += b.fuelL; baseTot.kwh += b.kwh; baseTot.co2 += b.co2; baseTot.nox += b.nox; baseTot.pm += b.pm; baseTot.travelS += b.travel; baseTot.brakeKJ += b.brakeKJ;
    }
    const pct = (d, b) => (b > 0 ? d / b * 100 : 0);
    const increase = {
      fuel: pct(tot.dL.petrol + tot.dL.diesel + tot.dL.lpg, baseTot.fuelL), co2: pct(tot.dCO2, baseTot.co2), nox: pct(tot.dNOx, baseTot.nox),
      pm: pct(tot.dPM, baseTot.pm), travel: pct(tot.dT, baseTot.travelS), brake: pct(tot.dBrakeKJ, baseTot.brakeKJ), kwh: pct(tot.dKwh, baseTot.kwh),
    };
    const context = {
      carKm: tot.dCO2 / CONTEXT.carCo2GPerKm,
      householdDays: tot.dCO2 / 1000 / CONTEXT.householdCo2KgPerDay,
      treeYears: tot.dCO2 / 1000 / CONTEXT.treeCo2KgPerYear,
      euro6DieselKm: tot.dNOx * 1000 / CONTEXT.euro6DieselNoxMgPerKm,
      olderDieselKm: tot.dNOx / CONTEXT.olderDieselNoxGPerKm,
      euroPmKm: tot.dPM * 1000 / CONTEXT.euroPmMgPerKm,
    };
    const vehicleHours = tot.dT / 3600, personHours = tot.personS / 3600;
    const energyTRY = {
      petrol: tot.dL.petrol * pr.petrol, diesel: tot.dL.diesel * pr.diesel, lpg: tot.dL.lpg * pr.lpg,
      electricity: tot.dKwh * pr.electricity,
    };
    const energyTotalTRY = energyTRY.petrol + energyTRY.diesel + energyTRY.lpg + energyTRY.electricity;
    const timeTRY = personHours * pr.vot;
    const votSensitivity = [100, 200, 400].map(v => ({ vot: v, timeTRY: personHours * v, totalTRY: energyTotalTRY + personHours * v }));
    return {
      rows, tot, vehicleHours, personHours,
      meanDelayS: tot.n ? tot.dT / tot.n : 0, p95DelayS: percentile(dTs, 0.95), maxDelayS: dTs.length ? dTs[dTs.length - 1] : 0,
      minDelayS: dTs.length ? dTs[0] : 0,
      energyTRY, energyTotalTRY, timeTRY, combinedTRY: energyTotalTRY + timeTRY,
      fx: pr.fx, votSensitivity,
      exposurePersonHours: tot.dExpPersonS / 3600, baseTot, increase, context,
      perVehicleTRY: tot.n ? (energyTotalTRY + timeTRY) / tot.n : 0,
      bayUtilisation: cp.stats.serviceSeconds / Math.max(1, p.bays * cp.D),
    };
  }

  function runPaired(p) {
    const manifest = makeManifest(p);
    const cp = runScenario(p, manifest, true);
    const base = runScenario(p, manifest, false);
    const acc = account(base, cp, p);
    return { p, manifest: { vehicles: manifest.vehicles }, cp, base, acc };
  }

  // ---------- exports ----------
  function pairedCsv(acc) {
    const head = ['vehicle_id', 'class', 'fuel_type', 'occupancy', 'delta_time_s', 'delta_fuel_L', 'delta_grid_kWh',
      'delta_CO2_g', 'delta_NOx_g', 'delta_PM_exhaust_g', 'delta_friction_energy_kJ', 'selected', 'inspected', 'unserved'];
    const lines = [head.join(',')];
    for (const r of acc.rows) {
      lines.push([r.id, r.cls, r.fuel, r.occ, r.dT.toFixed(2), r.dL.toFixed(5), r.dKwh.toFixed(5), r.dCO2.toFixed(2),
        r.dNOx.toFixed(4), r.dPM.toFixed(5), r.dBrakeKJ.toFixed(2), r.selected ? 1 : 0, r.serviced ? 1 : 0, r.unserved ? 1 : 0].join(','));
    }
    return lines.join('\n');
  }
  function assumptionsCsv(p) {
    const rows = ASSUMPTIONS.map(a => Object.assign({}, a));
    const live = {
      fx_try_per_usd: p.prices.fx, price_petrol: p.prices.petrol, price_diesel: p.prices.diesel,
      price_lpg: p.prices.lpg, price_electricity: p.prices.electricity, value_of_time: p.prices.vot,
    };
    for (const r of rows) if (r.key in live) r.value = live[r.key];
    const scen = [
      ['arrival_rate', p.arrivalRate, 'veh/h'], ['selected_fraction', p.selectedFraction, ''], ['inspection_bays', p.bays, ''],
      ['waiting_pocket', p.pocket, 'slots'], ['service_mean', p.serviceMean, 's'], ['service_cv', p.serviceCv, ''],
      ['restriction_duration', p.durationMin, 'min'], ['screening_speed', p.screeningSpeed, 'km/h'],
      ['screening_headway', p.screeningHeadway, 's'], ['overflow_policy', p.overflow, ''], ['heavy_share', p.heavyShare, ''],
      ['car_fuel_mix', `petrol ${p.carFuelMix.petrol} diesel ${p.carFuelMix.diesel} lpg ${p.carFuelMix.lpg} electric ${p.carFuelMix.electric}`, ''],
      ['seed', p.seed, ''],
    ];
    for (const s of scen) rows.push({ key: s[0], value: s[1], unit: s[2], status: 'ASSUMED', note: 'scenario input' });
    const esc = v => `"${String(v).replace(/"/g, '""')}"`;
    return ['key,value,unit,status,note'].concat(rows.map(r => [r.key, r.value, r.unit, r.status, r.note].map(esc).join(','))).join('\n');
  }

  const api = { ASSUMPTIONS, PRICES_DEFAULT, CONTEXT, CORRIDOR: X, CLASSES, FUELS, defaultParams, makeManifest, runScenario, account, runPaired, pairedCsv, assumptionsCsv, rng, normal, lognormalFromZ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CheckpointLab = api;
})(typeof self !== 'undefined' ? self : globalThis);
