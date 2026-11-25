import assert from 'node:assert/strict'
import test from 'node:test'

import * as schemas from '../lib/tool-schemas.js'

test('all model-facing tool schemas are closed object schemas', () => {
  for (const [name, schema] of Object.entries(schemas)) {
    if (name === 'TEXT_OUTPUT') continue
    assert.equal(schema.type, 'object', name)
    assert.equal(schema.additionalProperties, false, name)
    if (schema.required !== undefined) assert.ok(Array.isArray(schema.required), name)
  }
})
