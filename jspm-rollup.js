import { ImportMap } from '@jspm/import-map';
import babel from '@babel/core';
import dewTransformPlugin from 'babel-plugin-transform-cjs-dew';
import path from 'path';
import { Generator, fetch } from '@jspm/generator';

// TODO:
// - ImportMap resolve to support env
// - Generator to support outputting conditional import maps
// - 

let cache = Object.create(null);

const FORMAT_ESM = undefined;
const FORMAT_CJS = 1;
const FORMAT_CJS_DEW = 2;
const FORMAT_JSON = 4;

export default ({ baseUrl, defaultProvider = 'nodemodules', env = ['browser', 'development'], minify, externals, inputMap } = {}) => {
  if (baseUrl) {
    if (typeof baseUrl === 'string')
      baseUrl = new URL(baseUrl);
  }
  else {
    if (typeof Deno !== 'undefined') {
      baseUrl = new URL('file://' + Deno.cwd() + '/');
    }
    else if (typeof process !== 'undefined' && process.versions.node) {
      baseUrl = new URL('file://' + process.cwd() + '/');
    }
    else if (typeof document !== 'undefined') {
      const baseEl = document.querySelector('base[href]');
      if (baseEl)
        baseUrl = new URL(baseEl.href + (baseEl.href.endsWith('/') ? '' : '/'));
      else if (typeof location !== 'undefined')
        baseUrl = new URL('../', new URL(location.href));
    }
  }

  if (externals instanceof Array) {
    const _externals = {};
    for (const ext of externals)
      _externals[ext] = true;
    externals = _externals;
  }

  let moduleFormats, externalsMap, generator, processBuiltinResolved, bufferBuiltinResolved, importMap, terser;

  return {
    name: '@jspm/plugin-rollup',
    options (opts) {
      opts.output = opts.output || {};
      opts.output.interop = false;

      // Always convert the input into object form
      let input;
      if (Array.isArray(opts.input)) {
        const seen = {};
        input = Object.fromEntries(opts.input.map(m => {
          let n = m.split('/').pop();
          const extIndex = n.lastIndexOf('.');
          if (extIndex !== -1)
            n = n.slice(0, extIndex);
          if (seen[n]) {
            const _n = n;
            let i = 1;
            while (seen[n])
              n = _n + ++i;
          }
          seen[n] = true;
          return [n, m];
        }));
      }
      else {
        input = opts.input;
      }
      opts.input = input;

      return opts;
    },
    async buildStart (opts) {
      moduleFormats = new Map();
      cache = Object.create(null);

      // run the generator phase _first_
      generator = new Generator({ mapUrl: baseUrl, env, defaultProvider, inputMap });
      
      if (minify && !terser)
        terser = await import('terser');

      // always trace process and buffer builtins
      await generator.traceInstall('process');
      await generator.traceInstall('buffer');

      processBuiltinResolved = generator.importMap.resolve('process');
      bufferBuiltinResolved = generator.importMap.resolve('buffer');

      try {
        await Promise.all(Object.values(opts.input).map(async specifier => {
          await generator.traceInstall(specifier, baseUrl);
        }));
      }
      catch (e) {
        // We do not throw MODULE_NOT_FOUND errors
        // Instead we surface these during the build phase
        if (!(e.message.startsWith('Module not found') || e.code === 'MODULE_NOT_FOUND'))
          throw e;
      }

      // Pending next Generator update
      importMap = new ImportMap(generator.importMap.baseUrl, generator.importMap.toJSON());

      if (externals) {
        externalsMap = new Map();
        // resolve externals to populate externalsMap
        // TODO: support scoped externals
        await Promise.all(Object.entries(externals).map(async ([name, alias]) => {
          const resolved = importMap.resolve(name, baseUrl, { cache, env, browserBuiltins });
          if (resolved !== null)
            externalsMap.set(resolved, alias);
        }));
      }
    },
    async resolveId (name, parent) {
      const topLevel = !parent;
      if (topLevel)
        parent = baseUrl;

      const cjsResolve = moduleFormats.get(parent) & (FORMAT_CJS | FORMAT_CJS_DEW);

      if (cjsResolve && name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);

      let resolved = importMap.resolve(name, parent);

      if (!resolved)
        throw new Error('Module not found: ' + name + ' in ' + parent);

      if (resolved.endsWith('.json'))
        throw new Error('TODO: JSON');

      const format = generator.getAnalysis(resolved).format;

      if (resolved === null) {
        // non top-level not found treated as externals, but with a warning
        // if (err.code === 'MODULE_NOT_FOUND' && !topLevel && !name.startsWith('./') && !name.startsWith('../')) {
        //   console.warn(`jspm could not find ${name} from ${parent}, treating as external.`);
        //   return false;
        // }
        throw new Error('Module not found: ' + name + ' imported from ' + parent);
      }

      // builtins treated as externals
      // (builtins only emitted as builtins from resolver for Node, not browser)
      switch (format) {
        case 'builtin':
          return false;
        case 'json':
          moduleFormats.set(resolved, FORMAT_JSON);
        break;
        case 'commonjs':
          if (!cjsResolve)
            resolved += '?entry';
          moduleFormats.set(resolved, cjsResolve ? FORMAT_CJS_DEW : FORMAT_CJS);
        break;
      }

      if (externalsMap) {
        let id = externalsMap.get(resolved);
        if (id !== undefined) {
          if (id === true)
            id = name;
          return { id, external: true };
        }
      }

      return resolved;
    },
    async load (id) {
      if (id.endsWith('?entry'))
        return `import { dew } from "./${path.basename(id.substr(0, id.length - 6))}";\nexport default dew();`;
      return (await fetch(id)).text();
    },
    transform (code, id) {
      switch (moduleFormats.get(id)) {
        case FORMAT_ESM:
          return { code, map: null };
        case FORMAT_JSON:
          // Ensure valid JSON
          JSON.parse(code);
          return { code: 'export default ' + code, map: null };
        // case FORMAT_JSON_DEW:
        //   return { code: `export function dew () {\n  return exports;\n}\nvar exports = ${code};\n`, map: null };
        case FORMAT_CJS:
          return { code, map: null };
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
          // plugins: stage3Syntax
        },
        plugins: [[dewTransformPlugin, {
          browserOnly: 'browser' in env,
          define: {
            'process.env.NODE_ENV': 'production' in env ? '"production"' : '"dev"'
          },
          resolve: (depId, opts) => {
            if (depId === 'process')
              return processBuiltinResolved;
            if (depId === 'buffer')
              return bufferBuiltinResolved;

            if (opts.optional)
              return importMap.resolve(depId, id) || depId;

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
            if (dep === 'process' || dep === 'buffer')
              return true;
            const resolved = importMap.resolve(dep, id);
            return generator.getAnalysis(resolved).format === 'esm';
          },
          filename: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url).pathname`,
          dirname: `import.meta.url.startsWith('file:') ? decodeURI(import.meta.url.slice(0, import.meta.url.lastIndexOf('/')).slice(7 + (typeof process !== 'undefined' && process.platform === 'win32'))) : new URL(import.meta.url.slice(0, import.meta.url.lastIndexOf('/'))).pathname`
        }]]
      });
    },
    async renderChunk (code, _chunk, outputOptions) {
      if (!minify) return;
      try {
        var result = await terser.minify(code, {
          sourceMap: {
            asObject: true,
          },
          module: true,
          toplevel: true,
          // defaults to mangle and compress
          keep_fnames: true,
          keep_classnames: true,
          compress: {
            defaults: false,

            // collapse_vars triples terser time...
            // collapse_vars: true,
            computed_props: true,
            conditionals: true,
            dead_code: true,
            directives: true,
            // switches: true,
            if_return: true,
            properties: true,

            side_effects: false,
            keep_fargs: true,
            keep_infinity: true,
            
            unused: true,
            evaluate: true
          },
          output: {
            comments: function(_node, comment) {
              // multiline comment
              if (comment.type == "comment2")
                return /@(preserve|license|cc_on|param|returns|typedef|template|type|deprecated)/i.test(comment.value);
            }
          }
        });
      }
      catch (e) {
        // Always skip Terser bugs
        this.warn({
          message: `Terser error during build, skipping minification of chunk.\n${result.error}`,
          originalError: result.error
        });
        return;
      }

      if (result.error) {
        // Always skip Terser bugs
        this.warn({
          message: `Terser error during build, skipping minification of chunk.\n${result.error}`,
          originalError: result.error
        });
        return;
      }

      return result;
    }
  };
};
