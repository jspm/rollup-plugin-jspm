const babel = require('@babel/core');

const stage3 = ['asyncGenerators', 'classProperties', 'optionalCatchBinding', 'objectRestSpread', 'numericSeparator'];
const stage3DynamicImport = stage3.concat(['dynamicImport', 'importMeta']);

let babelPresetEnv;

exports.envTransform = function (id, source, envTarget, callback) {
  try {
    callback(null, babel.transform(source, {
      babelrc: false,
      parserOpts: {
        plugins: stage3DynamicImport
      },
      ast: false,
      filename: id,
      sourceType: 'module',
      presets: envTarget && [[babelPresetEnv, {
        modules: false,
        // this assignment pending release of https://github.com/babel/babel/pull/7438
        targets: Object.assign({}, envTarget)
      }]]
    }));
  }
  catch (err) {
    if (err.pos || err.loc)
      err.frame = err.codeFrame || err;
    callback(err);
  }
};

exports.dewTransform = function (id, source, envTarget, nodeEnv, callback) {
  if (envTarget && !babelPresetEnv)
    babelPresetEnv = require('@babel/preset-env');
  try {
    callback(null, babel.transform(source, {
      babelrc: false,
      ast: false,
      filename: id,
      parserOpts: {
        allowReturnOutsideFunction: true,
        plugins: stage3
      },
      presets: envTarget && [[babelPresetEnv, {
        modules: false,
        targets: envTarget
      }]],
      plugins: [
        [require('babel-plugin-transform-cjs-dew'), {
          filename: id,
          define: {
            'process.env.NODE_ENV': nodeEnv
          }
        }]
      ]
    }));
  }
  catch (err) {
    if (err.pos || err.loc)
      err.frame = err.codeFrame || err;
    callback(err);
  }
};