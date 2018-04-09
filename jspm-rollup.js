const jspmResolve = require('jspm-resolve');
const fs = require('fs');
const path = require('path');
const workerFarm = require('worker-farm');

let formatCache = {}, resolveCache = {};

let transformWorker;

module.exports = ({
  basePath = process.cwd(),
  env = {},
  envTarget
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
    async resolveId (name, parent) {
      const topLevel = !parent;
      if (topLevel)
        parent = basePath;
      if (parent.endsWith('?dewexternal'))
        return false;

      if (name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);
      
      if (name.endsWith('?dew'))
        return name;

      let resolved, format;
      try {
        ({ resolved, format } = await jspmResolve(name, parent, { resolveCache, env }));
      }
      catch (err) {
        // non file-URLs treated as externals
        if (err.code === 'MODULE_NAME_URL_NOT_FILE')
          return false;
        if (!topLevel || !err || err.code !== 'MODULE_NOT_FOUND' ||
            name.startsWith('./') || name.startsWith('../'))
          throw err;
        ({ resolved, format } = await jspmResolve('./' + name, parent, { resolveCache, env }));
      }
      
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
      formatCache = {};
      resolveCache = {};
      if (transformWorker) {
        workerFarm.end(transformWorker);
        transformWorker = undefined;
      }
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

      transformWorker = transformWorker || workerFarm({
        maxConcurrentWorkers: require('os').cpus().length / 2,
        maxConcurrentCallsPerWorker: 1,
        autoStart: true
      }, require.resolve('./transform-worker'), ['envTransform', 'dewTransform']);

      switch (formatCache[id]) {
        case 'esm':
          if (envTarget) {
            return new Promise((resolve, reject) => {
              transformWorker.envTransform(id, source, envTarget, (err, result) => err ? reject(err) : resolve(result));
            });
          }
          return source;
        case 'cjs':
          if (dew === false)
            return `import { exports, __dew__ } from "${id}?dew"; if (__dew__) __dew__(); export { exports as default };`;
          return new Promise((resolve, reject) => {
            transformWorker.dewTransform(id, source, envTarget, nodeEnv, (err, result) => err ? reject(err) : resolve(result));
          });
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