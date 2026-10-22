#!/usr/bin/env python3
"""Read only Mach-O container, load-command, and section metadata.

This is supplemental Python analysis, not REA output. No instructions are
disassembled, and no target code is executed or copied into a reconstruction.
"""
import argparse
import hashlib
import json
import mmap
import struct
from pathlib import Path


def inspect(path):
    with path.open("rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
        size = len(data)
        def read(fmt, offset, boundary=size):
            width = struct.calcsize(fmt)
            if offset < 0 or offset + width > boundary:
                raise ValueError("Truncated or out-of-bounds Mach-O metadata")
            return struct.unpack_from(fmt, data, offset)

        def cstring(start, end):
            if not 0 <= start <= end <= size:
                raise ValueError("Out-of-bounds string")
            return data[start:end].split(b"\0", 1)[0].decode("utf-8", "replace")

        magic = data[:4]
        if magic == b"\xca\xfe\xba\xbe":
            count = read(">I", 4)[0]
            if count > 32:
                raise ValueError("Unexpected number of architecture slices")
            slices = [read(">IIIII", 8 + i * 20)[2:4] for i in range(count)]
        elif magic == b"\xcf\xfa\xed\xfe":
            slices = [(0, size)]
        else:
            raise ValueError("Only fat32 and little-endian Mach-O 64 are supported")
        result = []
        for base, length in slices:
            end = base + length
            if base < 0 or end > size or data[base:base + 4] != b"\xcf\xfa\xed\xfe":
                raise ValueError("Unsupported or invalid architecture slice")
            _, cpu, subtype, filetype, commands, command_bytes, flags, _ = read("<8I", base, end)
            cursor, command_end = base + 32, base + 32 + command_bytes
            if command_end > end or commands > 65536:
                raise ValueError("Invalid load-command table")
            dylibs, sections, rpaths, build = [], [], [], []
            for _ in range(commands):
                command, command_size = read("<II", cursor, command_end)
                next_cursor = cursor + command_size
                if command_size < 8 or next_cursor > command_end:
                    raise ValueError("Invalid load command")
                if command in {0xC, 0x80000018, 0x8000001F, 0x80000023}:
                    name_offset = read("<I", cursor + 8, next_cursor)[0]
                    dylibs.append({"path": cstring(cursor + name_offset, next_cursor),
                                   "weak": command == 0x80000018})
                elif command == 0x8000001C:
                    offset = read("<I", cursor + 8, next_cursor)[0]
                    rpaths.append(cstring(cursor + offset, next_cursor))
                elif command == 0x19:
                    section_count = read("<I", cursor + 64, next_cursor)[0]
                    for index in range(section_count):
                        section = cursor + 72 + index * 80
                        read("<80s", section, next_cursor)
                        sections.append({"section": cstring(section, section + 16),
                                         "segment": cstring(section + 16, section + 32)})
                elif command == 0x32:
                    platform, minimum, sdk, _ = read("<4I", cursor + 8, next_cursor)
                    version = lambda v: f"{v >> 16}.{(v >> 8) & 255}.{v & 255}"
                    build.append({"platform": platform, "minimum_os": version(minimum), "sdk": version(sdk)})
                cursor = next_cursor
            result.append({"architecture": {0x01000007: "x86_64", 0x0100000C: "arm64"}.get(cpu, hex(cpu)),
                           "offset": base, "size": length, "load_commands": commands,
                           "dylibs": dylibs, "rpaths": rpaths, "sections": sections, "build": build})
        return {"tool": "supplemental Python Mach-O metadata parser", "format": "Mach-O",
                "sha256": hashlib.sha256(data).hexdigest(), "size": size, "slices": result,
                "limitations": ["Metadata only; no disassembly, decompilation, or runtime observation.",
                                "Declared library loads do not establish executed functionality."]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    print(json.dumps(inspect(args.binary), indent=2))
