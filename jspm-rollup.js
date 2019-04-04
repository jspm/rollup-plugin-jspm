const jspmResolve = require('@jspm/resolve');
const babel = require('@babel/core');
const dewTransformPlugin = require('babel-plugin-transform-cjs-dew');
const path = require('path');

const stage3Syntax = ['asyncGenerators', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'optionalCatchBinding', 'objectRestSpread', 'numericSeparator', 'dynamicImport', 'importMeta'];

let cache = Object.create(null);

const packageRegEx = /^((?:@[\-a-zA-Z\d]+[\-_\.a-zA-Z\d]*\/)?[-a-zA-Z\d][-_\.a-zA-Z\d]*)(\/|$)/;
function getPackageMatch (name) {
  const packageMatch = name.match(packageRegEx);
  if (packageMatch)
    return packageMatch[1];
}

function getPackagePath (resolved) {
  return jspmResolve.utils.getJspmProjectPathSync(resolved, cache) ||
      jspmResolve.utils.getPackageBoundarySync(resolved, cache);
}

function getPackageJsonExternals (resolved) {
  let externals = [];
  const packagePath = getPackagePath(resolved);
  if (!packagePath)
    return null;
  const pcfg = jspmResolve.utils.readPackageConfigSync(packagePath, cache);
  if (pcfg.dependencies)
    externals = externals.concat(Object.keys(pcfg.dependencies));
  if (pcfg.peerDependencies)
    externals = externals.concat(Object.keys(pcfg.peerDependencies));
  if (pcfg.optionalDependencies)
    externals = externals.concat(Object.keys(pcfg.optionalDependencies));
  return { packagePath, externals };
}

const FORMAT_ESM = undefined;
const FORMAT_CJS = 1;
const FORMAT_CJS_DEW = 2;
const FORMAT_JSON = 4;
const FORMAT_JSON_DEW = 8;

module.exports = (options = {}) => {
  let basePath = options.basePath || process.cwd();
  if (basePath[basePath.length - 1] !== '/')
    basePath += '/';

  const env = options.env || Object.create(null);
  if (env.node === undefined && env.browser === undefined)
    env.browser = true;

  let browserBuiltins
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

  const externals = options.externals || [];

  let moduleFormats, externalsByParent;

  return {
    name: 'jspm-rollup',
    options (opts) {
      opts.output = opts.output || {};
      opts.output.interop = false;
      return opts;
    },
    buildStart () {
      moduleFormats = new Map();
      externalsByParent = new Map();
    },
    async resolveId (name, parent) {
      const topLevel = !parent;
      if (topLevel)
        parent = basePath;

      const parentExternals = externalsByParent.get(parent);
      if (parentExternals && parentExternals.externals.includes(getPackageMatch(name)))
        return false;

      const cjsResolve = moduleFormats.get(parent) & (FORMAT_CJS | FORMAT_CJS_DEW);

      if (cjsResolve && name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);

      let resolved, format;
      try {
        ({ resolved, format } = await jspmResolve(name, parent, { cache, env, browserBuiltins, cjsResolve }));
      }
      catch (err) {
        // non file-URLs treated as externals
        if (err.code === 'MODULE_NAME_URL_NOT_FILE')
          return false;
        // non top-level not found treated as externals, but with a warning
        if (err.code === 'MODULE_NOT_FOUND' && !topLevel && !name.startsWith('./') && !name.startsWith('../')) {
          console.warn(`jspm could not find ${name} from ${parent}, treating as external.`);
          return false;
        }
        // if top-level, allow "x" to resolve first as "x" plain, then as "./x"
        if (!topLevel || !err || err.code !== 'MODULE_NOT_FOUND' ||
            name.startsWith('./') || name.startsWith('../'))
          throw err;
        ({ resolved, format } = await jspmResolve('./' + name, parent, { cache, env, browserBuiltins, cjsResolve }));
      }

      // builtins treated as externals
      // (builtins only emitted as builtins from resolver for Node, not browser)
      switch (format) {
        case 'builtin':
          return false;
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

      if (topLevel) {
        if (!options.inlineDeps)
          externalsByParent.set(resolved, getPackageJsonExternals(resolved));
      }
      else if (parentExternals) {
        const resolvedPkgPath = getPackagePath(resolved);
        if (resolvedPkgPath === parentExternals.packagePath)
          externalsByParent.set(resolved, parentExternals);
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
                jspmResolve.sync(depId, id, { cache, env, browserBuiltins, cjsResolve: true });
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
            const parentExternals = externalsByParent.get(id);
            if (parentExternals && parentExternals.externals.includes(getPackageMatch(dep)) ||
                externals.indexOf(dep) !== -1)
              return true;
            if (dep in jspmResolve.builtins === false)
              return false;
            try {
              ({ format } = jspmResolve.sync(dep, id, { cache, env, browserBuiltins, cjsResolve: true }));
              return format === 'builtin' || format === 'module';
            }
            catch (e) {
              return false;
            }
          },
          filename: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url).pathname`,
          dirname: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(0, import.meta.url.lastIndexOf('/')).slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))).pathname`
        }]]
      });
    }
  };
};
