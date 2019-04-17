import Mocha from 'mocha';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { promises as fsPromises } from 'fs';

(async () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const tests = (await fsPromises.readdir(__dirname)).filter(name => name.endsWith('.js'));
  const mocha = new Mocha({ ui: 'tdd' });

  for (const test of tests) {
    mocha.suite.emit('pre-require', global, test, mocha);
    await import('./' + test);
  }

  mocha.run();
})()
.catch(e => {
  console.error(e);
});
