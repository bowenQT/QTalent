import WebSocket from 'ws';
import type { SocketPort } from './client';

/** The validated MeetingJoinUrl stays inside the server-side record closure. */
export function connectTingwuSocket(url: string): SocketPort {
  const socket = new WebSocket(url, {
    followRedirects: false,
    handshakeTimeout: 10000,
    maxPayload: 262144,
  });
  // ws can emit an error while terminating a pending handshake, after consumers detach.
  socket.on('error', () => {});
  return {
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    send(value, callback) {
      socket.send(value, { binary: typeof value !== 'string' }, callback);
    },
    close() {
      if (socket.readyState === 1) socket.close();
      else socket.terminate();
    },
    subscribe(handlers) {
      const message = (value: WebSocket.RawData, binary: boolean) => {
        if (binary) handlers.error();
        else handlers.message(value.toString());
      };
      const close = (code: number) => handlers.close(code);
      socket.on('open', handlers.open);
      socket.on('message', message);
      socket.on('error', handlers.error);
      socket.on('close', close);
      return () => {
        socket.off('open', handlers.open);
        socket.off('message', message);
        socket.off('error', handlers.error);
        socket.off('close', close);
      };
    },
  };
}
