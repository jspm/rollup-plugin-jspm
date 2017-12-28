const jspmResolve = require('jspm-resolve');
const babel = require('babel-core');
const fs = require('fs');
const path = require('path');

let cache = {};
let formatCache = {};

module.exports = ({
  basePath = process.cwd(),
  env = {}
} = {}) => {
  if (env.node === undefined && env.browser === undefined)
    env.node = true;
  if (basePath[basePath.length - 1] !== '/')
    basePath += '/';
  const nodeEnv = env.production === true || env.dev === false ? '"production"' : '"development"';
  return {
    name: 'jspm-rollup',
    options (opts) {
      opts.output = opts.output || {};
      opts.output.interop = false;
      return opts;
    },
    async resolveId (name, parent = basePath) {
      if (parent.endsWith('?dewexternal'))
        return false;

      if (name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);
      
      if (name.endsWith('?dew'))
        return name;

      let { resolved, format } = await jspmResolve(name, parent, { cache, env });
      
      if (!resolved) {
        return '@empty' + (parent.endsWith('?dew') ? '?dew' : '');
      }
      else if (format === 'builtin') {
        if (parent.endsWith('?dew'))
          return resolved + '?dewexternal';
        else
          return false;
      }
      
      formatCache[resolved] = format;

      if (parent.endsWith('?dew'))
        return resolved + '?dew';
      else
        return resolved;
    },
    ongenerate () {
      cache = {};
      formatCache = {};
    },
    async load (id) {
      if (id === '@empty' || id === '@empty?dew' || id.endsWith('?dewexternal'))
        return '';
      if (id.endsWith('?dew'))
        return await new Promise((resolve, reject) => fs.readFile(id.substr(0, id.length - 4), (err, source) => err ? reject(err) : resolve(source.toString())));
      const format = formatCache[id];
      if (format === 'cjs' || format === 'json')
        return '';
    },
    async transform (source, id) {
      if (id.endsWith('?dewexternal'))
        return `export { default as exports } from "${id.substr(0, id.length - 12)}"; export var __dew__ = null;`;
      const dew = id.endsWith('?dew');
      if (dew)
        id = id.substr(0, id.length - 4);
      
      if (id === '@empty') {
        if (dew)
          return `export var __dew__ = null; export var exports = {}`;
        else
          return '';
      }
      
      switch (formatCache[id]) {
        case 'esm':
          return source;
        case 'cjs':
          if (dew === false)
            return `import { exports, __dew__ } from "${id}?dew"; if (__dew__) __dew__(); export { exports as default };`;
          try {
            return babel.transform(source, {
              ast: false,
              filename: id,
              parserOpts: {
                allowReturnOutsideFunction: true
              },
              plugins: [
                ['transform-cjs-dew', {
                  filename: id,
                  define: {
                    'process.env.NODE_ENV': nodeEnv
                  }
                }]
              ]
            });
          }
          catch (err) {
            err.frame = err.codeFrame;
            throw err;
          }
        case 'addon':
          this.warn(`Cannot bundle native addon ${id} for the browser.`);
          return '';
        case 'json':
          if (dew === false)
            return `export { exports as default } from "${id}?dew";`;
          else
            return `export var __dew__ = null; export var exports = ${source}`;
        default:
          throw new Error(`Unknown format`);
      }
    }
  };
};