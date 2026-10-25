/* CHECKPOINT LAB — analytical benchmarks from the handout.
   These are deterministic teaching calculations used as acceptance tests
   for the accounting code. They are not simulation results. */
(function (root) {
  'use strict';

  /** Synthetic benchmark A: deterministic point queue.
   *  Constant arrivals, reduced capacity for `restrictedMin`, then recovery capacity. */
  function pointQueue(arrivalPerH, restrictedCapPerH, restrictedMin, recoveryCapPerH) {
    const growth = (arrivalPerH - restrictedCapPerH) / 60;      // veh per minute
    const qMax = Math.max(0, growth * restrictedMin);
    const net = (recoveryCapPerH - arrivalPerH) / 60;           // veh per minute
    const clearMin = net > 0 ? qMax / net : Infinity;
    const vehMinutes = 0.5 * qMax * restrictedMin + (isFinite(clearMin) ? 0.5 * qMax * clearMin : Infinity);
    const affected = arrivalPerH / 60 * (restrictedMin + clearMin);
    return {
      qMax,
      clearsAtMin: restrictedMin + clearMin,
      vehicleHours: vehMinutes / 60,
      affectedVehicles: affected,
      meanDelayMin: vehMinutes / affected,
    };
  }

  /** Synthetic benchmark B: one vehicle, same corridor, slowdown vs constant speed. */
  function kinematicSlowdown(o) {
    const c = Object.assign({ distance: 2000, v0: 90, approach: 600, vz: 20, zoneLen: 100, decel: 2, accel: 1.5 }, o);
    const v0 = c.v0 / 3.6, vz = c.vz / 3.6;
    const tDec = (v0 - vz) / c.decel, dDec = (v0 * v0 - vz * vz) / (2 * c.decel);
    const tAcc = (v0 - vz) / c.accel, dAcc = (v0 * v0 - vz * vz) / (2 * c.accel);
    const tZone = c.zoneLen / vz;
    const remaining = c.distance - c.approach - dDec - c.zoneLen - dAcc;
    const slowdownS = c.approach / v0 + tDec + tZone + tAcc + remaining / v0;
    const baselineS = c.distance / v0;
    return { baselineS, slowdownS, additionalS: slowdownS - baselineS, tDec, dDec, tAcc, dAcc };
  }

  /** Emission-unit check: integrate a constant per-second rate with a given step. */
  function integrateRate(ratePerS, dt, horizonS) {
    let total = 0;
    const n = Math.round(horizonS / dt);
    for (let i = 0; i < n; i++) total += ratePerS * dt;
    return total;
  }

  /** Lognormal parameters from mean and coefficient of variation (time in seconds). */
  function lognormalParams(mean, cv) {
    const sigma2 = Math.log(1 + cv * cv);
    return { mu: Math.log(mean) - sigma2 / 2, sigma: Math.sqrt(sigma2) };
  }

  /** Kinetic-energy loss of a mass slowing from v1 to v2 (km/h), joules. */
  function kineticLoss(massKg, v1Kmh, v2Kmh) {
    const a = v1Kmh / 3.6, b = v2Kmh / 3.6;
    return 0.5 * massKg * (a * a - b * b);
  }

  const api = { pointQueue, kinematicSlowdown, integrateRate, lognormalParams, kineticLoss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Benchmarks = api;
})(typeof self !== 'undefined' ? self : globalThis);
