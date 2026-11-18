// A page is RGBA, without mipmaps. Omission preserves the historical 4096.
export function parseUiTextAtlasSize(value) {
 if(value===undefined)return 4096;
 if(!Number.isInteger(value)||value<256||value>4096||(value&(value-1))!==0)
  throw Error('UI_TEXT_ATLAS_SIZE_INVALID: expected a power of two from 256 to 4096');
 return value;
}
// The existing ownership checks and one-page-per-sweep rule remain in force.
export function parseUiTextAtlasIdleMs(value) {
 if(value===undefined)return 30000;
 if(!Number.isSafeInteger(value)||value<1000||value>120000)
  throw Error('UI_TEXT_ATLAS_IDLE_INVALID: expected an integer from 1000 to 120000 milliseconds');
 return value;
}
