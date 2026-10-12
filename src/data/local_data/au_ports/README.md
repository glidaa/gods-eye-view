# Australian Resources Export Ports

Seaports shipping mineral and energy commodities from Australia, for the
`local-au-ports` layer (75 points).

Source: Geoscience Australia, Resources Export Ports (MaritimePorts layer),
queried 2026-10-06 as GeoJSON from the public MapServer:

    https://services.ga.gov.au/gis/rest/services/ResourcesExportPorts/MapServer/1/query
    ?where=1%3D1&outFields=*&returnGeometry=true&f=geojson

Dataset record (GIS download + WMS/WFS):
https://data.gov.au — "Resources Export Ports GIS dataset".

GA's own service description: "location information and details about
commodities exported from shipping ports around Australia ... collated by
Geoscience Australia from publicly available information as a guide only."

Fields kept per port: name, state, commodities (free-text list), operational
(all 75 report Operational). Coordinates rounded to 6 decimals.

License: Creative Commons Attribution 4.0 International (CC BY 4.0),
© Commonwealth of Australia (Geoscience Australia). Keep the attribution in
DATA_SOURCES.md and the in-app Data attribution popover when redistributing.
Commercial use permitted with attribution.
