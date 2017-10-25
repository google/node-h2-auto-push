import test from 'ava';
import {ClientCacheChecker} from '../src/client-cache-checker';

test('basic test', t => {
  const ccc = new ClientCacheChecker();
  for (let i = 0; i < 100; i++) {
    ccc.addPath('' + i);
  }
  for (let i = 0; i < 100; i++) {
    if (!ccc.mayHavePath('' + i)) {
      t.fail(`Failed for ${i}`);
    }
  }
  t.false(ccc.mayHavePath('100'));
});

test('serialization', t => {
  const ccc = new ClientCacheChecker();
  ccc.addPath('foo');
  ccc.addPath('bar');

  // serialize & deserialize back
  const serialized = ccc.serialize();
  const newCcc = ClientCacheChecker.deserialize(serialized);
  t.true(newCcc.mayHavePath('foo'));
  t.true(newCcc.mayHavePath('bar'));
  t.false(newCcc.mayHavePath('baz'));
});
