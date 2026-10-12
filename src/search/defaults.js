import { createNominatimProvider } from './nominatim.js';
import { createGeospatialServices } from './geospatial.js';
import { createHttpGeospatialProvider } from './http.js';
import { createPlaceSearch } from './placeSearch.js';
import { createGoogleGeocoder } from './google.js';
import { createPhotonGeocoder } from '../keylessGeocoder.js';
import { createCoordinateGeocoder } from './coordinateGeocoder.js';
import { createPresetGeocoder } from './presetGeocoder.js';

/**
 * Coordinates and bundled names first — both answer offline and with no key —
 * then keyless Photon, then the local Nominatim route as a last resort.
 * Transport stays local to setup.
 *
 * `presets` is the caller's bundled place data. It is passed in rather than
 * imported so this package keeps reading no application state; with none
 * supplied there is simply no bundled-name provider.
 */
export function createDefaultPlaceSearch({
  fetchImpl = (...args) => fetch(...args),
  signal,
  endpoints = {},
  providers = {},
  presets = null,
  geocoding = null,
} = {}) {
  if (geocoding && geocoding.provider !== 'nominatim')
    throw new TypeError('Unsupported geocoding provider');
  const selected = geocoding
    ? createNominatimProvider({ ...geocoding, fetchImpl })
    : null;
  if (selected && !selected.geocode)
    throw new TypeError('Nominatim searchEndpoint is required');
  const forward = createPlaceSearch({
    signal,
    providers: providers.geocode || [
      createCoordinateGeocoder(),
      ...(presets ? [createPresetGeocoder({ presets })] : []),
      ...(selected
        ? [selected]
        : [
            createPhotonGeocoder({ fetchImpl, endpoint: endpoints.photon }),
            // Last resort: the local Nominatim route, which answers with no key when
            // Photon did not. It speaks the Google result shape, so it rides the
            // existing adapter rather than needing its own.
            createGoogleGeocoder({
              request(query, { bias, signal }) {
                const params = new URLSearchParams({ q: query });
                if (bias) params.set('bounds', bias);
                return fetchImpl(
                  `${endpoints.nominatim || '/api/geocode'}?${params}`,
                  {
                    signal,
                  },
                );
              },
            }),
          ]),
    ],
  });
  const operations = createHttpGeospatialProvider({
    fetchImpl,
    endpoints,
  });
  return {
    ...forward,
    ...createGeospatialServices({
      signal,
      providers: {
        ...operations,
        ...(selected
          ? {
              reverseGeocode: selected.reverseGeocode,
              attribution: {
                ...operations.attribution,
                ...selected.attribution,
              },
            }
          : {}),
        ...providers,
      },
    }),
  };
}

// Compatibility for direct module callers. Application composition supplies its own instance.
export const defaultGeospatial = createDefaultPlaceSearch();
