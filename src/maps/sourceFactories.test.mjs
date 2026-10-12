import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createIonImagery } from './imagery.js';
import { createWorldTerrain, createKeylessTerrain } from './terrain.js';
import { createDefaultMapSources } from './defaultSources.js';

test('Esri uses Re:Earth without keys and preserves ion terrain when configured', async () => {
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const originalResource = Cesium.IonResource.fromAssetId;
  const calls = [];
  try {
    Cesium.CesiumTerrainProvider.fromUrl = async (resource) => {
      calls.push(resource);
      return { resource };
    };
    Cesium.IonResource.fromAssetId = async () =>
      assert.fail('keyless mode must not acquire ion terrain');
    const keyless = createDefaultMapSources();
    const esri = keyless.sources.find(
      ({ descriptor }) => descriptor.id === 'esri-imagery',
    );
    assert.equal(esri.available, true);
    assert.equal(esri.terrain.id, 'keyless');
    assert.equal(esri.terrain.create, createKeylessTerrain);
    await esri.terrain.create();
    assert.deepEqual(calls, [
      'https://terrain.reearth.land/cesium-mesh/ellipsoid',
    ]);
    assert.equal(keyless.defaultId, 'esri-imagery');
    assert.equal(keyless.unknownId, 'esri-imagery');
    assert.ok(
      keyless.sources.every(({ descriptor }) => descriptor.id !== 'photoreal'),
      'no Google stack is offered',
    );
    const keyed = createDefaultMapSources({ cesiumToken: 'test-token' });
    assert.equal(
      keyed.sources.find(({ descriptor }) => descriptor.id === 'esri-imagery')
        .terrain.id,
      'world',
    );
    assert.equal(keyed.defaultId, 'esri-imagery');
  } finally {
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
    Cesium.IonResource.fromAssetId = originalResource;
  }
});

test('imagery and terrain pass their own ion token without relying on SDK defaults', async () => {
  const originalImagery = Cesium.IonImageryProvider.fromAssetId;
  const originalResource = Cesium.IonResource.fromAssetId;
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const calls = [];
  const defaultToken = Cesium.Ion.defaultAccessToken;
  try {
    Cesium.IonImageryProvider.fromAssetId = async (id, options) => {
      calls.push({ kind: 'imagery', id, options });
      return { id };
    };
    Cesium.IonResource.fromAssetId = async (id, options) => {
      calls.push({ kind: 'resource', id, options });
      return { id };
    };
    Cesium.CesiumTerrainProvider.fromUrl = async (resource, options) => {
      calls.push({ kind: 'terrain', resource, options });
      return { id: 'terrain' };
    };
    await createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, 'imagery-token');
    const result = await createWorldTerrain('terrain-token');
    assert.equal(calls[0].options.accessToken, 'imagery-token');
    assert.equal(calls[1].options.accessToken, 'terrain-token');
    assert.equal(calls[1].id, 1);
    assert.equal(calls[2].options.requestVertexNormals, true);
    assert.equal(result.provider.id, 'terrain');
    assert.equal(Cesium.Ion.defaultAccessToken, defaultToken);
  } finally {
    Cesium.IonImageryProvider.fromAssetId = originalImagery;
    Cesium.IonResource.fromAssetId = originalResource;
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
  }
});

test('cancellation after ion metadata prevents terrain construction', async () => {
  const originalResource = Cesium.IonResource.fromAssetId;
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const controller = new AbortController();
  try {
    Cesium.IonResource.fromAssetId = async () => {
      controller.abort();
      return {};
    };
    Cesium.CesiumTerrainProvider.fromUrl = () =>
      assert.fail('cancelled terrain construction');
    await assert.rejects(
      createWorldTerrain('test-token', { signal: controller.signal }),
      { name: 'AbortError' },
    );
  } finally {
    Cesium.IonResource.fromAssetId = originalResource;
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
  }
});

test('the satellite stack carries no on-screen static credit; the provider keeps full Esri attribution', async () => {
  const originalFromUrl = Cesium.ArcGisMapServerImageryProvider.fromUrl;
  const seen = [];
  try {
    Cesium.ArcGisMapServerImageryProvider.fromUrl = (url, options) => {
      seen.push({ url, options });
      return { url, options };
    };
    const sources = createDefaultMapSources();
    const esri = sources.sources.find(
      ({ descriptor }) => descriptor.id === 'esri-imagery',
    );
    assert.equal(esri.descriptor.label, 'Satellite');
    assert.ok(!('credit' in esri), 'no on-screen static credit for Esri');
    assert.ok(
      sources.sources.every((source) => !('credit' in source)),
      'every stack attributes via its provider lightbox entry',
    );
    await esri.imagery();
    assert.equal(seen.length, 1);
    assert.match(
      String(seen[0].options.credit),
      /Powered by Esri/,
      'the provider credit line stays complete on record',
    );
    assert.match(
      String(seen[0].options.credit),
      /Maxar.*Earthstar Geographics.*GIS User Community/,
      'all upstream imagery contributors stay credited',
    );
  } finally {
    Cesium.ArcGisMapServerImageryProvider.fromUrl = originalFromUrl;
  }
});

test('credentialed source factories reject an omitted token instead of consuming an SDK default', async () => {
  assert.throws(
    () => createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, ''),
    /explicit token/,
  );
  await assert.rejects(createWorldTerrain(' '), /explicit ion token/);
});
