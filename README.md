# CHECKPOINT LAB

A browser simulator of the transport, cost and air-pollution burden of a roadside
checkpoint, built for a public-health audience. The same frozen vehicle list is run
twice, once on a free road and once through a checkpoint, and every number shown is
a paired difference between the two runs.

Open `index.html` in a browser. No build step, no server, no external libraries.

## What it shows

- **Scenario sentence**: every parameter is a chip inside one sentence. A chip opens
  a short list of predefined, literature-informed options (each with its source note
  and the simulated cost and CO₂ it would give, computed in the background), plus a
  stepper for any other value. Six preset buttons set whole scenarios.
- **Cost** (₺ and US$): extra fuel and electricity priced at dated retail prices,
  and valued travel time at a stated value of time. The two are kept separate, as the
  handout requires: fuel is an expenditure, valued time is a valuation.
- **Pollution**: extra tailpipe CO₂, NOₓ and exhaust PM with their percentage
  increase over the same vehicles on a free road, extra fuel by type, friction-braking
  energy (a wear indicator, no wear mass is invented), extra person-hours in slow
  traffic near the checkpoint, and an "in context" list that expresses the extras as
  kilometres driven, household electricity days, tree-years and Euro-limit distances.
- **Paired replay**: an elevated orthographic scene of the baseline road and the
  checkpoint road for the same vehicles, with screening zone, gantry, bays, waiting
  pocket, selected vehicles and queue tail. It plays continuously and keeps playing
  after every parameter change. The corridor minimap shows the full queue extent.
- **Queue over time**, a results strip and run-integrity flags.
- **Assumptions table** with evidence labels (SOURCED / ASSUMED / SIMULATED) and
  CSV exports of the assumptions and the per-vehicle paired results.

The model runs in a Web Worker when the page is served over HTTP (or hosted); opened
from a local file it falls back to running on the main thread.

## Model

`js/model.js` is a single-lane vehicle-level model, not SUMO. It is deliberately
small so that every mechanism is readable.

- Arrivals: shifted-exponential headways from a seeded stream. Vehicle class, fuel,
  desired speed, occupancy, selection draw and service-time draw come from two
  further independent streams and are frozen in a manifest shared by both runs.
- Car following: Intelligent Driver Model, class-specific acceleration limits.
- Checkpoint as a process: reduced-speed screening zone, a screening point that
  passes one vehicle per screening headway, independent selection, finite inspection
  bays with lognormal service, a finite waiting pocket, and an explicit overflow
  policy (hold the through lane, or release unserved). A bay is held until the
  inspected vehicle has merged back; merging uses a gap-acceptance rule.
- Horizon: arrivals continue until the queue has been clear for 30 s after the
  restriction ends. If the queue has not cleared 90 minutes after the restriction,
  the run is flagged INCOMPLETE on the page.
- Energy: wheel power from mass, rolling resistance and aerodynamic drag; fuel from
  an idle rate plus positive wheel power over a drivetrain efficiency and the fuel's
  heating value; electric vehicles with regeneration and a charging-efficiency
  boundary. CO₂, NOₓ and PM are per-litre or per-kilogram factors. All factors are
  labelled ASSUMED and listed in the assumptions table.
- Negative differences are reported, not clipped.

## Tests

```
node tests/run-tests.js
```

The tests reproduce the handout's analytical benchmarks (point queue: 150 vehicles,
56.25 vehicle-hours; kinematic slowdown: 80.00 s and 102.82 s; emission-unit
integration at 1.0 s and 0.2 s steps) and check the model for vehicle conservation,
paired matching, a null intervention, complete delay including inspection dwell,
overflow-policy behaviour and step convergence.

## Status

This is a development prototype with uncalibrated starter values. Prices and the
exchange rate are dated references from the handout (Petrol Ofisi Ankara, 25 Oct
2026; TCMB via e-Devlet, 23 Oct 2026). Electricity price and value of time are
assumptions. No measured checkpoint effect is asserted, and the comparison says
nothing about enforcement effectiveness.

## Files

```
index.html          page
css/style.css       tokens and layout (handout palette: paper, ink, blue, orange, yellow, green, grey)
js/model.js         manifest, traffic model, energy and emission accounting, exports
js/benchmarks.js    analytical benchmarks used as acceptance tests
js/app.js           scenario chips, presets, panels, elevated replay, chart
js/worker.js        background runner for the paired model
tests/run-tests.js  acceptance tests (node)
```
