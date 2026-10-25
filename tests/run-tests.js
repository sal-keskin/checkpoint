/* CHECKPOINT LAB acceptance tests. Run: node tests/run-tests.js */
const B = require('../js/benchmarks.js');
const M = require('../js/model.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('Analytical benchmarks');
const qa = B.pointQueue(1200, 900, 30, 1800);
check('queue benchmark A: 150 vehicles queued', near(qa.qMax, 150, 1e-9), qa.qMax.toFixed(2));
check('queue benchmark A: clears at 45 min', near(qa.clearsAtMin, 45, 1e-9), qa.clearsAtMin.toFixed(2));
check('queue benchmark A: 56.25 vehicle-hours', near(qa.vehicleHours, 56.25, 1e-9), qa.vehicleHours.toFixed(4));
check('queue benchmark A: mean delay 3.75 min', near(qa.meanDelayMin, 3.75, 1e-9), qa.meanDelayMin.toFixed(4));
const kb = B.kinematicSlowdown();
check('kinematic benchmark B: baseline 80.00 s', near(kb.baselineS, 80.00, 0.005), kb.baselineS.toFixed(2));
check('kinematic benchmark B: slowdown 102.82 s', near(kb.slowdownS, 102.82, 0.005), kb.slowdownS.toFixed(2));
check('kinematic benchmark B: deceleration distance 148.53 m', near(kb.dDec, 148.53, 0.01), kb.dDec.toFixed(2));
check('kinematic benchmark B: recovery distance 198.05 m', near(kb.dAcc, 198.05, 0.01), kb.dAcc.toFixed(2));
const e1 = B.integrateRate(12.5, 1.0, 600), e2 = B.integrateRate(12.5, 0.2, 600);
check('emission units: constant rate integrates equally at 1.0 s and 0.2 s', near(e1, 7500, 1e-6) && near(e2, 7500, 1e-6), `${e1.toFixed(3)} / ${e2.toFixed(3)} mg`);
const ln = B.lognormalParams(60, 0.5);
check('lognormal parameters: mean 60 s, CV 0.5', near(Math.exp(ln.mu + ln.sigma * ln.sigma / 2), 60, 1e-9), `mu ${ln.mu.toFixed(4)} sigma ${ln.sigma.toFixed(4)}`);
check('kinetic loss 1500 kg, 90 to 20 km/h = 445.60 kJ', near(B.kineticLoss(1500, 90, 20) / 1000, 445.60, 0.01), (B.kineticLoss(1500, 90, 20) / 1000).toFixed(2));

console.log('Model runs');
const p = M.defaultParams(); p.record = false;
const t0 = Date.now();
const r = M.runPaired(p);
console.log(`  (paired default run: ${Date.now() - t0} ms, ${r.acc.tot.n} vehicles)`);
const cs = r.cp.stats, bs = r.base.stats;
check('vehicle conservation (checkpoint): intended = entered = completed, none remaining',
  cs.intended === cs.entered && cs.entered === cs.completed && cs.remaining === 0, `${cs.intended}/${cs.entered}/${cs.completed}/${cs.remaining}`);
check('vehicle conservation (baseline)', bs.intended === bs.entered && bs.entered === bs.completed && bs.remaining === 0, `${bs.intended}/${bs.entered}/${bs.completed}/${bs.remaining}`);
check('paired matching: same manifest ids in both runs',
  r.cp.order.length === r.base.order.length && r.cp.order.every(id => r.base.results.has(id)), `${r.cp.order.length} ids`);
check('run complete: queue cleared inside the horizon', !r.cp.incomplete && r.cp.queueClearedAt !== null, `cleared at ${(r.cp.queueClearedAt / 60).toFixed(1)} min`);
check('queue magnitude near point-queue benchmark (120-190 vehicles)', cs.maxQueue >= 120 && cs.maxQueue <= 190, `${cs.maxQueue}`);
check('inspections counted: selected = serviced + unserved', cs.selected === cs.serviced + cs.unserved, `${cs.selected} = ${cs.serviced} + ${cs.unserved}`);
check('complete delay includes dwell: every inspected vehicle delayed more than its service time',
  r.acc.rows.filter(x => x.serviced).every(x => x.dT > r.cp.results.get(x.id).svcS), '');
check('negative differences are preserved, not clipped', r.acc.minDelayS <= 0 || r.acc.tot.negative === 0, `min dT ${r.acc.minDelayS.toFixed(2)} s`);
check('mixed units kept separate: litres by fuel, kWh for electric', 'petrol' in r.acc.tot.dL && typeof r.acc.tot.dKwh === 'number', '');

// null intervention
const p0 = M.defaultParams(); p0.record = false; p0.durationMin = 0; p0.selectedFraction = 0;
const r0 = M.runPaired(p0);
check('null intervention: negligible paired differences', Math.abs(r0.acc.maxDelayS) < 0.5 && Math.abs(r0.acc.minDelayS) < 0.5 && Math.abs(r0.acc.tot.dCO2) < 1,
  `max |dT| ${Math.max(Math.abs(r0.acc.maxDelayS), Math.abs(r0.acc.minDelayS)).toFixed(3)} s, dCO2 ${r0.acc.tot.dCO2.toFixed(3)} g`);

// single vehicle slowdown through the screening zone (no queue, no selection)
const p1 = M.defaultParams(); p1.record = false; p1.arrivalRate = 60; p1.selectedFraction = 0; p1.durationMin = 6; p1.maxAfterMin = 5;
const r1 = M.runPaired(p1);
const firstRow = r1.acc.rows[0];
check('single-vehicle slowdown: additional time in the same order as benchmark B (15-45 s)', firstRow.dT > 15 && firstRow.dT < 45, `${firstRow.dT.toFixed(1)} s`);
check('single-vehicle slowdown: extra fuel small and positive', firstRow.dL > 0 && firstRow.dL < 0.1, `${(firstRow.dL * 1000).toFixed(1)} mL`);

// overflow policy comparison
const pb = M.defaultParams(); pb.record = false; pb.bays = 1; pb.pocket = 0; pb.selectedFraction = 0.2; pb.overflow = 'block';
const ps = Object.assign({}, pb, { overflow: 'skip' });
const rb = M.runPaired(pb), rs = M.runPaired(ps);
check('overflow policy: skip releases unserved selections, block does not', rs.cp.stats.unserved > 0 && rb.cp.stats.unserved === 0, `skip ${rs.cp.stats.unserved} unserved, block ${rb.cp.stats.overflow} overflow events`);

// step convergence (coarse check)
const pc = M.defaultParams(); pc.record = false; pc.dt = 0.1;
const rc = M.runPaired(pc);
const rel = Math.abs(rc.acc.vehicleHours - r.acc.vehicleHours) / r.acc.vehicleHours;
check('step convergence: vehicle-hours within 15% at dt 0.1 s', rel < 0.15, `${r.acc.vehicleHours.toFixed(1)} vs ${rc.acc.vehicleHours.toFixed(1)} veh-h`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
