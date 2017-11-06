const rollup = require('rollup');
const jspmRollup = require('../jspm-rollup');
const path = require('path');

suite('Basic Rollup', () => {
  const projectPath = path.resolve('test/fixtures/basic');

  test('Test', async () => {
    const bundle = await rollup.rollup({
      input: './main',
      plugins: [jspmRollup({ projectPath })],
      //external: [],
      // globals: {},
    });
  
    const { code, map } = await bundle.generate({
      format: 'es'
    });
    console.log(code);
  });
});