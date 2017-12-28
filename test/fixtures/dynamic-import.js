import assert from 'assert';

import('chalk').then(({ default: chalk }) => {
  assert.equal(chalk.red('test'), ``);
});