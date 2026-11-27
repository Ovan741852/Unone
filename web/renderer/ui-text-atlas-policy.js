// RGBA pages without mipmaps. Automatic sizing starts with a 4 MiB page.
export function parseUiTextAtlasSize(value) {
 if(value===undefined)return 1024;
 if(!Number.isInteger(value)||value<256||value>4096||(value&(value-1))!==0)
  throw Error('UI_TEXT_ATLAS_SIZE_INVALID: expected a power of two from 256 to 4096');
 return value;
}
