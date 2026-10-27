/** Storage wrappers — every access is guarded (private mode, blocked storage, SSR). */

const TOKEN_KEY = 'sie.token';
const ADMIN_KEY = 'sie.adminKey';

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value == null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    /* storage unavailable — keep working in memory only */
  }
}

let memoryToken: string | null = null;
let memoryAdminKey: string | null = null;
let memoryBoothToken: string | null = null;
let boothLastStored: string | null = null;
let boothPersisted = true;

export const tokenStore = {
  get(): string | null {
    return read(() => window.localStorage, TOKEN_KEY) ?? memoryToken;
  },
  set(token: string | null): void {
    memoryToken = token;
    write(() => window.localStorage, TOKEN_KEY, token);
  },
};

export const boothTokenStore = {
  get(): string | null {
    try {
      const stored = window.localStorage.getItem('dino.booth.token');
      // Keep a failed write in memory until shared storage changes independently.
      if (boothPersisted || stored !== boothLastStored) {
        memoryBoothToken = stored;
        boothLastStored = stored;
        boothPersisted = true;
      }
    } catch {
      /* storage unavailable — retain this tab's in-memory session */
    }
    return memoryBoothToken;
  },
  set(token: string | null): void {
    memoryBoothToken = token;
    try {
      boothLastStored = window.localStorage.getItem('dino.booth.token');
    } catch {
      /* retain the last readable shared value */
    }
    try {
      if (token === null) window.localStorage.removeItem('dino.booth.token');
      else window.localStorage.setItem('dino.booth.token', token);
      boothLastStored = token;
      boothPersisted = true;
    } catch {
      boothPersisted = false;
    }
  },
};

export const adminKeyStore = {
  get(): string | null {
    return read(() => window.sessionStorage, ADMIN_KEY) ?? memoryAdminKey;
  },
  set(key: string | null): void {
    memoryAdminKey = key;
    write(() => window.sessionStorage, ADMIN_KEY, key);
  },
};
