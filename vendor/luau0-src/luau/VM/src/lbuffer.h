// This file is part of the Luau programming language and is licensed under MIT License; see LICENSE.txt for details
#pragma once

#include "lobject.h"

// buffer size limit
#define MAX_BUFFER_SIZE (1 << 30)

// GCObject size has to be at least 16 bytes, so a minimum of 8 bytes is always reserved
#define sizebuffer(len) (offsetof(Buffer, inlineData) + ((len) < 8 ? 8 : (len)))
#define sizebufferobject(buffer) sizebuffer((buffer)->owner ? 0 : (buffer)->len)

LUAI_FUNC Buffer* luaB_newbuffer(lua_State* L, size_t s);
LUAI_FUNC Buffer* luaB_newbufferview(lua_State* L, Buffer* source, size_t offset, size_t s);
LUAI_FUNC void luaB_freebuffer(lua_State* L, Buffer* u, struct lua_Page* page);
