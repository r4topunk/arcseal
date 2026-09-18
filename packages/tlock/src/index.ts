// @arcseal/tlock: timelock encryption to drand quicknet rounds. Vendored tlock-js 0.9.0 (MIT), Node 22 and browsers.
export { isTlockError, TlockError, type TlockErrorCode } from './errors.js';
export { QUICKNET, QUICKNET_DST } from './quicknet.js';
export { type Beacon, decrypt, encrypt, roundOf, verifyBeacon } from './tlock.js';
