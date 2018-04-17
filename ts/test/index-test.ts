import test from 'ava';
import getPort from 'get-port';
import http2 from 'http2';
import path from 'path';

import {AutoPush} from '../src/index';

function staticFilePath(filePath: string): string {
  return path.join(__dirname, '..', '..', 'ts', 'test', 'static', filePath);
}

async function startServer(): Promise<number> {
  const port = await getPort();

  const ap = new AutoPush(staticFilePath(''));
  const server = http2.createServer();
  server
      .on('error',
          (err) => {
            throw err;
          })
      .on('socketError',
          (err) => {
            throw err;
          })
      .on('stream', async (stream, headers) => {
        const reqPath = headers[':path'] as string;
        const {pushFn} = await ap.preprocessRequest(reqPath, stream);
        switch (reqPath) {
          case '/foo.html':
            stream.respondWithFile(staticFilePath('foo.html'));
            break;
          case '/bar.html':
            stream.respondWithFile(staticFilePath('bar.html'));
            break;
          default:
            throw new Error(`Unexpected path: ${reqPath}`);
        }
        ap.recordRequestPath(stream.session, reqPath, true);
        await pushFn();
      });
  server.listen(port);
  return port;
}

interface ClientData {
  data: string;
  pushedPaths: string[];
}

function request(
    session: http2.ClientHttp2Session, reqPath: string): Promise<ClientData> {
  const result: ClientData = {
    data: '',
    pushedPaths: [],
  };
  return new Promise((resolve) => {
    session
        .on('error',
            (err) => {
              throw err;
            })
        .on('socketError',
            (err) => {
              throw err;
            })
        .on('stream', (pushedStream, headers) => {
          result.pushedPaths.push(headers[':path'] as string);
        });
    const clientStream = session.request({':path': reqPath});
    clientStream.setEncoding('utf8');
    let data = '';
    clientStream
        .on('data',
            (chunk) => {
              data += chunk;
            })
        .on('end', () => {
          result.data = data;
          resolve(result);
        });
    clientStream.end();
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

test('basic test', async (t) => {
  const port = await startServer();

  // Request /foo.html and /bar.html so that /bar.html is pushed when /foo.html
  // is requested in a following session.
  const client1 = http2.connect(`http://localhost:${port}`);
  const fooData = await request(client1, '/foo.html');
  t.true(fooData.data.includes('This is a foo document.'));
  t.is(fooData.pushedPaths.length, 0);
  const barData = await request(client1, '/bar.html');
  t.true(barData.data.includes('This is a bar document.'));
  t.is(barData.pushedPaths.length, 0);

  // Delay so that the next request is not part of the warming up.
  await delay(1000);

  // Request /foo.html and see /bar.html is pushed.
  const client2 = http2.connect(`http://localhost:${port}`);
  const fooData2 = await request(client2, '/foo.html');
  t.true(fooData2.data.includes('This is a foo document.'));
  t.deepEqual(fooData2.pushedPaths, ['/bar.html']);
});
