# Australian Operating Mines

Operating mines, mines under development, and mines under care and
maintenance, for the `local-au-mines` layer (539 points).

Source: Geoscience Australia, Australian Operating Mines Map 2025,
spreadsheet downloaded 2026-10-06:

    https://d28rz98at9flks.cloudfront.net/150821/150821_01_0.xlsx

Dataset record: https://data.gov.au — "Australian Operating Mines Map 2025".
Live WFS for refreshes:
http://services.ga.gov.au/gis/services/AustralianOperatingMines/MapServer/WFSServer

Columns kept: Name, State, Latitude, Longitude, Status, Commodity Group
(plus a short `commodity` head before " - "). All 539 rows carry coordinates.
Status spelling normalised (`Developing Mine` → `Developing mine`);
coordinates rounded to 6 decimals.

Enrichment (computed at conversion, haversine over the bundled snapshots):
`nearestPort` / `nearestPortKm` against `../au_ports`, and `nearestLanding` /
`nearestLandingKm` against the 27 Australian points in
`../telegeography_submarine_cables/landing-point-geo.json`.

License: Creative Commons Attribution 4.0 International (CC BY 4.0),
© Commonwealth of Australia (Geoscience Australia)
(see https://www.ga.gov.au/copyright). Keep the attribution in
DATA_SOURCES.md and the in-app Data attribution popover when redistributing.
Commercial use permitted with attribution.
