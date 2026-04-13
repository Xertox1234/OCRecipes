#!/usr/bin/env python3
"""
Patch Google MLKit fat binary frameworks for arm64 iOS Simulator compatibility.

MLKit ships fat binaries (.framework) where the arm64 slice is tagged for iOS (device).
iOS 26+ simulators are arm64-only, so the linker rejects these device-tagged slices.
This script re-tags the arm64 content from platform iOS (2) to iOS Simulator (7).

Handles:
- Static archives with BSD long names (#1/N format)
- Static archives with duplicate member names
- Direct Mach-O object files in fat binaries
"""

import struct
import os
import subprocess
import sys
import tempfile
import shutil


PLATFORM_IOS = 2
PLATFORM_IOSSIMULATOR = 7
LC_BUILD_VERSION = 0x32
MH_MAGIC_64 = 0xFEEDFACF


def patch_macho_in_buffer(data, offset, size):
    """Patch LC_BUILD_VERSION in a Mach-O object at the given offset in data.
    Returns True if patched."""
    if size < 32:
        return False

    magic = struct.unpack_from("<I", data, offset)[0]
    if magic != MH_MAGIC_64:
        return False

    ncmds = struct.unpack_from("<I", data, offset + 16)[0]
    lc_offset = offset + 32
    patched = False

    for _ in range(ncmds):
        if lc_offset + 8 > offset + size:
            break
        cmd, cmdsize = struct.unpack_from("<II", data, lc_offset)
        if cmd == LC_BUILD_VERSION:
            platform = struct.unpack_from("<I", data, lc_offset + 8)[0]
            if platform == PLATFORM_IOS:
                struct.pack_into("<I", data, lc_offset + 8, PLATFORM_IOSSIMULATOR)
                patched = True
        lc_offset += cmdsize

    return patched


def patch_archive_in_place(archive_path):
    """Patch all Mach-O members in a static archive without extracting.
    Handles BSD long names (#1/N format) and preserves all members."""
    with open(archive_path, "rb") as f:
        data = bytearray(f.read())

    if data[:8] != b"!<arch>\n":
        return False

    offset = 8
    patched_any = False

    while offset < len(data):
        if offset + 60 > len(data):
            break

        header = data[offset : offset + 60]
        name_raw = header[:16].decode("ascii", errors="replace").strip()
        size_str = header[48:58].decode("ascii", errors="replace").strip()
        if not size_str.isdigit():
            break
        member_size = int(size_str)
        member_start = offset + 60

        # Handle BSD long names: #1/N means first N bytes are the name
        name_len = 0
        if name_raw.startswith("#1/"):
            name_len = int(name_raw[3:])

        # Mach-O data starts after the name bytes
        obj_start = member_start + name_len
        obj_size = member_size - name_len

        if obj_size > 0 and obj_start + obj_size <= len(data):
            if patch_macho_in_buffer(data, obj_start, obj_size):
                patched_any = True

        # Members are 2-byte aligned
        next_offset = member_start + member_size
        if next_offset % 2 == 1:
            next_offset += 1
        offset = next_offset

    if patched_any:
        with open(archive_path, "wb") as f:
            f.write(data)

    return patched_any


def patch_framework(fw_path):
    """Patch a single .framework's fat binary."""
    name = os.path.basename(fw_path).replace(".framework", "")
    binary = os.path.join(fw_path, name)
    if not os.path.isfile(binary):
        return False

    lipo = subprocess.run(["lipo", "-info", binary], capture_output=True, text=True)
    info = lipo.stdout + lipo.stderr
    if "arm64" not in info:
        return False

    tmpdir = tempfile.mkdtemp()
    try:
        arm64_path = os.path.join(tmpdir, "arm64")
        subprocess.run(
            ["lipo", "-thin", "arm64", "-output", arm64_path, binary],
            capture_output=True,
        )
        if not os.path.exists(arm64_path):
            return False

        thin_type = subprocess.run(
            ["file", arm64_path], capture_output=True, text=True
        ).stdout

        if "ar archive" in thin_type:
            if not patch_archive_in_place(arm64_path):
                return False
        elif "Mach-O" in thin_type:
            with open(arm64_path, "rb") as f:
                fdata = bytearray(f.read())
            if not patch_macho_in_buffer(fdata, 0, len(fdata)):
                return False
            with open(arm64_path, "wb") as f:
                f.write(fdata)
        else:
            return False

        # Recombine with other slices
        if "x86_64" in info:
            x86_path = os.path.join(tmpdir, "x86_64")
            subprocess.run(
                ["lipo", "-thin", "x86_64", "-output", x86_path, binary],
                capture_output=True,
            )
            subprocess.run(
                ["lipo", "-create", x86_path, arm64_path, "-output", binary],
                capture_output=True,
            )
        else:
            shutil.copy2(arm64_path, binary)

        return True
    finally:
        shutil.rmtree(tmpdir)


def main():
    pods_dir = sys.argv[1] if len(sys.argv) > 1 else "ios/Pods"
    if not os.path.isdir(pods_dir):
        print(f"Pods directory not found: {pods_dir}", file=sys.stderr)
        sys.exit(1)

    patched = []
    for root, dirs, files in os.walk(pods_dir):
        for d in dirs:
            if d.endswith(".framework"):
                fw_path = os.path.join(root, d)
                if patch_framework(fw_path):
                    patched.append(d)

    if patched:
        print(
            f"Patched {len(patched)} frameworks for arm64 simulator: "
            + ", ".join(patched)
        )
    else:
        print("No frameworks needed patching.")


if __name__ == "__main__":
    main()
