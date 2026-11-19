import { createProtocol } from './src/host-protocol.mjs';
import { createRoutes, nativeSnapshot } from './src/host-adapter.mjs';

export const name = 'dsh-finder-reference';
export const inject = ['connection'];

export function apply(ctx) {
  const connection = ctx.get('connection');
  const shutdown = new AbortController();
  const protocol = createProtocol({
    platform: process.platform,
    snapshot: signal => nativeSnapshot(signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal),
  });
  ctx.effect(() => () => { shutdown.abort(); protocol.dispose(); }, 'finder-reference: bounded native requests');
  for (const route of createRoutes(protocol, { remoteAllowed: connection.allowsRemoteAuthorities !== false })) {
    ctx.effect(() => connection.fetch.register(route), `finder-reference: ${route.path}`);
  }
}
