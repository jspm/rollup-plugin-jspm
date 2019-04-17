import assert from 'assert';
import fs from 'fs';
import path from 'path';
import rollup from 'rollup';
import jspmRollup from '../src/jspm-rollup.js';

const winSepRegEx = /\\/g;

const basePath = path.resolve('.').replace(winSepRegEx, '/');
const fixturesPath = path.resolve('./test/fixtures').replace(winSepRegEx, '/');
const outFixtures = path.resolve('./test/out').replace(winSepRegEx, '/');

throw 'Test suite currently out of sync with Rollup and jspm updates.\nThanks for taking a look!\nPRs very welcome to get this running on latest Rollup and jspm 2.';

suite('Syntax error messages', () => {
  test('Basic syntax error', async () => {
    try {
      await rollup.rollup({
        input: `${fixturesPath}/syntax-error.js`,
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
      input: `${fixturesPath}/dynamic-import.js`,
      plugins: [jspmRollup()]
    });
    const { output: [{ code, map }] } = await build.generate({ format: 'es' });
    assert.equal(code.indexOf(`import('chalk')`), -1, 'Dynamic import must be remapped');
    assert.deepEqual(build.modules.map(module => module.id).sort(), [
      'node_modules/ansi-styles/index.js?dew.js',
      'node_modules/chalk/index.js',
      'node_modules/chalk/index.js?dew.js',
      'node_modules/chalk/templates.js?dew.js',
      'node_modules/color-convert/conversions.js?dew.js',
      'node_modules/color-convert/index.js?dew.js',
      'node_modules/color-convert/route.js?dew.js',
      'node_modules/color-name/index.js?dew.js',
      'node_modules/escape-string-regexp/index.js?dew.js',
      'node_modules/has-flag/index.js?dew.js',
      'node_modules/supports-color/index.js?dew.js',
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

    assert.ok(bundle.modules.find(m => m.id.endsWith('node-browser-builtins/process.js?dew.js')));
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

    const chunks = await bundle.write({ format: 'cjs', dir: `${outFixtures}` });

    assert.equal(chunks['babel.js'].modules.length, 325);
    assert.equal(chunks['lodash.js'].modules.length, 2);

    // test we can execute (assertions in code)
    require(`${outFixtures}/babel.js`);
    require(`${outFixtures}/lodash.js`);
  });
});
