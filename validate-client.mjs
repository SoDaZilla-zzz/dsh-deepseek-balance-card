// Validate the __ModuleLoader__ protocol of dsh-liquid-glass-balance-card/lib/client.js
import fs from 'node:fs';

const ReactMock = {
  createElement: (...args) => ({ kind: 'element', args }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
};

const loader = { load: (payload) => { global.__payload = payload; } };
global.window = { __ModuleLoader__: loader, location: { reload: () => {} } };
global.require = (id) => {
  if (id === 'react') return ReactMock;
  if (id === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'Fragment' };
  throw new Error('unresolved require: ' + id);
};
const styleEl = { dataset: {}, textContent: '', remove: () => { global.__styleRemoved = true; } };
global.document = {
  createElement: () => styleEl,
  head: { appendChild: () => { global.__styleAppended = true; } },
};

// Host-side settings route mock: official plugin-card wire protocol.
global.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    value: {
      writable: true,
      settings: { value: { refreshSeconds: 60 }, revision: 1, base: { refreshSeconds: 60 }, user: {} },
      credential: { ref: 'DSH_LIQUID_GLASS_API_KEY', configured: false, writable: true },
      harnessConfigured: true,
    },
  }),
});

const code = fs.readFileSync('E:/ProjectCode/DeepSeekHarnessWorkbook/dsh-liquid-glass-balance-card/lib/client.js', 'utf8');
const fn = new Function('window', 'require', code);
fn(global.window, global.require);

const payload = global.__payload;
if (!payload) { console.error('FAIL: no __ModuleLoader__.load call'); process.exit(1); }
console.log('registered id:', payload.id);

const mod = payload.factory(global.require);
console.log('factory result inject:', JSON.stringify(mod.inject), '| apply:', typeof mod.apply);

const calls = [];
const credentialCalls = [];
const mockCtx = {
  effect(fn, label) {
    calls.push('effect:' + label);
    const disposer = fn();
    calls.push('effect-disposer:' + typeof disposer);
    return disposer;
  },
  get: (name) => {
    if (name === 'connection') {
      return {
        api: {
          credentials: {
            describe: async () => ({ result: { ok: true, value: { credentials: { DSH_LIQUID_GLASS_API_KEY: { configured: false, writable: true } } } } }),
            set: async ({ ref, value }) => { credentialCalls.push('set:' + ref + ':' + String(value).length + 'chars'); return { result: { ok: true } }; },
            unset: async ({ ref }) => { credentialCalls.push('unset:' + ref); return { result: { ok: true } }; },
          },
        },
      };
    }
    return undefined;
  },
  slots: {
    inject(name, cb) {
      calls.push('inject:' + name);
      const reg = cb();
      calls.push('register:' + JSON.stringify(reg));
    },
    register(...args) {
      const [options, component] = args;
      calls.push('slots.register(' + options.name + ', id=' + options.id + ', order=' + options.order + ')');
      if (typeof component === 'function') {
        try {
          const injected = typeof options.inject === 'function' ? options.inject() : {};
          const el = component({ ...injected });
          calls.push('  render -> ' + (el && el.kind ? 'element' : typeof el));
        } catch (err) {
          calls.push('  render THREW: ' + err.message);
        }
      }
      return () => {};
    },
  },
};
mod.apply(mockCtx);
console.log('style appended:', global.__styleAppended === true, '| style remove fn:', typeof mockCtx.effect);
console.log('apply calls:');
for (const c of calls) console.log('  ', c);
console.log('credential calls:', credentialCalls.length === 0 ? '(none during apply)' : credentialCalls.join(', '));
console.log('DONE');
