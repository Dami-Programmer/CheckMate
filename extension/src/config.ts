// Filled in by build.mjs.
declare const __SERVER_URL__: string;
declare const __VERSION__: string;

export const SERVER_URL = __SERVER_URL__;
export const VERSION = __VERSION__;
export const PRIVACY_URL = `${__SERVER_URL__}/privacy.html`; // "Privacy & your data" page
