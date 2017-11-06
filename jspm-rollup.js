const jspmResolve = require('jspm-resolve');
const babel = require('babel-core');
const fs = require('fs');
const path = require('path');

let cache = {};
let formatCache = {};

const builtinSources = {
  assert: { name: 'assert/', resolved: undefined },
  buffer: { name: 'buffer/', resolved: undefined },
  child_process: { name: '@empty', resolved: undefined },
  cluster: { name: '@empty', resolved: undefined },
  console: { name: 'console-browserify', resolved: undefined },
  constants: { name: 'constants-browserify', resolved: undefined },
  crypto: { name: 'crypto-browserify', resolved: undefined },
  dgram: { name: '@empty', resolved: undefined },
  dns: { name: '@empty', resolved: undefined },
  domain: { name: 'domain-browser', resolved: undefined },
  events: { name: 'events/', resolved: undefined },
  fs: { name: '@empty', resolved: undefined },
  http: { name: 'stream-http', resolved: undefined },
  https: { name: 'https-browserify', resolved: undefined },
  module: { name: '@empty', resolved: undefined },
  net: { name: '@empty', resolved: undefined },
  os: { name: 'os-browserify/browser.js', resolved: undefined },
  path: { name: 'path-browserify', resolved: undefined },
  process: { name: 'process/browser.js', resolved: undefined },
  punycode: { name: 'punycode/', resolved: undefined },
  querystring: { name: 'querystring-es3/', resolved: undefined },
  readline: { name: '@empty', resolved: undefined },
  repl: { name: '@empty', resolved: undefined },
  stream: { name: 'stream-browserify', resolved: undefined },
  _stream_duplex: { name: 'readable-stream/duplex.js', resolved: undefined },
  _stream_passthrough: { name: 'readable-stream/passthrough.js', resolved: undefined },
  _stream_readable: { name: 'readable-stream/readable.js', resolved: undefined },
  _stream_transform: { name: 'readable-stream/transform.js', resolved: undefined },
  _stream_writable: { name: 'readable-stream/writable.js', resolved: undefined },
  string_decoder: { name: 'string_decoder', resolved: undefined },
  sys: { name: 'util/util.js', resolved: undefined },
  timers: { name: 'timers-browserify', resolved: undefined },
  tls: { name: '@empty', resolved: undefined },
  tty: { name: 'tty-browserify', resolved: undefined },
  url: { name: 'url/', resolved: undefined },
  util: { name: 'util/util.js', resolved: undefined },
  vm: { name: 'vm-browserify', resolved: undefined },
  zlib: { name: 'browserify-zlib', resolved: undefined }
};

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
        const builtinSource = builtinSources[resolved];
        resolved = builtinSource.resolved || (builtinSource.resolved = require.resolve(builtinSource.name));
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