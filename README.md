# rollup-plugin-jspm

Integrate [JSPM](https://github.com/jspm/jspm2-cli) with rollup.

## Installation

```bash
npm install --save-dev rollup-plugin-jspm
```

## Usage
```js
// rollup.config.js
import path from 'path';
import babelRollup from 'rollup-plugin-babel';
import jspmRollup from 'rollup-plugin-jspm';

const basePath = path.resolve('components');

export default {
  input: './main.js', // Will resolve to 'components/main.js'
  plugins: [
    jspmRollup({ 
      basePath, // defaults to process.cwd()
      env: { browser: true, node: false }, // defaults to { node: true }
      // set to use @babel/preset-env
      envTarget: {
        browsers: 'last 2 versions'
      },
      // map of externals to aliased or true
      externals: {}
    }),
    babelRollup() // Compose with other Rollup plugins
  ]
}

```
