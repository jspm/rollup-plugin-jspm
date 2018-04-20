const jspmResolve = require('jspm-resolve');
const fs = require('fs');
const path = require('path');
const autocompile = require('@rollup/autocompile');

let resolveCache = Object.create(null);

module.exports = (options = {}) => {
  let formatCache = Object.create(null);

  let basePath = options.basePath || process.cwd();
  if (basePath[basePath.length - 1] !== '/')
    basePath += '/';
  const env = options.env || Object.create(null);
  if (env.node === undefined && env.browser === undefined)
    env.node = true;
  const envTarget = options.envTarget;
  const nodeEnv = env.production === true || env.dev === false ? '"production"' : '"development"';

  const autocompileOptions = Object.assign({}, options);

  const dewPlugin = [require.resolve('babel-plugin-transform-cjs-dew'), {
    define: { 'process.env.NODE_ENV': nodeEnv }
  }];
  const envPreset = envTarget && [[require.resolve('@babel/preset-env'), {
    modules: false,
    targets: envTarget
  }]];

  function addPluginPreset (babelConfig, plugin, preset) {
    const config = Object.assign({}, babelConfig);
    if (plugin) {
      config.plugins = config.plugins ? config.plugins.concat([]) : [];
      config.plugins.push(plugin);
    }
    if (preset) {
      config.presets = config.presets ? config.presets.concat([]) : [];
      config.presets.push(plugin);
    }
    return config;
  }

  autocompileOptions.babel = true; // HMM
  
  const curCompile = autocompile.createCompilerMatcher(autocompileOptions.compile);
  autocompileOptions.compile = autocompile.createCompilerMatcher(id => {
    let compiler = curCompile(id);
    const usingBabel = compiler[0] === './compilers/js.js';
    switch (formatCache[id]) {
      case 'esm':
        if (usingBabel)
          return [compiler[0], addPluginPreset(compiler[1] || {}, null, envPreset)];
        return {
          presets: [envPreset],
          precompiler: compiler
        };
      case 'cjs':
        // add dew plugin to existing Babel transform
        if (usingBabel)
          return [compiler[0], addPluginPreset(compiler[1] || {}, dewPlugin, envPreset)];
        return {
          presets: [envPreset],
          plugins: [dewPlugin],
          precompiler: compiler
        };
      default:
        throw new Error(`Internal Error: Unknown module format for ${id}.`);
    }
  });

  const autocompiler = autocompile(autocompileOptions);

  return {
    name: 'jspm-rollup',
    options (opts) {
      opts.output = opts.output || {};
      opts.output.interop = false;
      return opts;
    },
    onbuildstart () {
      autocompiler.onbuildstart();
    },
    onnbuildend () {
      resolveCache = {};
      formatCache = {};
      autocompiler.onbuildend();
    },
    async resolveId (name, parent) {
      const topLevel = !parent;
      if (topLevel)
        parent = basePath;

      if (name[name.length - 1] === '/')
        name = name.substr(0, name.length - 1);
      
      if (name.endsWith('?dew.js'))
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
        return '@empty' + (parent.endsWith('?dew.js') ? '?dew' : '');
      }
      else if (format === 'builtin') {
        if (parent.endsWith('?dew.js'))
          return resolved + '?dewexternal';
        else
          return false;
      }

      formatCache[resolved] = format;

      if (parent.endsWith('?dew.js'))
        return resolved + '?dew.' + (format === 'json' ? 'json' : 'js');
      else
        return resolved;
    },
    onbuildend () {
      formatCache = Object.create(null);
      resolveCache = Object.create(null);
      autocompiler.onbuildend();
    },
    async load (id) {
      if (id === '@empty' || id === '@empty?dew' || id.endsWith('?dewexternal'))
        return '';
      if (id.endsWith('?dew.js'))
        return await new Promise((resolve, reject) =>
          fs.readFile(id.substr(0, id.length - 7), (err, source) => err ? reject(err) : resolve(source.toString()))
        );
      if (id.endsWith('?dew.json'))
        return await new Promise((resolve, reject) =>
          fs.readFile(id.substr(0, id.length - 9), (err, source) => err ? reject(err) : resolve(source.toString()))
        );
      const format = formatCache[id];
      if (format === 'cjs' || format === 'json')
        return '';
    },
    async transform (source, id) {
      if (id.endsWith('?dewexternal'))
        return `export { default as exports } from "${id.substr(0, id.length - 12)}"; export var __dew__ = null;`;
      let dew = false;
      if (id.endsWith('?dew.js')) {
        id = id.substr(0, id.length - 7);
        dew = true;
      }
      else if (id.endsWith('?dew.json')) {
        id = id.substr(0, id.length - 9);
        dew = true;
      }
      
      if (id === '@empty')
        return '';
      if (id === '@empty?dew')
        return `export var __dew__ = null; export var exports = {}`;

      switch (formatCache[id]) {
        case 'esm':
          if (envTarget)
            return autocompiler.transform.call(this, source, id);
          return source;
        case 'cjs':
          if (dew === false)
            return `import { exports, __dew__ } from "${id}?dew.js"; if (__dew__) __dew__(); export { exports as default };`;
          return autocompiler.transform.call(this, source, id);
        case 'addon':
          this.warn(`Cannot bundle native addon ${id} for the browser.`);
          return '';
        case 'json':
          if (dew === false)
            return `export { exports as default } from "${id}?dew.json";`;
          else
            return `export var __dew__ = null; export var exports = ${source}`;
        default:
          throw new Error(`Internal Error: Unknown module format for ${id}.`);
      }
    }
  };
};