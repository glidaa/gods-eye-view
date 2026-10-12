import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GEV_ACTION_SCHEMAS, createActionTools } from './actionSchemas.js';
import { GEV_REALTIME_TOOLS } from '../../server/providers/openai/tools.js';

const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, stable(child)]),
        )
      : value;

test('the complete Realtime tool payload pins the additive analyst and satellite release', () => {
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(GEV_REALTIME_TOOLS)))
    .digest('hex');
  assert.equal(
    digest,
    'f122522309bbbb1f589e5f15a7a73254092ee843a5df103e87399b50daca9526',
  );
});

test('descriptions customize wording without changing immutable shared arguments', () => {
  const descriptions = {
    fly_to_location: {
      description: 'Navigate',
      parameters: { properties: { query: { description: 'A place' } } },
    },
  };
  const tools = createActionTools(descriptions);
  const tool = tools.find((tool) => tool.name === 'fly_to_location');
  assert.equal(tool.description, 'Navigate');
  assert.equal(tool.parameters.properties.query.description, 'A place');
  assert.equal(tool.parameters.properties.query.type, 'string');
  tool.parameters.properties.query.type = 'number';
  assert.equal(
    createActionTools()[0].parameters.properties.query.type,
    'string',
  );
  assert.throws(() => {
    GEV_ACTION_SCHEMAS[0].parameters.properties.query.type = 'number';
  }, TypeError);
  assert.equal(
    JSON.stringify(GEV_ACTION_SCHEMAS).includes('"description"'),
    false,
  );
});

test('metadata cannot add tools, fields, types or enum values', () => {
  for (const descriptions of [
    { execute_shell: { description: 'not an action' } },
    {
      fly_to_location: {
        parameters: { properties: { description: 'new field' } },
      },
    },
    { fly_to_location: { $position: -1, description: 'invalid position' } },
    { fly_to_location: { name: 'other' } },
    {
      fly_to_location: {
        parameters: { properties: { arbitrary: { description: 'new field' } } },
      },
    },
    {
      fly_to_location: {
        parameters: { properties: { query: { type: 'number' } } },
      },
    },
    { fly_to_location: { parameters: { required: { 0: 'another' } } } },
    { fly_to_location: { description: { nested: 'invalid' } } },
  ])
    assert.throws(() => createActionTools(descriptions), TypeError);
});

test('all legacy action arguments are byte-identical after removing the deliberate additions', () => {
  const legacy = structuredClone(GEV_ACTION_SCHEMAS).filter(
    (tool) => tool.name !== 'next_satellite_pass',
  );
  const layers = legacy.find((tool) => tool.name === 'analyst_query').parameters
    .properties.layers.items;
  layers.enum = layers.enum.filter(
    (key) => !['satellites', 'local-datacenters', 'local-dams'].includes(key),
  );
  // Australia energy/industry layers: enum-only additions across the layer
  // enums (visibility, menu, entity context, analyst). Strip them from every
  // enum so the hash below still proves nothing else moved.
  const auAdditions = new Set([
    'local-au-ports',
    'local-au-mines',
    'local-au-power',
    'aus-energy-grid',
    'nem-generation',
  ]);
  const stripAdditions = (node) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (typeof node[i] === 'string' && auAdditions.has(node[i])) {
          node.splice(i, 1);
        } else {
          stripAdditions(node[i]);
        }
      }
    } else if (node && typeof node === 'object') {
      for (const value of Object.values(node)) stripAdditions(value);
    }
  };
  stripAdditions(legacy);
  // Google removal: 'photoreal' was deliberately deleted from the
  // set_map_stack enum. Restore it at its original head position so the hash
  // below still proves nothing else moved.
  legacy
    .find((tool) => tool.name === 'set_map_stack')
    .parameters.properties.stack.enum.unshift('photoreal');
  // Independently derived by executing trusted c9f9896 actionSchemas in the restricted container.
  assert.equal(
    createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),
    '820fff21658f6907e1010b2b79c5431a77f4e34afd2277d62d8de46c368b6f8c',
  );
});
