// This file is part of the Luau programming language and is licensed under MIT License; see LICENSE.txt for details
#include "lualib.h"

#include "lcommon.h"
#include "lbuffer.h"

#if defined(LUAU_BIG_ENDIAN)
#include <endian.h>
#endif

#include <string.h>
#include <cmath>

// while C API returns 'size_t' for binary compatibility in case of future extensions,
// in the current implementation, length and offset are limited to 31 bits
// because offset is limited to an integer, a single 64bit comparison can be used and will not overflow
#define isoutofbounds(offset, len, accessize) (uint64_t(unsigned(offset)) + (accessize) > uint64_t(len))

static_assert(MAX_BUFFER_SIZE <= INT_MAX, "current implementation can't handle a larger limit");

// Range arguments never use Luau's coercing/truncating integer conversion.
static uint64_t checkbufferrangeinteger(lua_State* L, int argument)
{
    if (lua_type(L, argument) != LUA_TNUMBER)
        luaL_error(L, "BUFFER_RANGE_INVALID: buffer range offsets and counts must be numbers");
    double value = lua_tonumber(L, argument);
    if (!std::isfinite(value) || value < 0 || std::floor(value) != value || value > 9007199254740991.0)
        luaL_error(L, "BUFFER_RANGE_INVALID: buffer range offsets and counts must be nonnegative finite safe integers");
    return uint64_t(value);
}

static size_t checkbufferposition(lua_State* L, int argument, size_t length)
{
    uint64_t value = checkbufferrangeinteger(L, argument);
    if (value > length)
        luaL_error(L, "buffer access out of bounds");
    return size_t(value);
}

static size_t optbuffercount(lua_State* L, int argument, size_t defaultValue, size_t available)
{
    uint64_t count = lua_isnoneornil(L, argument) ? defaultValue : checkbufferrangeinteger(L, argument);
    if (count > available)
        luaL_error(L, "buffer access out of bounds");
    return size_t(count);
}

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
    size_t size = checkbufferposition(L, 1, MAX_BUFFER_SIZE);
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
    size_t offset = checkbufferposition(L, 2, len);

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
    size_t offset = checkbufferposition(L, 2, len);
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
    size_t offset = checkbufferposition(L, 2, len);

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
    size_t offset = checkbufferposition(L, 2, len);
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
    size_t offset = checkbufferposition(L, 2, len);
    size_t size = checkbufferposition(L, 3, len - offset);

    if (isoutofbounds(offset, len, unsigned(size)))
        luaL_error(L, "buffer access out of bounds");

    lua_pushlstring(L, (char*)buf + offset, size);
    return 1;
}

static int buffer_writestring(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    size_t offset = checkbufferposition(L, 2, len);
    size_t size = 0;
    const char* val = luaL_checklstring(L, 3, &size);
    uint64_t count = lua_isnoneornil(L, 4) ? size : checkbufferrangeinteger(L, 4);
    if (count > size)
        luaL_error(L, "string length overflow");

    if (count > len - offset)
        luaL_error(L, "buffer access out of bounds");

    memcpy((char*)buf + offset, val, size_t(count));
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
    size_t toffset = checkbufferposition(L, 2, tlen);

    size_t slen = 0;
    void* sbuf = luaL_checkbuffer(L, 3, &slen);
    size_t soffset = lua_isnoneornil(L, 4) ? 0 : checkbufferposition(L, 4, slen);
    size_t size = optbuffercount(L, 5, slen - soffset, slen - soffset);
    if (size > tlen - toffset)
        luaL_error(L, "buffer access out of bounds");

    memmove((char*)tbuf + toffset, (char*)sbuf + soffset, size);
    return 0;
}

static int buffer_fill(lua_State* L)
{
    size_t len = 0;
    void* buf = checkwritablebuffer(L, 1, &len);
    size_t offset = checkbufferposition(L, 2, len);
    unsigned value = luaL_checkunsigned(L, 3);
    size_t size = optbuffercount(L, 4, len - offset, len - offset);

    memset((char*)buf + offset, value & 0xff, size);
    return 0;
}

static int buffer_readbits(lua_State* L)
{
    size_t len = 0;
    void* buf = luaL_checkbuffer(L, 1, &len);
    uint64_t bitoffset = checkbufferrangeinteger(L, 2);
    uint64_t bitcount = checkbufferrangeinteger(L, 3);
    if (bitcount > 32)
        luaL_error(L, "bit count is out of range of [0; 32]");

    if (bitoffset > uint64_t(len) * 8 || bitcount > uint64_t(len) * 8 - bitoffset)
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
    uint64_t bitoffset = checkbufferrangeinteger(L, 2);
    uint64_t bitcount = checkbufferrangeinteger(L, 3);
    unsigned value = luaL_checkunsigned(L, 4);

    if (bitcount > 32)
        luaL_error(L, "bit count is out of range of [0; 32]");

    if (bitoffset > uint64_t(len) * 8 || bitcount > uint64_t(len) * 8 - bitoffset)
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
static void checkbytesarity(lua_State* L, const char* operation, int minimum, int maximum)
{
    int count = lua_gettop(L);
    if (count < minimum || count > maximum)
        luaL_error(L, "BYTES_ARGUMENTS_INVALID: api.bytes.%s expects %d..%d arguments", operation, minimum, maximum);
}

static void* checkbufferargument(lua_State* L, int argument, const char* operation, size_t* len)
{
    void* buf = lua_tobuffer(L, argument, len);
    if (!buf)
        luaL_error(L, "BYTES_BUFFER_REQUIRED: api.bytes.%s expects a buffer, got %s", operation, luaL_typename(L, argument));
    return buf;
}

static uint64_t checkbytesinteger(lua_State* L, int argument, const char* operation)
{
    if (lua_type(L, argument) != LUA_TNUMBER)
        luaL_error(L, "BYTES_ARGUMENTS_INVALID: api.bytes.%s offsets and lengths must be numbers", operation);
    double value = lua_tonumber(L, argument);
    if (!std::isfinite(value) || std::floor(value) != value || std::fabs(value) > 9007199254740991.0)
        luaL_error(L, "BYTES_ARGUMENTS_INVALID: api.bytes.%s offsets and lengths must be finite safe integers", operation);
    if (value < 0)
        luaL_error(L, "BYTES_RANGE_INVALID: api.bytes.%s range is outside the buffer", operation);
    return uint64_t(value);
}

struct ByteRange
{
    size_t offset;
    size_t length;
};

static ByteRange checkbytesrange(lua_State* L, const char* operation, size_t total, uint64_t offset, uint64_t length)
{
    if (offset > total || length > uint64_t(total) - offset)
        luaL_error(L, "BYTES_RANGE_INVALID: api.bytes.%s range is outside the buffer", operation);
    return {size_t(offset), size_t(length)};
}

static ByteRange checkbytessnapshotrange(lua_State* L, size_t total)
{
    uint64_t offset = lua_isnoneornil(L, 2) ? 0 : checkbytesinteger(L, 2, "snapshot");
    // Validate offset before evaluating a default length; never subtract an
    // unchecked signed value or narrow a binary64 value to a host-sized int.
    checkbytesrange(L, "snapshot", total, offset, 0);
    uint64_t length = lua_isnoneornil(L, 3) ? uint64_t(total) - offset : checkbytesinteger(L, 3, "snapshot");
    return checkbytesrange(L, "snapshot", total, offset, length);
}

// Make the buffer immutable for every reference to it, in place and in O(1).
// Readonly is permanent: there is no operation that clears it.
int unone_buffer_freeze(lua_State* L)
{
    checkbytesarity(L, "freeze", 1, 1);
    checkbufferargument(L, 1, "freeze", NULL);
    lua_setreadonly(L, 1, 1);
    lua_settop(L, 1);
    return 1;
}

int unone_buffer_isfrozen(lua_State* L)
{
    checkbytesarity(L, "isFrozen", 1, 1);
    checkbufferargument(L, 1, "isFrozen", NULL);
    lua_pushboolean(L, lua_getreadonly(L, 1));
    return 1;
}

// A frozen copy of a range. A whole frozen buffer is returned as is, since no
// reference to it can change it.
int unone_buffer_snapshot(lua_State* L)
{
    checkbytesarity(L, "snapshot", 1, 3);
    size_t len = 0;
    void* source = checkbufferargument(L, 1, "snapshot", &len);
    ByteRange range = checkbytessnapshotrange(L, len);

    if (lua_getreadonly(L, 1) && range.offset == 0 && range.length == len)
    {
        lua_settop(L, 1);
        return 1;
    }

    // The source stays on the stack, so a collection here cannot free it, and
    // buffers never move.
    void* copy = lua_newbuffer(L, range.length);
    memcpy(copy, (char*)source + range.offset, range.length);
    lua_setreadonly(L, -1, 1);
    return 1;
}

int unone_buffer_span(lua_State* L)
{
    checkbytesarity(L, "span", 3, 3);
    size_t len = 0;
    checkbufferargument(L, 1, "span", &len);
    if (!lua_getreadonly(L, 1))
        luaL_error(L, "BYTES_FROZEN_REQUIRED: api.bytes.span requires a frozen buffer");
    uint64_t offset = checkbytesinteger(L, 2, "span");
    uint64_t length = checkbytesinteger(L, 3, "span");
    ByteRange range = checkbytesrange(L, "span", len, offset, length);
    lua_newbufferview(L, 1, range.offset, range.length);
    return 1;
}

int unone_buffer_equals(lua_State* L)
{
    checkbytesarity(L, "equals", 2, 2);
    size_t aLen = 0, bLen = 0;
    void* a = checkbufferargument(L, 1, "equals", &aLen);
    void* b = checkbufferargument(L, 2, "equals", &bLen);
    lua_pushboolean(L, aLen == bLen && memcmp(a, b, aLen) == 0);
    return 1;
}

int unone_buffer_equalsrange(lua_State* L)
{
    checkbytesarity(L, "equalsRange", 5, 5);
    size_t aLen = 0, bLen = 0;
    void* a = checkbufferargument(L, 1, "equalsRange", &aLen);
    void* b = checkbufferargument(L, 3, "equalsRange", &bLen);
    uint64_t aOffset = checkbytesinteger(L, 2, "equalsRange");
    uint64_t bOffset = checkbytesinteger(L, 4, "equalsRange");
    uint64_t length = checkbytesinteger(L, 5, "equalsRange");
    ByteRange ar = checkbytesrange(L, "equalsRange", aLen, aOffset, length);
    ByteRange br = checkbytesrange(L, "equalsRange", bLen, bOffset, length);
    lua_pushboolean(L, memcmp((char*)a + ar.offset, (char*)b + br.offset, ar.length) == 0);
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
