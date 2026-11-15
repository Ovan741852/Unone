// A page is RGBA, without mipmaps. Omission preserves the historical 4096.
export function parseUiTextAtlasSize(value) {
 if(value===undefined)return 4096;
 if(!Number.isInteger(value)||value<256||value>4096||(value&(value-1))!==0)
  throw Error('UI_TEXT_ATLAS_SIZE_INVALID: expected a power of two from 256 to 4096');
 return value;
}
