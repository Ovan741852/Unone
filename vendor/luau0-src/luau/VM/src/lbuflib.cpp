// This file is part of the Luau programming language and is licensed under MIT License; see LICENSE.txt for details
#include "lualib.h"

#include "lcommon.h"
#include "lbuffer.h"

#if defined(LUAU_BIG_ENDIAN)
#include <endian.h>
#endif

#include <string.h>

// while C API returns 'size_t' for binary compatibility in case of future extensions,
// in the current implementation, length and offset are limited to 31 bits
// because offset is limited to an integer, a single 64bit comparison can be used and will not overflow
#define isoutofbounds(offset, len, accessize) (uint64_t(unsigned(offset)) + (accessize) > uint64_t(len))

static_assert(MAX_BUFFER_SIZE <= INT_MAX, "current implementation can't handle a larger limit");

// UNONE: every buffer write goes through this check; a readonly buffer stays
// immutable for every reference to it, so no writable alias can exist.
static void* checkwritablebuffer(lua_State* L, int narg, size_t* len)
{
    void* buf = luaL_checkbuffer(L, narg, len);
    if (lua_getreadonly(L, narg))
        luaL_error(L, "attempt to modify a readonly buffer");
    return buf;
}

#if defined(LUAU_BIG_ENDIAN)
template<typename T>
inline T buffer_swapbe(T v)
{
    if (sizeof(T) == 8)
        return htole64(v);
    else if (sizeof(T) == 4)
        return htole32(v);
    else if (sizeof(T) == 2)
        return htole16(v);
    else
        return v;
}
#endif

static int buffer_create(lua_State* L)
{
    int size = luaL_checkinteger(L, 1);

    luaL_argcheck(L, size >= 0, 1, "size");

    lua_newbuffer(L, size);
    return 1;
}

static int buffer_fromstring(lua_State* L)
{
    size_t len = 0;
    const char* val = luaL_checklstring(L, 1, &len);

    void* data = lua_newbuffer(L, len);
    memcpy(data, val, len);
    return 1;
}

static int buffer_tostring(lua_State* L)
{
    size_t len = 0;
    void* data = luaL_checkbuffer(L, 1, &len);

    lua_pushlstring(L, (char*)data, len);
    return 1;
}

template<typename T>
static int buffer_readinteger(lua_State* L)
{
    size_t len = 0;
    void* buf = luaL_checkbuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);

    if (isoutofbounds(offset, len, sizeof(T)))
        luaL_error(L, "buffer access out of bounds");

    T val;
    memcpy(&val, (char*)buf + offset, sizeof(T));

#if defined(LUAU_BIG_ENDIAN)
    val = buffer_swapbe(val);
#endif

    lua_pushnumber(L, double(val));
    return 1;
}

template<typename T>
static int buffer_writeinteger(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);
    int value = luaL_checkunsigned(L, 3);

    if (isoutofbounds(offset, len, sizeof(T)))
        luaL_error(L, "buffer access out of bounds");

    T val = T(value);

#if defined(LUAU_BIG_ENDIAN)
    val = buffer_swapbe(val);
#endif

    memcpy((char*)buf + offset, &val, sizeof(T));
    return 0;
}

template<typename T, typename StorageType>
static int buffer_readfp(lua_State* L)
{
    size_t len = 0;
    void* buf = luaL_checkbuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);

    if (isoutofbounds(offset, len, sizeof(T)))
        luaL_error(L, "buffer access out of bounds");

    T val;

#if defined(LUAU_BIG_ENDIAN)
    static_assert(sizeof(T) == sizeof(StorageType), "type size must match to reinterpret data");
    StorageType tmp;
    memcpy(&tmp, (char*)buf + offset, sizeof(tmp));
    tmp = buffer_swapbe(tmp);

    memcpy(&val, &tmp, sizeof(tmp));
#else
    memcpy(&val, (char*)buf + offset, sizeof(T));
#endif

    lua_pushnumber(L, double(val));
    return 1;
}

template<typename T, typename StorageType>
static int buffer_writefp(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);
    double value = luaL_checknumber(L, 3);

    if (isoutofbounds(offset, len, sizeof(T)))
        luaL_error(L, "buffer access out of bounds");

    T val = T(value);

#if defined(LUAU_BIG_ENDIAN)
    static_assert(sizeof(T) == sizeof(StorageType), "type size must match to reinterpret data");
    StorageType tmp;
    memcpy(&tmp, &val, sizeof(tmp));
    tmp = buffer_swapbe(tmp);

    memcpy((char*)buf + offset, &tmp, sizeof(tmp));
#else
    memcpy((char*)buf + offset, &val, sizeof(T));
#endif

    return 0;
}

static int buffer_readstring(lua_State* L)
{
    size_t len = 0;
    void* buf = luaL_checkbuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);
    int size = luaL_checkinteger(L, 3);

    luaL_argcheck(L, size >= 0, 3, "size");

    if (isoutofbounds(offset, len, unsigned(size)))
        luaL_error(L, "buffer access out of bounds");

    lua_pushlstring(L, (char*)buf + offset, size);
    return 1;
}

static int buffer_writestring(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);
    size_t size = 0;
    const char* val = luaL_checklstring(L, 3, &size);
    int count = luaL_optinteger(L, 4, int(size));

    luaL_argcheck(L, count >= 0, 4, "count");

    if (size_t(count) > size)
        luaL_error(L, "string length overflow");

    // string size can't exceed INT_MAX at this point
    if (isoutofbounds(offset, len, unsigned(count)))
        luaL_error(L, "buffer access out of bounds");

    memcpy((char*)buf + offset, val, count);
    return 0;
}

static int buffer_len(lua_State* L)
{
    size_t len = 0;
    luaL_checkbuffer(L, 1, &len);

    lua_pushnumber(L, double(unsigned(len)));
    return 1;
}

static int buffer_copy(lua_State* L)
{
    size_t tlen = 0;
    void* tbuf = checkwritablebuffer(L, 1, &tlen);
    int toffset = luaL_checkinteger(L, 2);

    size_t slen = 0;
    void* sbuf = luaL_checkbuffer(L, 3, &slen);
    int soffset = luaL_optinteger(L, 4, 0);

    int size = luaL_optinteger(L, 5, int(slen) - soffset);

    if (size < 0)
        luaL_error(L, "buffer access out of bounds");

    if (isoutofbounds(soffset, slen, unsigned(size)))
        luaL_error(L, "buffer access out of bounds");

    if (isoutofbounds(toffset, tlen, unsigned(size)))
        luaL_error(L, "buffer access out of bounds");

    memmove((char*)tbuf + toffset, (char*)sbuf + soffset, size);
    return 0;
}

static int buffer_fill(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    int offset = luaL_checkinteger(L, 2);
    unsigned value = luaL_checkunsigned(L, 3);
    int size = luaL_optinteger(L, 4, int(len) - offset);

    if (size < 0)
        luaL_error(L, "buffer access out of bounds");

    if (isoutofbounds(offset, len, unsigned(size)))
        luaL_error(L, "buffer access out of bounds");

    memset((char*)buf + offset, value & 0xff, size);
    return 0;
}

static int buffer_readbits(lua_State* L)
{
    size_t len = 0;
    void* buf = luaL_checkbuffer(L, 1, &len);
    int64_t bitoffset = (int64_t)luaL_checknumber(L, 2);
    int bitcount = luaL_checkinteger(L, 3);

    if (bitoffset < 0)
        luaL_error(L, "buffer access out of bounds");

    if (unsigned(bitcount) > 32)
        luaL_error(L, "bit count is out of range of [0; 32]");

    if (uint64_t(bitoffset + bitcount) > uint64_t(len) * 8)
        luaL_error(L, "buffer access out of bounds");

    unsigned startbyte = unsigned(bitoffset / 8);
    unsigned endbyte = unsigned((bitoffset + bitcount + 7) / 8);

    uint64_t data = 0;

#if defined(LUAU_BIG_ENDIAN)
    for (int i = int(endbyte) - 1; i >= int(startbyte); i--)
        data = (data << 8) + uint8_t(((char*)buf)[i]);
#else
    memcpy(&data, (char*)buf + startbyte, endbyte - startbyte);
#endif

    uint64_t subbyteoffset = bitoffset & 0x7;
    uint64_t mask = (1ull << bitcount) - 1;

    lua_pushunsigned(L, unsigned((data >> subbyteoffset) & mask));
    return 1;
}

static int buffer_writebits(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    int64_t bitoffset = (int64_t)luaL_checknumber(L, 2);
    int bitcount = luaL_checkinteger(L, 3);
    unsigned value = luaL_checkunsigned(L, 4);

    if (bitoffset < 0)
        luaL_error(L, "buffer access out of bounds");

    if (unsigned(bitcount) > 32)
        luaL_error(L, "bit count is out of range of [0; 32]");

    if (uint64_t(bitoffset + bitcount) > uint64_t(len) * 8)
        luaL_error(L, "buffer access out of bounds");

    unsigned startbyte = unsigned(bitoffset / 8);
    unsigned endbyte = unsigned((bitoffset + bitcount + 7) / 8);

    uint64_t data = 0;

#if defined(LUAU_BIG_ENDIAN)
    for (int i = int(endbyte) - 1; i >= int(startbyte); i--)
        data = data * 256 + uint8_t(((char*)buf)[i]);
#else
    memcpy(&data, (char*)buf + startbyte, endbyte - startbyte);
#endif

    uint64_t subbyteoffset = bitoffset & 0x7;
    uint64_t mask = ((1ull << bitcount) - 1) << subbyteoffset;

    data = (data & ~mask) | ((uint64_t(value) << subbyteoffset) & mask);

#if defined(LUAU_BIG_ENDIAN)
    for (int i = int(startbyte); i < int(endbyte); i++)
    {
        ((char*)buf)[i] = data & 0xff;
        data >>= 8;
    }
#else
    memcpy((char*)buf + startbyte, &data, endbyte - startbyte);
#endif
    return 0;
}

// UNONE: called directly by the VM, so errors never cross host frames.
static void* checkbufferargument(lua_State* L, const char* operation, size_t* len)
{
    void* buf = lua_tobuffer(L, 1, len);
    if (!buf)
        luaL_error(L, "BYTES_BUFFER_REQUIRED: api.bytes.%s expects a buffer, got %s", operation, luaL_typename(L, 1));
    return buf;
}

// Make the buffer immutable for every reference to it, in place and in O(1).
// Readonly is permanent: there is no operation that clears it.
int unone_buffer_freeze(lua_State* L)
{
    checkbufferargument(L, "freeze", NULL);
    lua_setreadonly(L, 1, 1);
    lua_settop(L, 1);
    return 1;
}

int unone_buffer_isfrozen(lua_State* L)
{
    checkbufferargument(L, "isFrozen", NULL);
    lua_pushboolean(L, lua_getreadonly(L, 1));
    return 1;
}

// A frozen copy of a range. A whole frozen buffer is returned as is, since no
// reference to it can change it.
int unone_buffer_snapshot(lua_State* L)
{
    size_t len = 0;
    void* source = checkbufferargument(L, "snapshot", &len);
    int offset = luaL_optinteger(L, 2, 0);
    int size = luaL_optinteger(L, 3, int(len) - offset);

    if (offset < 0 || size < 0 || isoutofbounds(offset, len, unsigned(size)))
        luaL_error(L, "BYTES_RANGE_INVALID: api.bytes.snapshot range is outside the buffer");

    if (lua_getreadonly(L, 1) && offset == 0 && size_t(size) == len)
    {
        lua_settop(L, 1);
        return 1;
    }

    // The source stays on the stack, so a collection here cannot free it, and
    // buffers never move.
    void* copy = lua_newbuffer(L, size_t(size));
    memcpy(copy, (char*)source + offset, size_t(size));
    lua_setreadonly(L, -1, 1);
    return 1;
}

static const luaL_Reg bufferlib[] = {
    {"create", buffer_create},
    {"fromstring", buffer_fromstring},
    {"tostring", buffer_tostring},
    {"readi8", buffer_readinteger<int8_t>},
    {"readu8", buffer_readinteger<uint8_t>},
    {"readi16", buffer_readinteger<int16_t>},
    {"readu16", buffer_readinteger<uint16_t>},
    {"readi32", buffer_readinteger<int32_t>},
    {"readu32", buffer_readinteger<uint32_t>},
    {"readf32", buffer_readfp<float, uint32_t>},
    {"readf64", buffer_readfp<double, uint64_t>},
    {"writei8", buffer_writeinteger<int8_t>},
    {"writeu8", buffer_writeinteger<uint8_t>},
    {"writei16", buffer_writeinteger<int16_t>},
    {"writeu16", buffer_writeinteger<uint16_t>},
    {"writei32", buffer_writeinteger<int32_t>},
    {"writeu32", buffer_writeinteger<uint32_t>},
    {"writef32", buffer_writefp<float, uint32_t>},
    {"writef64", buffer_writefp<double, uint64_t>},
    {"readstring", buffer_readstring},
    {"writestring", buffer_writestring},
    {"len", buffer_len},
    {"copy", buffer_copy},
    {"fill", buffer_fill},
    {"readbits", buffer_readbits},
    {"writebits", buffer_writebits},
    {NULL, NULL},
};

int luaopen_buffer(lua_State* L)
{
    luaL_register(L, LUA_BUFFERLIBNAME, bufferlib);

    return 1;
}
