const jspmResolve = require('@jspm/resolve');

let resolveCache = Object.create(null);

module.exports = (options = {}) => {
  let basePath = options.basePath || process.cwd();
  if (basePath[basePath.length - 1] !== '/')
    basePath += '/';

  const env = options.env || Object.create(null);
  if (env.node === undefined && env.browser === undefined)
    env.browser = true;

  let browserBuiltins
  if (typeof options.browserBuiltins === 'string')
    browserBuiltins = options.browserBuiltins;
  else
    browserBuiltins = jspmResolve.sync('@jspm/node-builtins/', basePath, { resolveCache, env }).resolved;

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

      let resolved, format;
      try {
        ({ resolved, format } = await jspmResolve(name, parent, { resolveCache, env, browserBuiltins }));
      }
      catch (err) {
        // non file-URLs treated as externals
        if (err.code === 'MODULE_NAME_URL_NOT_FILE')
          return false;
        // if top-level, allow "x" to resolve first as "x" plain, then as "./x"
        if (!topLevel || !err || err.code !== 'MODULE_NOT_FOUND' ||
            name.startsWith('./') || name.startsWith('../'))
          throw err;
        ({ resolved, format } = await jspmResolve('./' + name, parent, { resolveCache, env, browserBuiltins }));
      }
      
      // builtins treated as externals
      // (builtins only emitted as builtins from resolver for Node, not browser)
      if (format === 'builtin')
        return false;

      return resolved;
    },
    transform (code, id) {
      // size retained for source maps compatibility
      if (env.production)
        return code.replace(/process\.env\.NODE_ENV/g, "'production'        ");
      else
        return code.replace(/process\.env\.NODE_ENV/g, "'dev'               ");
    }
  };
};
