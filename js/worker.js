/* CHECKPOINT LAB — background runner so the page stays responsive. */
importScripts('model.js');
self.onmessage = function (e) {
  const { id, params, summary } = e.data;
  try {
    const r = CheckpointLab.runPaired(params);
    if (summary) {
      self.postMessage({ id, ok: true, summary: { cost: r.acc.combinedTRY, co2: r.acc.tot.dCO2, vehicleHours: r.acc.vehicleHours, incomplete: r.cp.incomplete } });
    } else {
      self.postMessage({ id, ok: true, result: r });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
