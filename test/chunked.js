import assert from 'assert';
import fs from 'fs';
import * as rollup from 'rollup';
import jspmRollup from '@jspm/plugin-rollup';

const baseUrl = new URL('../', import.meta.url);
const fixturesUrl = new URL('./fixtures', import.meta.url);
const outFixturesUrl = new URL('./out', import.meta.url);

suite('Syntax error messages', () => {
  test('Basic syntax error', async () => {
    try {
      await rollup.rollup({
        input: [`${fixturesUrl}/syntax-error.js`],
        plugins: [jspmRollup()]
      });
    }
    catch (err) {
      if (JSON.stringify(err).indexOf(`import a 'asdf'`) === -1 || JSON.stringify(err).indexOf('^') === -1)
        assert(false);
    }
  });
});

suite('Dynamic import', () => {
  test('Dynamic import', async () => {
    const build = await rollup.rollup({
      onwarn () {},
      input: `${fixturesUrl}/dynamic-import.js`,
      plugins: [jspmRollup()]
    });
    const { output: [{ code, map }] } = await build.generate({ format: 'es' });
    assert.strictEqual(code.indexOf(`import('chalk')`), -1, 'Dynamic import must be remapped');
    assert.deepStrictEqual(build.cache.modules.map(module => module.id.slice(baseUrl.href.length)).sort(), [
      "node_modules/@jspm/core/nodelibs/assert.js",
      "node_modules/@jspm/core/nodelibs/chunk-0c2d1322.js",
      "node_modules/@jspm/core/nodelibs/chunk-dac557ba.js",
      "node_modules/@jspm/core/nodelibs/process.js",
      "node_modules/ansi-styles/index.js",
      "node_modules/chalk/index.js",
      "node_modules/chalk/index.js?entry",
      "node_modules/chalk/templates.js",
      "node_modules/color-convert/conversions.js",
      "node_modules/color-convert/index.js",
      "node_modules/color-convert/route.js",
      "node_modules/color-name/index.js",
      "node_modules/escape-string-regexp/index.js",
      "node_modules/supports-color/browser.js",
      'test/fixtures/dynamic-import.js'
    ].map(path => path.endsWith('?dewexternal') ? path : path));
  });
});

suite('Edge cases', () => {
  test.skip('@empty build', async () => {
    const bundle = await rollup.rollup({
      input: 'x',
      plugins: [jspmRollup({ baseUrl: fixturesUrl, inputMap: { imports: { 'x': '@empty' } } })]
    });
    await bundle.write({
      file: `${outFixtures}/x.js`,
      format: 'esm'
    });
    assert.strictEqual(fs.readFileSync(`${outFixtures}/x.js`).toString(), '\n');
  });
});

suite('Browser builds', () => {
  test.skip('babel', async () => {
    const bundle = await rollup.rollup({
      input: `${fixturesUrl}babel.js`,
      plugins: [jspmRollup({ env: ['browser'] })],
    });
    bundle.write({
      file: `${outFixtures}/babel-browser.js`,
      format: 'cjs'
    });
    console.log(build.cache.modules);
    assert.ok(bundle.modules.find(m => m.id.endsWith('node-browser-builtins/process.js?dew.js')));
  });
});


suite('Node single file builds', () => {
  test.skip('babel', async () => {
    const chunk = await rollup.rollup({
      input: `${fixturesUrl}/babel.js`,
      plugins: [jspmRollup()]
    });
    
    await chunk.write({ format: 'cjs', file: `${outFixtures}/babel.js` });

    // test we can execute (assertions in code)
    require(`${outFixtures}/babel.js`);
  });
});

suite('Chunked builds', () => {
  test.skip('babel / lodash chunk', async () => {
    const bundle = await rollup.rollup({
      input: [
        `${fixturesUrl}/babel.js`,
        `${fixturesUrl}/lodash.js`
      ],
      plugins: [jspmRollup()],
      experimentalCodeSplitting: true
    });

    const chunks = await bundle.write({ format: 'cjs', dir: `${outFixtures}` });

    assert.equal(chunks['babel.js'].modules.length, 325);
    assert.equal(chunks['lodash.js'].modules.length, 2);

    // test we can execute (assertions in code)
    require(`${outFixtures}/babel.js`);
    require(`${outFixtures}/lodash.js`);
  });
});
