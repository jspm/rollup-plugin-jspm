'use strict';

var jspmResolve = require('@jspm/resolve');
var babel = require('@babel/core');
var dewTransformPlugin = require('babel-plugin-transform-cjs-dew');
var path = require('path');

const stage3Syntax = ['asyncGenerators', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'optionalCatchBinding', 'objectRestSpread', 'numericSeparator', 'dynamicImport', 'importMeta'];

const browserBuiltinList = ['@empty', '@empty.dew', 'assert', 'buffer', 'console', 'constants', 'crypto', 'domain', 'events', 'http', 'https', 'os', 'path', 'process', 'punycode', 'querystring', 'stream', 'string_decoder', 'sys', 'timers', 'tty', 'url', 'util', 'vm', 'zlib'];

let cache = Object.create(null);

const FORMAT_ESM = undefined;
const FORMAT_CJS = 1;
const FORMAT_CJS_DEW = 2;
const FORMAT_JSON = 4;
const FORMAT_JSON_DEW = 8;

var jspmRollup = (options = {}) => {
  let basePath = options.basePath || process.cwd();
  if (basePath[basePath.length - 1] !== '/')
    basePath += '/';

  const env = options.env || Object.create(null);
  if (env.node === undefined && env.browser === undefined)
    env.browser = true;

  let browserBuiltins;
  if (typeof options.browserBuiltins === 'string') {
    browserBuiltins = options.browserBuiltins;
  }
  else {
    try {
      browserBuiltins = jspmResolve.sync('@jspm/core/nodelibs/', basePath, { cache, env }).resolved;
    }
    catch (e) {
      if (e.code !== 'MODULE_NOT_FOUND')
        throw e;
    }
    // Fallback to using internal @jspm/core
    if (!browserBuiltins) {
      browserBuiltins = jspmResolve.sync('@jspm/core/nodelibs/', __filename, { cache, env }).resolved;
    }
  }

  let externals;
  if (options.externals instanceof Array) {
    externals = {};
    for (const ext of externals)
      externals[ext] = true;
  }
  else {
    externals = options.externals;
  }

  let moduleFormats, externalsMap, externalsPromise;

  return {
    name: 'jspm-rollup',
    options (opts) {
      opts.output = opts.output || {};
      opts.output.interop = false;
      return opts;
    },
    buildStart () {
      moduleFormats = new Map();
      cache = Object.create(null);

      if (externals) {
        externalsMap = new Map();
        // resolve externals to populate externalsMap
        // TODO: support scoped externals
        externalsPromise = Promise.all(Object.entries(externals).map(async ([name, alias]) => {
          try {
            // package may not have a main
            const { resolved, format } = await jspmResolve(name, basePath, { cache, env });
            if (format === 'builtin')
              return true;
            externalsMap.set(resolved, alias);
          }
          catch (e) {
            if (e.code !== 'MODULE_NOT_FOUND' || e.toString().indexOf('No package main defined') === -1)
              throw e;
          }
          const { resolved: resolvedPath, format } = await jspmResolve(name + '/', basePath, { cache, env });
          if (format === 'builtin')
            return true;
          externalsMap.set(resolvedPath, alias === true ? alias : alias + '/');
        }));
      }
    },
    async resolveId (name, parent) {
      const topLevel = !parent;
      if (topLevel)
        parent = basePath;

      const cjsResolve = moduleFormats.get(parent) & (FORMAT_CJS | FORMAT_CJS_DEW);

      if (cjsResolve && name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);

      let resolved, format;
      try {
        ({ resolved, format } = await jspmResolve(name, parent, { cache, env, cjsResolve }));
      }
      catch (err) {
        // non file-URLs treated as externals
        if (err.code === 'MODULE_NAME_URL_NOT_FILE')
          return false;
        // non top-level not found treated as externals, but with a warning
        if (err.code === 'MODULE_NOT_FOUND' && !topLevel && !name.startsWith('./') && !name.startsWith('../')) {
          console.warn(`jspm could not find ${name} from ${parent} treating as external.`);
          return false;
        }
        throw err;
        // if top-level, allow "x" to resolve first as "x" plain, then as "./x"
        // Disabled for now - staying strict!
        /* if (!topLevel || !err || err.code !== 'MODULE_NOT_FOUND' ||
            name.startsWith('./') || name.startsWith('../'))
          throw err;
        ({ resolved, format } = await jspmResolve('./' + name, parent, { cache, env, cjsResolve }));
        */
      }

      switch (format) {
        case 'builtin':
          // builtins treated as externals in Node
          if (env.browser) {
            if (browserBuiltinList.includes(name))
              return browserBuiltins + name + '.js';
            else
              return browserBuiltins + '@empty.js';
          }
          else {
            return false;
          }
        case 'addon':
          throw new Error('jspm CommonJS addon requires not yet supported in builds loading ' + resolved);
        case 'json':
          moduleFormats.set(resolved, cjsResolve ? FORMAT_JSON_DEW : FORMAT_JSON);
        break;
        case 'commonjs':
          if (!cjsResolve)
            resolved += '?entry';
          moduleFormats.set(resolved, cjsResolve ? FORMAT_CJS_DEW : FORMAT_CJS);
        break;
      }

      if (externals) {
        await externalsPromise;
        let id = externalsMap.get(resolved);
        if (id !== undefined) {
          if (id === true)
            id = name;
          return { id, external: true };
        }
        for (const external of externalsMap.keys()) {
          if (!external.endsWith('/')) continue;
          if (resolved.startsWith(external)) {
            let id = externalsMap.get(external);
            if (id === true)
              id = getPackageName(name) + '/';
            id = id + resolved.slice(external.length);
            return { id, external: true };
          }
        }
      }

      return resolved;
    },
    load (id) {
      if (id.endsWith('?entry'))
        return `import { dew } from "./${path.basename(id.substr(0, id.length - 6))}";\nexport default dew();`;
      return null;
    },
    transform (code, id) {
      // size retained for source maps compatibility
      if (env.production)
        code = code.replace(/process\.env\.NODE_ENV/g, "'production'        ");
      else
        code = code.replace(/process\.env\.NODE_ENV/g, "'dev'               ");

      switch (moduleFormats.get(id)) {
        case FORMAT_ESM:
          return code;
        case FORMAT_JSON:
          return 'export default ' + code;
        case FORMAT_JSON_DEW:
          return `export function dew () {\n  return exports;\n}\nvar exports = ${code};\n`;
        case FORMAT_CJS:
          return code;
      }
      
      // FORMAT_CJS_DEW
      return babel.transform(code, {
        filename: id,
        babelrc: false,
        highlightCode: false,
        compact: false,
        sourceType: 'script',
        sourceMaps: true,
        parserOpts: {
          allowReturnOutsideFunction: true,
          plugins: stage3Syntax
        },
        plugins: [[dewTransformPlugin, {
          browserOnly: env.browser,
          resolve: (depId, opts) => {
            if (opts.optional) {
              // try resolve optional dependencies
              // if they dont resolve, return null now
              try {
                jspmResolve.sync(depId, id, { cache, env, cjsResolve: true });
              }
              catch (e) {
                return null;
              }
              return depId;
            }
            if (opts.wildcard) {
              // we can only wildcard resolve internal requires
              if (!pattern.startsWith('./') && !pattern.startsWith('../'))
                return;
              const glob = path.resolve(depId, pattern);
              throw new Error('CJS wildcards not yet supported, please post an issue.');
              //const wildcardPath = path.relative(pkgBasePath, path.resolve(filePath.substr(0, filePath.lastIndexOf(path.sep)), pattern)).replace(/\\/g, '/');
              //const wildcardPattern = new RegExp('^' + wildcardPath.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'));
              /*const matches = Object.keys(files).filter(file => file.match(wildcardPattern) && (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.node')));
              const relFile = path.relative(pkgBasePath, path.resolve(filePath.substr(0, filePath.lastIndexOf(path.sep))));
              return matches.map(match => {
                let relPath = path.relative(relFile, match).replace(/\\/g, '/');
                if (relPath === '')
                  relPath = './' + filePath.substr(filePath.lastIndexOf('/') + 1);
                else if (!relPath.startsWith('../'))
                  relPath = './' + relPath;
                return relPath;
              });*/
            }
          },
          wildcardExtensions: ['.js', '.json', '.node'],
          // externals are ESM dependencies
          esmDependencies: dep => {
            if (dep.endsWith('/'))
              dep = dep.slice(0, dep.length - 1);
            try {
              var { resolved, format } = jspmResolve.sync(dep, id, { cache, env, cjsResolve: true });
              if (format === 'builtin' || format === 'module')
                return true;
            }
            catch (e) {
              if (e.code !== 'MODULE_NOT_FOUND')
                throw e;
              return true;
            }
            if (externals) { 
              if (externalsMap.has(resolved))
                return true;
              for (const external of externalsMap.keys()) {
                if (!external.endsWith('/')) continue;
                if (resolved.startsWith(external))
                  return true;
              }
            }
          },
          filename: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url).pathname`,
          dirname: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(0, import.meta.url.lastIndexOf('/')).slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))).pathname`
        }]]
      });
    }
  };
};

module.exports = jspmRollup;

function getPackageName (name) {
  const sepIndex = name.indexOf('/');
  if (name[0] !== '@') {
    if (sepIndex === -1)
      return name;
    return name.slice(0, sepIndex);
  }
  // invalid name, but allow
  if (sepIndex === -1)
    return name;
  const nextSepIndex = name.indexOf('/', sepIndex + 1);
  if (nextSepIndex === -1)
    return name;
  return name.slice(0, nextSepIndex);
}