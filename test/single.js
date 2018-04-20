const rollup = require('rollup');
const jspmRollup = require('../jspm-rollup');
const path = require('path');
const assert = require('assert');

suite('Basic Rollup', () => {
  const basePath = path.resolve('test/fixtures/basic');

  test('Test', async () => {
    const bundle = await rollup.rollup({
      input: './main',
      plugins: [jspmRollup({ basePath, env: { browser: true } })]
    });
  
    const { code, map } = await bundle.generate({ format: 'es' });
    assert.equal(eval(code.replace('export default', '')), path.resolve('dep'));
  });

  test('Test minify', async () => {
    const bundle = await rollup.rollup({
      input: './main',
      plugins: [jspmRollup({ basePath, env: { browser: true }, minify: true })]
    });
  
    const { code, map } = await bundle.generate({ format: 'es' });
    assert.ok(code.length < 5000);
    assert.equal(eval(code.replace('export default', '')), path.resolve('dep'));
  });
});