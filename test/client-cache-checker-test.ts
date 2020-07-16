// Copyright 2017 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
