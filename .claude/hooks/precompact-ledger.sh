#!/usr/bin/env bash
# PreCompact — build a verification-ledger digest for injection after compaction.
#
# Two INDEPENDENT tiers (spec §3 decision 3):
#   curated   — claims paired with the command that established them (ledger-note.sh)
#   mechanical— commands that RAN, extracted from the transcript. NOT a verification tier.
# Independent inputs mean either can be absent; both absent yields an empty digest, which
# is the one deliberate silent case (spec §9).
#
# Fail-open: every failure path exits 0 with no output (spec §7).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
# shellcheck source=lib/context-ledger-path.sh
. "$SCRIPT_DIR/lib/context-ledger-path.sh" 2>/dev/null || exit 0
command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat 2>/dev/null) || exit 0
SID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null) || exit 0
LEDGER_DIR=$(context_ledger_dir "$SID") || exit 0

# --- Transcript resolution chain (spec §4.2) --------------------------------
# 1) stdin  2) cwd-INDEPENDENT glob, newest-mtime candidate wins  3) none.
# The glob is required rather than a computed path: the project dir is cwd-derived and
# moves on worktree entry, so a computed path misses exactly the worktree-heavy sessions
# this project runs. A session can leave stale transcripts under more than one project dir
# (main checkout plus worktrees); picking the lexicographically-first match can pick a
# stale one, defeating the point of the glob, so every candidate is compared and the most
# recently modified one wins.
TRANSCRIPT=$(printf '%s' "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
if [ -z "$TRANSCRIPT" ] || [ ! -r "$TRANSCRIPT" ]; then
  TRANSCRIPT=""
  BEST_MTIME=-1
  # `${HOME:-}`, not `"$HOME"`. Under `set -u` a bare expansion ABORTS when HOME is unset,
  # which is reachable: an absolute XDG_STATE_HOME with no CONTEXT_LEDGER_ROOT lets
  # context_ledger_dir succeed without ever touching HOME, so control arrives here and the
  # hook dies with "HOME: unbound variable", exit 1 and stderr out of a PreCompact hook --
  # breaking this file's own header contract that every failure path exits 0 with no
  # output. An empty prefix makes the glob match nothing and TRANSCRIPT stays empty, which
  # is the intended degrade. Same treatment context-ledger-path.sh already gives HOME.
  for cand in "${HOME:-}"/.claude/projects/*/"$SID".jsonl; do
    [ -r "$cand" ] || continue
    CAND_MTIME=$(stat -f %m "$cand" 2>/dev/null) || CAND_MTIME=$(stat -c %Y "$cand" 2>/dev/null) || CAND_MTIME=0
    case "$CAND_MTIME" in ''|*[!0-9]*) CAND_MTIME=0 ;; esac
    if [ "$CAND_MTIME" -gt "$BEST_MTIME" ]; then
      BEST_MTIME=$CAND_MTIME
      TRANSCRIPT="$cand"
    fi
  done
fi

# Refuse a ledger path that is not ours BEFORE reading either tier. curated.md is the
# entry point that bypasses redact_secrets/entropy_net, so a planted one is folded into
# the digest verbatim.
#
# AN EARLIER VERSION OF THIS COMMENT SAID "Nothing escapes today -- the only consumer is
# the resume.md write the guards below refuse". THAT WAS FALSE AND IT HID A LIVE LEAK for
# four review passes. Those guards refuse when the DIRECTORY, resume.md or resume.md.tmp
# are not ours -- a different set of paths from the one being read. With all three
# legitimate and a symlink only at curated.md, the digest is written and the reader emits
# the linked file. The leaf is now guarded at its own read below; do not re-derive a
# safety claim for one path from checks that cover others.
# NOT redundant with the write-time checks below: this one is about what we READ.
#
# DO NOT DELETE THE WRITE-TIME DIRECTORY CHECK BECAUSE A MUTATION SWEEP CALLS IT DEAD.
# Measured after this line was added: dropping the write-time one alone leaves the suite
# at 79/0, because this one already refused; dropping this one alone likewise. Only
# dropping BOTH reddens "the digest writer deposited into a symlinked directory". They are
# deliberate defence in depth across the read/write split, not one guard written twice --
# a single test row cannot distinguish that from redundancy, so the note has to.
context_ledger_path_ok "$LEDGER_DIR" || exit 0

CURATED=""
# Bounded at 2048 bytes, keeping the MOST RECENT entries. The curated tier grows one line
# per ledger-note.sh call and is otherwise unbounded. `tail -c 2048` is a byte cut, so when
# it actually truncates the file it can land mid-line; `tail -n +2` then drops that partial
# first line. Only applied when the file is actually larger than the window — otherwise a
# small curated.md would lose its genuine first line for no reason.
# GUARD THE LEAF, not just the directory. The directory check above tests the DIRECTORY;
# it says nothing about this file. Measured: with a genuine, non-symlink, we-own-it ledger
# directory at mode 0700 and a symlink planted ONLY at curated.md, every other guard in
# this file passes, the digest is written, and session-resume-ledger.sh emits the LINKED
# file's contents into additionalContext -- attacker-authored text reaching model input,
# which is the injection half of the exact defect this file exists to close. Controls in
# the same run: a regular curated.md carried the marker, a benign one did not, and a
# symlinked DIRECTORY was refused.
#
# WIDER THAN THE DOCUMENTED SAME-UID ANCESTOR RESIDUAL, because context_ledger_path_ok
# tests `-L` and `-O` but never MODE: a mode-loose-but-ours ledger directory -- a $HOME
# restored by a backup that dropped modes, or the shared NFS $HOME this repo's own path
# helper names -- admits a CROSS-uid plant at this leaf. And curated.md is the tier that
# bypasses redact_secrets/entropy_net.
#
# GATED ON THE TIER READ, deliberately, not bolted on as `|| exit 0`: a refused curated.md
# must empty only THIS tier while the mechanical floor still writes, because dropping the
# whole digest would turn a planted file into a denial of the ledger.
if context_ledger_path_ok "$LEDGER_DIR/curated.md" && [ -r "$LEDGER_DIR/curated.md" ]; then
  # `wc -c` pads its number with leading spaces (BSD and GNU both), which the digit-only
  # guard below would otherwise treat as "not a number" and zero out — silently disabling
  # this whole check. Strip whitespace before validating.
  CSIZE=$(wc -c < "$LEDGER_DIR/curated.md" 2>/dev/null | tr -d '[:space:]') || CSIZE=0
  case "$CSIZE" in ''|*[!0-9]*) CSIZE=0 ;; esac
  if [ "$CSIZE" -gt 2048 ]; then
    # `tail -n +2` drops the partial first line — but when that ONE partial line is the
    # entire 2048-byte window (a single curated row over 2048 bytes on its own), dropping
    # it leaves nothing. A row that big already can't be salvaged as a clean line, but an
    # empty curated tier is worse: it silently discards every other (intact) row that
    # fits in the window too. Fall back to the raw cut rather than lose the whole tier.
    CUT=$(tail -c 2048 "$LEDGER_DIR/curated.md" 2>/dev/null)
    CURATED=$(printf '%s\n' "$CUT" | tail -n +2)
    [ -n "$CURATED" ] || CURATED="$CUT"
  else
    CURATED=$(cat "$LEDGER_DIR/curated.md" 2>/dev/null)
  fi
fi

FLOOR=""
if [ -n "$TRANSCRIPT" ]; then
  # One row per Bash call: description, command, AND a short tail of what the command
  # RETURNED. `tool_use` (id) and `tool_result` (tool_use_id) records are the same string,
  # so they join — no new hook, no per-call cost, all extracted from the transcript this
  # hook already reads. Read as raw lines (`-R`) and parse each with `fromjson?` so one
  # malformed line degrades instead of aborting extraction of every record after it —
  # feeding the whole file to a plain `jq -r` parses it as one JSON stream, and a parse
  # error partway through silently drops every record that follows. `// ""` on
  # .input.command mirrors the guard .input.description already had, so a Bash record
  # missing a command degrades instead of erroring. The second `// ""` after the index
  # matters too: `"" | split("\n")` is `[]` in jq, so indexing `[0]` on a missing command
  # is an out-of-bounds `null` — without this guard the floor line would show the literal
  # text "null" instead of degrading cleanly to empty. `content_text` flattens the two
  # shapes a real transcript's tool_result.content actually takes: a plain string (Bash)
  # or an array of {type,text} blocks (MCP tools) — `.content // ""` covers a tool_result
  # with no content field at all. `gsub("\t";" ")` on every captured field keeps these rows
  # genuinely tab-separated for the awk join below; a literal tab in captured text would
  # otherwise misalign it. Clamps here (300/2000/2000) are deliberately generous, NOT the
  # final display width — redaction below needs the whole token intact to pattern-match;
  # cutting to the 60/100-char display width first would slice a secret into a fragment
  # too short to match its own pattern, leaking half of it. format_floor applies the real
  # display clamp (in jq, so it slices by Unicode codepoint like the rest of this file, not
  # by byte like an awk substr would) only after redaction has already run.
  # `tail -n 12` mirrors session-recent-issues.sh's cap; dedup via awk keeps repeats out.
  # Reversed first (pure-awk reverse — no GNU `tac`, and BSD `tail -r` doesn't exist on the
  # ubuntu-latest CI runner this hook's own tests run under; CI has no prior tail -r/tac use
  # to fall back on) so awk's "keep first occurrence" keeps each distinct command's MOST
  # RECENT run, not its earliest; capping via awk (not `head`, which can exit before
  # draining its stdin and hand the writer SIGPIPE under `pipefail`) then keeps by true
  # recency; the trailing reverse restores chronological (oldest-of-the-kept-first) order.
  rev_lines() { awk '{ a[NR]=$0 } END { for (i=NR; i>=1; i--) print a[i] }'; }

  # U/R join: keyed on tool_use id, done in awk (not jq) so the whole extraction stays one
  # streaming pass with no buffering of the transcript. Emits "desc\tcmd\tresult" — the id
  # has done its job and is dropped here, so redact_secrets below never risks touching a
  # join key. A U with no matching R (call still in flight, or a truncated transcript)
  # degrades to "(no result)"; a U whose R matched but carried empty output (e.g. `mkdir
  # -p`, which prints nothing) is distinguished as "(empty)" rather than collapsing into
  # the same placeholder as "never got a result at all". Falls back to a synthetic
  # per-line key ("U<NR>") when `.id` is missing so distinct id-less records can't collide
  # into one slot and silently overwrite each other.
  join_ur() {
    awk -F'\t' '
      $1=="U" {
        id = ($2!="") ? $2 : ("U" NR)
        desc[id]=$3; cmd[id]=$4
        if (!(id in seen)) { seen[id]=1; order[++n]=id }
        next
      }
      $1=="R" { res[$2]=$3; matched[$2]=1; next }
      END {
        for (i=1; i<=n; i++) {
          id=order[i]
          if (id in matched) { r = (res[id]=="") ? "(empty)" : res[id] } else { r = "(no result)" }
          print desc[id] "\t" cmd[id] "\t" r
        }
      }
    '
  }

  # Secrets now land in this file because captured RESULT text can carry them (env dumps,
  # curl auth headers, a printed token) in a way a bare command line rarely did. Redact
  # VISIBLY ("[redacted]") rather than dropping the row silently, so a reader can tell
  # something was removed. Runs on the id-free "desc\tcmd\tresult" rows from join_ur —
  # after the join (so a long id can never be mistaken for a secret and corrupt the join)
  # but before format_floor's display clamp (so a token isn't sliced in half first, see
  # above). `#` as the sed delimiter throughout, since several patterns contain `/`.
  #
  # CRITICAL ORDERING RULE, learned the hard way (round 4 of this feature): the
  # UUID/SHA sentinel-protection rules below MUST run LAST in this sed chain, after every
  # named-secret-prefix rule (sk-/ghp_/github_pat_/AKIA/eyJ/Bearer/NAME=value). An earlier
  # version ran them FIRST and shipped a real regression, reproduced end-to-end through this
  # hook: a secret that IS or CONTAINS an exempted shape — e.g. `sk-<40 hex chars>`, or
  # `ghp_<40 hex chars>` — got its hex portion sentinel-fragmented before the sk-/ghp_ rule
  # ever saw it, so that rule matched only a truncated remainder (or nothing), and the
  # digest showed a `[redacted]` marker sitting next to the LEAKED rest of the real secret —
  # worse than no filter at all, because the marker reads as "handled". Running the
  # prefix rules first means they always see the intact original token and either consume
  # the whole thing (sk-/ghp_/Bearer's own char classes already include hex, so a greedy
  # match swallows the entire secret, sentinel-shape and all) or don't match at all; the
  # protect rules only ever see what's left AFTER that, so a genuine bare identifier (no
  # recognized secret prefix around it) is the only thing they can find to protect.
  #
  # PROTECT_SENTINEL (0x1F, "unit separator") and SHA_SENTINEL (0x1E, "record separator") —
  # neither is a character any real command/output is ever expected to contain, and both are
  # outside every pattern's own character class above — mark text the LATER generic net must
  # not reach, without deleting or renaming it. A canonical UUID (session/task ids
  # throughout this project: `8-4-4-4-12` lowercase hex) is confirmed, against a real
  # transcript, to be swept up by the generic net purely because it is 36 unbroken
  # alnum/dash characters — it is not a secret, it is an identifier, and redacting it made
  # the digest noisy without protecting anything. Splitting it into its five
  # hyphen-delimited hex groups (max 12 chars each, all under the net's 32-char floor) by
  # swapping its hyphens for PROTECT_SENTINEL is enough to make the net skip straight over
  # it; restore_protected (after the net has run) swaps PROTECT_SENTINEL back to `-`, since a
  # 1-for-1 character swap can't shift anything else's position.
  #
  # A git commit SHA is the same problem one exemption away, confirmed against a real PR
  # review comment: `f80a9a1d847ed098f292b96d77eefa3a745a3c06` (bare 40-char SHA-1) rendered
  # as `[redacted]`, indistinguishable from an actual scrubbed secret — for a floor whose
  # whole point is carrying measured facts across a compaction, a commit hash is one of the
  # single most common such facts. Unlike a UUID, a SHA has no hyphens to swap out, so
  # SHA_SENTINEL is INSERTED (not swapped) at fixed offsets to fragment it, then DELETED
  # (not converted to `-`) by restore_protected — a different sentinel from PROTECT_SENTINEL
  # specifically so the two restore rules can't collide (deleting one would silently eat any
  # real `-` the other rule left behind, and vice versa). Matched only at exactly 40 hex
  # characters (git's SHA-1 length — this repo's actual commit-hash length), and only when
  # bounded on both sides by a non-hex character or start/end of string — the boundary
  # requirement is what stops the rule from partially matching inside a longer run (a
  # 64+-char value, or an actual 41+-char secret that happens to start with 40 hex
  # characters): the character immediately after position 40 would itself be hex, failing
  # the "non-hex or end" half of the boundary, so the rule simply does not fire there. Short
  # SHAs (7-12 chars, the common `git log --oneline` form) need no exemption at all —
  # already under the net's 32-char floor, confirmed by test.
  #
  # Deliberately 40 ONLY, not 64: an earlier version of this exemption also covered 64 hex
  # characters (SHA-256). Dropped on explicit user decision, not an oversight — do not
  # "helpfully" restore it. This repo's git history uses SHA-1, so every real commit hash
  # here is 40 characters; exempting 64 bought nothing in practice while 64 hex characters
  # is exactly the shape `openssl rand -hex 32` produces — the canonical form of a
  # webhook-signing secret or a `JWT_SECRET`-style value. Keeping only the length this repo
  # actually needs removes a higher-risk exemption shape for no real loss. Also NOT extended
  # to MD5 (32 hex): 32 sits exactly at the net's own threshold, and every additional
  # exemption shape is one more place a genuine secret of that exact shape would be let
  # through — this stays scoped to the one git hash length this project's commits use, not a
  # general hash allowlist.
  PROTECT_SENTINEL=$'\x1f'
  SHA_SENTINEL=$'\x1e'
  redact_secrets() {
    sed -E \
      -e 's#sk-[A-Za-z0-9_-]{10,}#[redacted]#g' \
      -e 's#ghp_[A-Za-z0-9]{20,}#[redacted]#g' \
      -e 's#github_pat_[A-Za-z0-9_]{20,}#[redacted]#g' \
      -e 's#AKIA[A-Z0-9]{16}#[redacted]#g' \
      -e 's#eyJ[A-Za-z0-9_.=-]{15,}#[redacted]#g' \
      -e 's#([Bb]earer)[[:space:]]+[A-Za-z0-9._~+/=-]{8,}#\1 [redacted]#g' \
      -e 's#([A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|CREDENTIAL|PRIVATE_KEY)[A-Za-z0-9_]*)=[^[:space:]]+#\1=[redacted]#g' \
      -e "s/([0-9a-fA-F]{8})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-([0-9a-fA-F]{12})/\\1${PROTECT_SENTINEL}\\2${PROTECT_SENTINEL}\\3${PROTECT_SENTINEL}\\4${PROTECT_SENTINEL}\\5/g" \
      -e "s/([^0-9a-fA-F]|^)([0-9a-fA-F]{10})([0-9a-fA-F]{10})([0-9a-fA-F]{10})([0-9a-fA-F]{10})([^0-9a-fA-F]|\$)/\\1\\2${SHA_SENTINEL}\\3${SHA_SENTINEL}\\4${SHA_SENTINEL}\\5${SHA_SENTINEL}\\6/g"
  }

  # Generic high-entropy net: 32+ unbroken alnum/+/-/_ chars, but ONLY when the run also
  # contains a digit. A real transcript showed this net swallowing plain kebab-case project
  # directory slugs (e.g. `-Users-williamtower-projects-OCRecipes`, from this floor's own
  # `cd /Users/…` rows) — confirmed by testing the SAME sed rule against that exact string
  # in isolation; nothing else in redact_secrets can match it, so it was this net alone. A
  # random secret drawn from a 62+-character alphabet over 32+ characters contains a digit
  # with overwhelming probability (>99.9%); a compound English identifier built from
  # hyphen-joined words routinely does not. Requiring a digit is the cheapest available
  # discriminator between the two without hand-listing every non-secret shape. POSIX ERE has
  # no lookahead, so "32+ chars AND contains a digit" isn't expressible as one sed pattern —
  # done in awk instead: scan each line for maximal `{32,}` runs (`match`/`substr`/`RSTART`/
  # `RLENGTH` are POSIX awk, no gawk extension), and only replace a run that itself matches
  # `[0-9]`. This runs AFTER redact_secrets (so it never re-matches text already turned into
  # "[redacted]") and BEFORE restore_protected (so a protected UUID's hex groups — all ≤12
  # chars — and a protected SHA's fragments — all ≤10 chars — never re-assemble into one
  # matchable run here; scanning after restoring them would rebuild the full digit-bearing
  # original and this net would redact it anyway).
  entropy_net() {
    awk '
      {
        rest = $0; out = ""
        while (match(rest, /[A-Za-z0-9+_-]{32,}/)) {
          out = out substr(rest, 1, RSTART-1)
          cand = substr(rest, RSTART, RLENGTH)
          out = out (cand ~ /[0-9]/ ? "[redacted]" : cand)
          rest = substr(rest, RSTART+RLENGTH)
        }
        print out rest
      }
    '
  }

  # Two independent restores, deliberately in this order and via two separate `tr` passes
  # (one substitution, one deletion — a single `tr` mapping cannot do both): PROTECT_SENTINEL
  # (UUID) becomes `-` again; SHA_SENTINEL (SHA) is simply deleted, since it was INSERTED
  # rather than swapped for an existing character and restoring it must shrink the string
  # back to the original, not leave a stray character in the middle of a hex digest.
  restore_protected() { tr "$PROTECT_SENTINEL" '-' | tr -d "$SHA_SENTINEL"; }

  # The Bash tool appends its own trailing notice about shell state after the real output —
  # "Session cwd remains …" (a backgrounded run whose cd did not survive) and "Shell cwd was
  # reset to …" (a foreground run whose cd got reverted). Confirmed against real transcripts:
  # this notice is always the LAST line when present, and can trail genuinely useful
  # preceding output (an ls listing, a tarball inspection) that a plain "last non-empty line"
  # pick would hide entirely. Filtered out in the jq extraction below before the tail is
  # taken. "Command running in background with ID: …" is deliberately NOT filtered — checked
  # against real transcripts, it is always the WHOLE content with nothing real preceding it,
  # so skipping it would trade real information for the (empty)/(no result) placeholder
  # instead of recovering anything underneath.

  # Final display clamp — same 60/100 widths the pre-result floor used for description and
  # command, plus 60 for the new result tail. Done in jq (not awk substr) so the cut is by
  # Unicode codepoint, matching how the rest of this file already slices text, rather than
  # by byte.
  format_floor() {
    jq -R -r '
      split("\t") as $f
      | "  \($f[0][0:60] // "") ← \($f[1][0:100] // "") → \($f[2][0:60] // "")"
    '
  }

  FLOOR=$(jq -R -r '
      def content_text:
        if type=="string" then .
        elif type=="array" then (map(if type=="object" then (.text? // "") else (.|tostring) end) | join(" "))
        else (.|tostring) end;
      fromjson?
      | if (.type // "")=="assistant" then
          (.message.content[]? | select(.type=="tool_use" and .name=="Bash")
            | "U\t\(.id // "")\t\((.input.description // "(no description)") | gsub("\t";" ") | .[0:300])\t\((.input.command // "") | split("\n")[0] // "" | gsub("\t";" ") | .[0:2000])")
        elif (.type // "")=="user" then
          (.message.content[]? | select(.type=="tool_result")
            | "R\t\(.tool_use_id // "")\t\((.content // "") | content_text | gsub("\t";" ") | split("\n") | map(select(length>0)) | map(select((test("^Session cwd remains ") or test("^Shell cwd was reset to ")) | not)) | (.[-1] // "") | .[0:2000])")
        else empty end
    ' "$TRANSCRIPT" 2>/dev/null | join_ur | redact_secrets | entropy_net | restore_protected | format_floor | rev_lines | awk '!seen[$0]++' | awk 'NR<=12' | rev_lines)
fi

# Both tiers empty -> write nothing. Spec §9: emitting "nothing captured" would spend
# post-compact budget to convey no information.
if [ -z "$CURATED" ] && [ -z "$FLOOR" ]; then
  exit 0
fi

# --- Assemble, then measure (spec §5.2's 4KB hard cap) -----------------------
# A cap enforced only on the INPUTS (tail -c 2048, tail -n 12, per-field clamps) is only as
# good as the arithmetic behind it — that arithmetic assumed the floor stays ~1.8KB, and a
# realistic fixture (long-but-legal descriptions, 12 distinct Bash calls) broke it: 4329
# bytes against the 4096 cap. The bound that can't be defeated by an input the arithmetic
# failed to anticipate is one measured on the assembled OUTPUT: build the digest, measure
# it, and while it's still over cap drop the oldest FLOOR row first (mechanical, disposable
# scaffolding) — only once the floor is exhausted does the oldest CURATED row (verified
# fact) start giving way. Re-measure after every drop; write only once it fits.
assemble_digest() {
  echo "[CONTEXT LEDGER — verification state carried across compaction]"
  # If a later PreCompact run exits without writing (both tiers empty, or a timeout), this
  # file is left in place and gets injected as though it were current. It's still a real,
  # true digest of an earlier compaction — worth keeping (fail-open asymmetry) — but a
  # reader needs to be able to tell it's stale, hence the timestamp.
  echo "Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Native compaction preserves the narrative. This carries what it cannot: which"
  echo "facts were MEASURED vs ASSUMED. Re-verify before relying on an ASSUMED line."
  if [ -n "$CURATED" ]; then
    echo ""
    printf '%s\n' "$CURATED"
  fi
  if [ -n "$FLOOR" ]; then
    echo ""
    echo "MECHANICAL FLOOR — commands run this session (most recent 12)"
    echo "NOTE: these record what RAN, not what was concluded. Not a verification tier."
    printf '%s\n' "$FLOOR"
  fi
  echo ""
  echo "Full history: session ${SID} — glob ~/.claude/projects/*/${SID}.jsonl"
  echo "(the recorded path may not resolve if this session entered a worktree)"
}

digest_size() {
  # Same leading-space padding from `wc -c` applies here; strip it before the caller's
  # digit-only guard runs, or the measured-trim loop below never sees a size over the cap.
  printf '%s\n' "$1" | wc -c | tr -d '[:space:]'
}

DIGEST=$(assemble_digest)
DSIZE=$(digest_size "$DIGEST") || DSIZE=0
case "$DSIZE" in ''|*[!0-9]*) DSIZE=0 ;; esac

while [ "$DSIZE" -gt 4096 ]; do
  if [ -n "$FLOOR" ]; then
    FLOOR=$(printf '%s\n' "$FLOOR" | tail -n +2)
  elif [ -n "$CURATED" ]; then
    CURATED=$(printf '%s\n' "$CURATED" | tail -n +2)
  else
    break
  fi
  DIGEST=$(assemble_digest)
  DSIZE=$(digest_size "$DIGEST") || DSIZE=0
  case "$DSIZE" in ''|*[!0-9]*) DSIZE=0 ;; esac
done

# Refuse a path that is not ours before creating or writing. Without this, a symlinked
# ledger directory made `mkdir -p` a no-op (it succeeds on the existing link) and this
# writer deposited the session's digest INSIDE the attacker's directory — a VERIFIED claim
# and a mechanical-floor row carrying a command and its output tail. That is the
# exfiltration half of the same defect the reader's guards close on the injection half.
context_ledger_path_ok "$LEDGER_DIR" || exit 0
(umask 077; mkdir -p "$LEDGER_DIR") 2>/dev/null || exit 0
context_ledger_path_ok "$LEDGER_DIR/resume.md" || exit 0
# EVERY path this writer creates needs its own check, and resume.md.tmp is the one it
# creates FIRST. Guarding only the final name left the real target open: measured, with a
# symlink planted at resume.md.tmp inside a genuine, non-symlink, we-own-it ledger
# directory -- so both checks above pass -- the digest wrote straight THROUGH the link,
# and `mv` then renamed the SYMLINK into place. resume.md became attacker-controlled, the
# reader's own `-L` check refused it from then on, and this session's real digest was
# lost permanently. Checking the name a file ends up under is not checking the file the
# code opens.
context_ledger_path_ok "$LEDGER_DIR/resume.md.tmp" || exit 0
# Write to a temp file and rename into place: a kill mid-write (e.g. a timeout) cannot
# leave a truncated resume.md that the reader's `[ -s ]` check would accept as whole.
printf '%s\n' "$DIGEST" > "$LEDGER_DIR/resume.md.tmp" 2>/dev/null || exit 0
mv "$LEDGER_DIR/resume.md.tmp" "$LEDGER_DIR/resume.md" 2>/dev/null || exit 0

exit 0
