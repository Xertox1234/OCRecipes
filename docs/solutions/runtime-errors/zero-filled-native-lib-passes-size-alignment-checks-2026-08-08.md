---
title: A zero-filled native library passes every structural check — only ELF magic reveals it
track: bug
category: runtime-errors
module: client
severity: high
tags: [android, gradle, native-libs, soloader, reanimated, elf, build-artifacts, disk-pressure, zipalign, verification]
applies_to: [android/**, node_modules/react-native-reanimated/**]
symptoms: [App aborts at startup with "com.facebook.soloader.MinElf$ElfError: file is not ELF: magic is 0x0, it should be 464c457f", Crash stack runs installTurboModule -> NativeReanimatedModule -> createNativeReanimatedModule before any app code, Gradle reports BUILD SUCCESSFUL and the APK contains the .so at plausible size, zipalign -c verification succeeds and the lib is stored uncompressed and correctly aligned, A stripped .so is implausibly tiny (tens of bytes) while its merged input is tens of megabytes]
created: '2026-08-08'
---

# A zero-filled native library passes every structural check — only ELF magic reveals it

## Problem

An Android debug build produced an APK whose `lib/arm64-v8a/libreanimated.so` was
80 MB of `0x00`. The app aborted on launch inside SoLoader. Every structural
property of that file was **correct** — it was only the *contents* that were
absent, and nothing in the toolchain checks contents.

## Symptoms

- `MinElf$ElfError: file is not ELF: magic is 0x0, it should be 464c457f`, thrown
  from `installTurboModule` → `NativeReanimatedModule`.
- Gradle: `BUILD SUCCESSFUL`, exit 0, **no warning**.
- The APK entry has the right size, is `Stored` (uncompressed), and
  `zipalign -c -P 16 -v 4` reports **"Verification successful"**.
- Downstream, `stripDebugDebugSymbols` emitted a **24-byte** file from the 80 MB
  input and still exited 0 — strip on a non-ELF input produces garbage quietly.

## Root Cause

The build that produced the library ran with the host disk at **94 %** (that
build consumed ~7.4 GB). The file was allocated at full length but never
received content. Every later stage faithfully propagated the zeros:
`library_and_local_jars_jni` → `merged_native_libs` → `stripped_native_libs` →
APK. Because size, alignment and compression are all preserved by copying zeros,
each stage's own validity checks passed.

The checks that exist all test *shape*:

| Check | What it actually proves |
| --- | --- |
| File size | bytes were allocated |
| `zipalign -c` | the entry starts on a 16 KB boundary |
| `Stored` vs `Defl` | the packager did not compress it |
| Gradle exit code | no task threw |

**None of them reads byte 0.** Only `7f 45 4c 46` does.

## Solution

Verify the ELF magic of native artifacts, not their size:

```bash
# expect 7f454c46
head -c 4 path/to/lib.so | od -An -tx1 | tr -d ' \n'

# inside an APK, without extracting
unzip -p app-debug.apk lib/arm64-v8a/libreanimated.so | head -c 4 | od -An -tx1

# on device, against the installed APK
adb shell "unzip -p <apk-path> lib/arm64-v8a/libreanimated.so | head -c 4 | od -An -tx1"
```

Compare a suspect library against a known-good sibling in the same APK — a valid
one (`libVisionCamera.so`) shows `7f454c46` while the corrupt one shows
`00000000`, which isolates the fault to one module immediately.

The repair is to rebuild **that module only**, not the whole project:

```bash
./gradlew :react-native-reanimated:clean :app:installDebug -PreactNativeArchitectures=arm64-v8a
```

A correct build produced a **7.6 MB** stripped ELF — the bogus 80 MB was the
unstripped debug size, which is itself a smell worth noticing.

## Prevention

- **Check content, not size.** The failed repair attempt here copied the 80 MB
  `merged_native_libs` file over the 24-byte stripped one after verifying only
  its *size* — which propagated the corruption and burned two more launch cycles.
  A size check on a zero-filled file is indistinguishable from success.
- **Treat a wildly-shrunk strip output as corruption, not compression.** 80 MB →
  24 bytes is not a strip ratio; it is strip failing on a non-ELF input.
- **Do not build native artifacts under disk pressure.** Check free space before
  a multi-GB Android/iOS native build; a 94 %-full volume produced silently
  truncated output with a green exit code.
- **`zipalign -c` success is not integrity.** It is an offset check. Nothing in
  the standard Android toolchain validates that a packaged `.so` is a loadable
  ELF; the first component that does is SoLoader, at runtime, in front of a user.

## Related Files

- `android/app/build.gradle` — packaging; `extractNativeLibs=false` means SoLoader
  maps `.so` files directly out of the APK, so a bad entry is fatal at first use
- `android/gradle.properties` — `reactNativeArchitectures` (single-ABI rebuilds)

## See Also

- [Probes that signal absence by empty output must also check the exit code](../logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md) — the same family: a verification channel that cannot distinguish success from failure
- [A symbol-existence grep passes while the claim about the symbol is wrong](../logic-errors/symbol-existence-grep-is-not-claim-verification-2026-07-05.md) — verifying a proxy instead of the predicate you care about
