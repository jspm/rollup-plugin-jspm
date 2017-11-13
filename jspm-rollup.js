const jspmResolve = require('jspm-resolve');
const babel = require('babel-core');
const fs = require('fs');
const path = require('path');
const resolveBuiltin = require('node-browser-builtins');

let cache = {};
let formatCache = {};

module.exports = ({
  projectPath,
  env = {}
}) => {
  if (env.node === undefined && env.browser === undefined)
    env.browser = true;
  if (projectPath[projectPath.length - 1] !== '/')
    projectPath += '/';
  const nodeEnv = env.production === true || env.dev === false ? 'production' : 'development';
  return {
    name: 'jspm-rollup',
    async resolveId (name, parent = projectPath || process.cwd()) {
      if (name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);
      
      if (name.endsWith('?dew'))
        return name;

      let { resolved, format } = await jspmResolve(name, parent, { cache, env });
      
      if (!resolved) {
        resolved = '@empty';
        format = 'empty';
      }
      else if (format === 'builtin') {
        format = 'cjs';
        resolved = resolveBuiltin(resolved);
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
      if (id === '@empty')
        return '';
      if (id.endsWith('?dew'))
        return await new Promise((resolve, reject) => fs.readFile(id.substr(0, id.length - 4), (err, source) => err ? reject(err) : resolve(source.toString())));
      const format = formatCache[id];
      if (format === 'cjs' || format === 'json')
        return '';
    },
    async transform (source, id) {
      const dew = id.endsWith('?dew');
      if (dew)
        id = id.substr(0, id.length - 4);
      switch (formatCache[id]) {
        case 'esm':
          return source;
        case 'cjs':
          if (dew === false)
            return `import { exports, __dew__ } from "${id}?dew"; if (__dew__) __dew__(); export { exports as default };`;
          const { code, map } = babel.transform(source, {
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
          return { code, map };
        case 'addon':
          this.warn(`Cannot bundle native addon ${id} for the browser.`);
          return '';
        case 'json':
          if (dew === false)
            return `export { exports as default } from "${id}?dew";`;
          else
            return `export var __dew__ = null; export var exports = ${source}`;
        case 'empty':
          if (id.endsWith('?dew') === false)
            return '';
          else
            return `export var __dew__ = null; export var exports = {}`;
        default:
          throw new Error(`Unknown format`);
      }
    }
  };
};