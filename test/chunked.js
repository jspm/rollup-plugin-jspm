const assert = require('assert');
const fs = require('fs');
const path = require('path');
const rollup = require('rollup');
const jspmRollup = require('../jspm-rollup');

const winSepRegEx = /\\/g;

const basePath = path.resolve('.').replace(winSepRegEx, '/');
const fixturesPath = path.resolve('./test/fixtures').replace(winSepRegEx, '/');
const outFixtures = path.resolve('./test/out').replace(winSepRegEx, '/');

suite('Syntax error messages', () => {
  test('Basic syntax error', async () => {
    try {
      await rollup.rollup({
        input: `${fixturesPath}/syntax-error.js`,
        plugins: [jspmRollup()]
      });
    }
    catch (err) {
      assert.equal(err.message, `Unexpected token`);
      assert.equal(err.frame, `1: import a \'asdf\';\n            ^`);
    }
  });
});

suite('Dynamic import', () => {
  test('Dynamic import', async () => {
    const build = await rollup.rollup({
      onwarn () {},
      input: `${fixturesPath}/dynamic-import.js`,
      experimentalDynamicImport: true,
      plugins: [jspmRollup()]
    });
    const { code, map } = await build.generate({ format: 'es' });
    assert.equal(code.indexOf(`import('chalk')`), -1, 'Dynamic import must be remapped');
    assert.deepEqual(build.modules.map(module => module.id).sort(), [
      'node_modules/ansi-styles/index.js?dew',
      'node_modules/chalk/index.js',
      'node_modules/chalk/index.js?dew',
      'node_modules/chalk/templates.js?dew',
      'node_modules/color-convert/conversions.js?dew',
      'node_modules/color-convert/index.js?dew',
      'node_modules/color-convert/route.js?dew',
      'node_modules/color-name/index.js?dew',
      'node_modules/escape-string-regexp/index.js?dew',
      'node_modules/has-flag/index.js?dew',
      'node_modules/supports-color/index.js?dew',
      'test/fixtures/dynamic-import.js',
      'os?dewexternal',
      'process?dewexternal'
    ].map(path => path.endsWith('?dewexternal') ? path : `${basePath}/${path}`));
  });
});

suite('Edge cases', () => {
  test('@empty build', async () => {
    const bundle = await rollup.rollup({
      input: 'x',
      plugins: [jspmRollup({ basePath: fixturesPath })]
    });
    await bundle.write({
      file: `${outFixtures}/x.js`,
      format: 'es'
    });
    assert.equal(fs.readFileSync(`${outFixtures}/x.js`).toString(), '\n');
  });
});

suite('Browser builds', () => {
  test('babel', async () => {
    const bundle = await rollup.rollup({
      input: `${fixturesPath}/babel.js`,
      plugins: [jspmRollup({ env: { browser: true } })],
    });
    bundle.write({
      file: `${outFixtures}/babel-browser.js`,
      format: 'cjs'
    });

    assert.ok(bundle.modules.find(m => m.id.endsWith('node-browser-builtins/process.js?dew')));
  });
});


suite('Node single file builds', () => {
  test('babel', async () => {
    const chunk = await rollup.rollup({
      input: `${fixturesPath}/babel.js`,
      plugins: [jspmRollup()]
    });
    
    await chunk.write({ format: 'cjs', file: `${outFixtures}/babel.js` });

    // test we can execute (assertions in code)
    require(`${outFixtures}/babel.js`);
  });
});

suite('Chunked builds', () => {
  test('babel / lodash chunk', async () => {
    const bundle = await rollup.rollup({
      input: [
        `${fixturesPath}/babel.js`,
        `${fixturesPath}/lodash.js`
      ],
      plugins: [jspmRollup()],
      experimentalCodeSplitting: true
    });

    await bundle.write({ format: 'cjs', dir: `${outFixtures}` });

    assert.equal(bundle.chunks['./babel.js'].modules.length, 329);
    assert.equal(bundle.chunks['./lodash.js'].modules.length, 2);

    // test we can execute (assertions in code)
    require(`${outFixtures}/babel.js`);
    require(`${outFixtures}/lodash.js`);
  });
});
