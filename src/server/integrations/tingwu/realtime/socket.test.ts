import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ make: vi.fn() }));
vi.mock('ws', () => ({
  default: class {
    constructor(...args: unknown[]) {
      return mock.make(...args);
    }
  },
}));
import { connectTingwuSocket } from './socket';
class Wire extends EventEmitter {
  bufferedAmount = 12;
  readyState = 1;
  close = vi.fn();
  terminate = vi.fn();
  send = vi.fn();
}
describe('real websocket boundary without network', () => {
  it('maps text, binary, close and error, detaches consumers and closes gracefully', () => {
    const wire = new Wire();
    mock.make.mockReturnValue(wire);
    const port = connectTingwuSocket(
      'wss://tingwu-realtime-cn-beijing.aliyuncs.com/api/ws/v1?mc=demo',
    );
    const handlers = {
      open: vi.fn(),
      message: vi.fn(),
      close: vi.fn(),
      error: vi.fn(),
    };
    const unsubscribe = port.subscribe(handlers);
    wire.emit('open');
    wire.emit('message', Buffer.from('{"demo":true}'), false);
    wire.emit('message', Buffer.from([0]), true);
    wire.emit('error', new Error('private'));
    wire.emit('close', 1006, Buffer.from('private'));
    expect(handlers.open).toHaveBeenCalledOnce();
    expect(handlers.message).toHaveBeenCalledWith('{"demo":true}');
    expect(handlers.error).toHaveBeenCalledTimes(2);
    expect(handlers.close).toHaveBeenCalledWith(1006);
    expect(port.bufferedAmount).toBe(12);
    const done = vi.fn();
    port.send('command', done);
    expect(wire.send).toHaveBeenCalledWith('command', { binary: false }, done);
    port.send(new Uint8Array(2), done);
    expect(wire.send).toHaveBeenLastCalledWith(
      new Uint8Array(2),
      { binary: true },
      done,
    );
    unsubscribe();
    wire.emit('message', Buffer.from('late'), false);
    wire.emit('error', new Error('late'));
    expect(handlers.message).toHaveBeenCalledOnce();
    port.close();
    expect(wire.close).toHaveBeenCalledOnce();
    expect(mock.make).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ followRedirects: false, maxPayload: 262144 }),
    );
  });
  it('terminates connecting sockets rather than leaving pending connections alive', () => {
    const wire = new Wire();
    wire.readyState = 0;
    mock.make.mockReturnValue(wire);
    connectTingwuSocket('wss://demo').close();
    expect(wire.terminate).toHaveBeenCalledOnce();
  });
});
