# Australian Power Stations

Mapped power stations (coal, gas, hydro, solar, wind, batteries, ...), for
the `local-au-power` layer (848 points).

Source: OpenStreetMap, extracted 2026-10-06 via the Overpass API
(kumi mirror) with:

    [out:json][timeout:240];
    (node["power"="plant"](-44,113,-10,154);
     way["power"="plant"](-44,113,-10,154);
     relation["power"="plant"](-44,113,-10,154););
    out center tags;

Ways/relations use the Overpass `center` point. Full OSM tags are kept under
`tags`; derived fields:

- `fuel`: canonical fuel from `plant:source` (first of `;`-separated values):
  coal, gas, solar, wind, hydro, battery, oil (diesel/oil), bioenergy
  (biogas/biofuel/biomass/waste), geothermal, other, unknown. Raw value kept
  as `fuelRaw`.
- `capacityMw`: numeric megawatts parsed from `plant:output:electricity`
  ("2.88 GW", "140 MW", "330 kW"; bare numbers read as MW; `yes` and
  non-numeric values → null, 552 of 848 populated). Raw value kept as
  `output`.
- `operator`: OSM `operator` tag (445 of 848 tagged).

Enrichment (computed at conversion, haversine over the bundled snapshots):
`nearestPort` / `nearestPortKm` against `../au_ports`, and `nearestLanding` /
`nearestLandingKm` against the 27 Australian points in
`../telegeography_submarine_cables/landing-point-geo.json`.

Coverage is whatever contributors mapped in OSM — incomplete by nature, and
separate from AEMO's authoritative generator register. Coordinates rounded
to 6 decimals.

License: Open Database License (ODbL) 1.0. Keep the OpenStreetMap
contributor attribution when redistributing this derived database.
Commercial use permitted with attribution and share-alike on the data.
