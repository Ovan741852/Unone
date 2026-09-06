#!/bin/sh
# Fetch the pinned official luau-analyze into .toolcache.
#
# Same job as install-luau-analyze.ps1, for shells that are not PowerShell:
# Linux, macOS, and Git Bash on Windows. The analyzer is a development-time tool
# and is deliberately not committed (docs/decisions/0005-luau-analyzer-toolchain.md),
# but a fresh clone without it fails verify's types gate, and "go find the right
# build yourself" is a judgement a script can make instead.
#
#   sh scripts/install-luau-analyze.sh
#
# Every hash below is of bytes downloaded from the official release and checked
# here. Only the Windows binary has actually been executed on the machine that
# pinned them; the Linux and macOS archives were downloaded and their contents
# hashed, not run. A mismatch stops the install rather than typechecking your
# game with something nobody has verified.

set -eu

VERSION=0.734
FORCE=${UNONE_FORCE_INSTALL:-0}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
toolcache=${UNONE_TOOLCACHE:-"$script_dir/../.toolcache"}
target="$toolcache/luau-$VERSION"

case "$(uname -s)" in
  Linux*) asset=luau-ubuntu
          archive_sha=3e514385267c6606f1ff6824bd9d21708a5dd272ea91ab7355a2743b20d45d45
          analyzer_sha=675a793325ac9367104d24b47d94c919910a0f3d96aada7667d09a527e384b80
          analyzer=luau-analyze ;;
  Darwin*) asset=luau-macos
          archive_sha=b76ae047fafc86f82be646af6a2767228c1589437fb38f36959a8ea4bd967cdd
          analyzer_sha=e5e83aa811f586cc41afab44b5a8c8fa5864351bedf1c38a6cd1e21f43e25ab0
          analyzer=luau-analyze ;;
  MINGW*|MSYS*|CYGWIN*) asset=luau-windows
          archive_sha=0f814860c2939f85d2e37bc2e8a8f848012523d1e52c435c6832845fb3fe5dc8
          analyzer_sha=fc28e3a85eccdbdca4974784ffb96134cf2166d5fbd149078cb28cffde88bfee
          analyzer=luau-analyze.exe ;;
  *) echo "unsupported platform $(uname -s): build or download luau-analyze $VERSION yourself and set UNONE_LUAU_ANALYZER to it" >&2
     exit 1 ;;
esac

url="https://github.com/luau-lang/luau/releases/download/$VERSION/$asset.zip"
analyzer_path="$target/$analyzer"

hash_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

if [ -f "$analyzer_path" ] && [ "$FORCE" != "1" ]; then
  existing=$(hash_of "$analyzer_path")
  if [ "$existing" = "$analyzer_sha" ]; then
    echo "luau-analyze $VERSION already installed: $analyzer_path"
    exit 0
  fi
  echo "$analyzer_path exists but is not the pinned build (sha256 $existing). Set UNONE_FORCE_INSTALL=1 to replace it." >&2
  exit 1
fi

for tool in curl unzip; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 1; }
done

mkdir -p "$target"
archive="$target/$asset.zip"

echo "downloading $url"
curl -fsSL -o "$archive" "$url"

downloaded=$(hash_of "$archive")
if [ "$downloaded" != "$archive_sha" ]; then
  rm -f "$archive"
  echo "downloaded archive sha256 $downloaded does not match the pinned $archive_sha; nothing was installed" >&2
  exit 1
fi

unzip -oq "$archive" -d "$target"

[ -f "$analyzer_path" ] || { echo "the archive did not contain $analyzer; nothing was installed" >&2; exit 1; }
installed=$(hash_of "$analyzer_path")
if [ "$installed" != "$analyzer_sha" ]; then
  echo "extracted $analyzer sha256 $installed does not match the pinned $analyzer_sha" >&2
  exit 1
fi
chmod +x "$analyzer_path"

echo "installed luau-analyze $VERSION: $analyzer_path"
echo "game check --types finds it automatically from anywhere inside the repository."
