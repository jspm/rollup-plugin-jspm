# rollup-plugin-jspm

Integrate [JSPM](https://github.com/jspm/jspm2-cli) with rollup.

## Installation

```bash
npm install --save-dev rollup-plugin-jspm
```

## Usage
```js
// rollup.config.js
import {resolve} from 'path';
import babel from 'rollup-plugin-babel';
import jspm from 'rollup-plugin-jspm';

const basePath = resolve('components');

export default {
  input: './main.js', // Will resolve to 'components/main.js'
  plugins: [
    jspmRollup({ 
      basePath, // defaults to process.cwd()
      env: { browser: true, node: false } // defaults to { node: true }
    }),
    babel() // Compose with other Rollup plugins
  ]
}

```
