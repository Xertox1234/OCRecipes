#!/usr/bin/env bash
# REST retry for `gh pr view <ref> --json …`.
#
# Why: `gh pr view --json` is a GraphQL call, and a Claude Code cloud session refuses GraphQL
# ("HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API").
# Every caller that reads a PR that way goes blind there. This is the one place that asks the
# REST API instead and answers in `gh pr view`'s own field names, so a caller keeps its parsing:
#
#   VIEW=$(gh pr view "$REF" --json number,state 2>/dev/null) || VIEW=$(gh_pr_rest_json "$REF")
#
# usage: gh_pr_rest_json <ref>
#   ref = a PR number, a PR URL, a branch name, <owner>:<branch> (a fork's branch), or ''
#         (the current branch)
# stdout (rc 0 only): {"number","url","title","state","mergedAt","headRefOid",
#                      "headRefName","baseRefName","body","changedFiles"}
#   state is OPEN | CLOSED | MERGED, as `gh pr view` prints it (REST says closed + merged_at).
#   body is "" when the PR has none. changedFiles is a number for a PR NUMBER or URL ref; for a
#   BRANCH ref it is null, because GitHub's PR list leaves the count out: ask by number for it.
# rc 0  found
# rc 1  the lookup worked and there is NO pull request for this branch
# rc 2  could not look (gh failed, an answer that is not a PR, a ref this cannot key on)
# Callers warn differently on 1 and 2, so an error must never be reported as "no PR".
#
# A branch can have several PRs (a reused branch name). Like `gh pr view`: the open one, else
# the newest. A full first page (100) is followed by a read of every page.
#
# Forks, after `gh pr view`:
#   - a bare branch name is THIS repository's branch. A fork's PR under the same name is never
#     an answer to it (rc 2 if GitHub lists one).
#   - <owner>:<branch> is that owner's branch: the PR whose head is theirs.
#   - '' (the current branch) asks this repository first. Only when that says "no PR", and the
#     branch has a NAMED push remote on gh's host, is that remote's repository asked as well,
#     and only a PR whose head is that repository counts. Narrower than gh: no fallback to
#     `origin`, and a branch whose remote is a bare URL (as `gh pr checkout` writes for a fork
#     PR) is not followed. Both read as "no PR", as before forks were handled at all.
#
# The caller decides which HOSTS a URL ref may name before calling (pr-verify.sh and
# git-safety.sh both restrict to the configured GitHub host). This function only reads
# owner/repo/number out of a URL; `gh api` then talks to gh's configured host, never the URL's.
#
# Tests: .claude/hooks/test-gh-pr-rest.sh

# Every byte as %xx. gh fills placeholders anywhere in an endpoint or a -F value — {owner},
# {repo}, {branch} and the legacy :owner, :repo, :branch — so `head={owner}:<name>` turned a
# branch called repo-cleanup into "<repo name>-cleanup" and x{repo}y into some other branch.
# Encoding EVERY byte of a name leaves nothing in it for gh to match.
_gh_pr_rest_enc() {
  printf '%s' "$1" | od -v -An -tx1 | tr -d ' \n' | sed 's/../%&/g'
}

# The repository the current branch is pushed to, as "<owner>/<repo>", from git's own
# push-remote order (branch.<name>.pushRemote, remote.pushDefault, branch.<name>.remote) and
# that remote's URL. rc 1 when there is no such remote, its URL is not <host>/<owner>/<repo>,
# or the host is not the one gh talks to (GH_HOST, else github.com): an owner on another host
# is a different account, and the same login on GitHub can be anyone.
_gh_pr_rest_push_repo() {
  local branch="$1" remote url host want
  remote=$(git config --get "branch.$branch.pushRemote" 2>/dev/null) \
    || remote=$(git config --get remote.pushDefault 2>/dev/null) \
    || remote=$(git config --get "branch.$branch.remote" 2>/dev/null) || return 1
  url=$(git remote get-url --push "$remote" 2>/dev/null) || return 1
  url="${url%/}"; url="${url%.git}"
  # <scheme>://[<user>@]<host>[:<port>]/<owner>/<repo> or [<user>@]<host>:<owner>/<repo>, and
  # nothing looser: a local path such as /srv/git/r must not read as owner "git".
  if [[ "$url" =~ ^[A-Za-z][A-Za-z0-9+.-]*://([^/]+)/([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9._-]+)$ ]]; then
    host="${BASH_REMATCH[1]}"; host="${host##*@}"; host="${host%%:*}"
  elif [[ "$url" =~ ^([^/:]+):([A-Za-z0-9][A-Za-z0-9-]*)/([A-Za-z0-9._-]+)$ ]]; then
    host="${BASH_REMATCH[1]}"; host="${host##*@}"
  else
    return 1
  fi
  want="${GH_HOST:-github.com}"
  [ "$(printf '%s' "$host" | tr 'A-Z' 'a-z')" = "$(printf '%s' "$want" | tr 'A-Z' 'a-z')" ] || return 1
  printf '%s/%s\n' "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"
}

# usage: _gh_pr_rest_branch <owner or ''> <branch> [<owner>/<repo>]
# Prints the chosen PR as GitHub's REST object. rc 0 found | 1 no PR | 2 could not look.
# owner '' means this repository's own branch. A third argument also pins the head REPOSITORY.
_gh_pr_rest_branch() {
  local owner="$1" ref="$2" repo_lc="" enc head_owner='{owner}' owner_lc="" list raw pick
  repo_lc=$(printf '%s' "${3:-}" | tr 'A-Z' 'a-z')
  enc=$(_gh_pr_rest_enc "$ref") || return 2
  [ -n "$enc" ] || return 2
  if [ -n "$owner" ]; then
    head_owner=$(_gh_pr_rest_enc "$owner") || return 2
    [ -n "$head_owner" ] || return 2
    owner_lc=$(printf '%s' "$owner" | tr 'A-Z' 'a-z')
  fi
  # The one {owner} gh may fill is the base repository's; a named owner goes encoded.
  list="repos/{owner}/{repo}/pulls?state=all&per_page=100&head=$head_owner%3A$enc"
  raw=$(gh api "$list" 2>/dev/null) || return 2
  # GitHub ignores a head filter it cannot parse and lists every PR, so a row for another
  # branch means the filter was not applied: that is "could not look", not "found". The same
  # for a row whose head is not where it was asked for:
  #   no owner named → the head repository must BE the base repository (a fork, or a deleted
  #                    one whose head repo is null, is not this repository's branch);
  #   an owner named → the head must be that owner's (logins compare without case);
  #   a repository named too → the head repository must be that one. One login can hold
  #                    several repositories with a same-named branch, and a null head repo
  #                    (deleted) is not it.
  # -s: gh prints paged output as one array or as one array per page, by version; this
  # reads either, and anything that is not an array (an error object) is "could not look".
  pick='
    if length == 0 or any(.[]; type != "array") then error("not a list") else add end
    | if length == 0 then "none"
      elif all(.[]; .head.ref == $b and
                    (if $o == "" then .head.repo.full_name == .base.repo.full_name
                     elif $r != "" then ((.head.repo.full_name // "") | ascii_downcase) == $r
                     else ((.head.user.login // "") | ascii_downcase) == $o end))
        then {n: length, pr: (map(select(.state == "open"))[0] // .[0])}
      else error("head filter not applied") end'
  raw=$(printf '%s' "$raw" | jq -cs --arg b "$ref" --arg o "$owner_lc" --arg r "$repo_lc" "$pick" 2>/dev/null) || return 2
  # GitHub pages this list at 100, so a FULL page may not be all of it, and stopping there
  # could miss the open PR and answer with a closed one. Read every page then — only after
  # the filter check above passed, so an ignored filter never pages the whole repository.
  if [ "$(printf '%s' "$raw" | jq -r '.n? // 0' 2>/dev/null)" = 100 ]; then
    raw=$(gh api --paginate "$list" 2>/dev/null) || return 2
    raw=$(printf '%s' "$raw" | jq -cs --arg b "$ref" --arg o "$owner_lc" --arg r "$repo_lc" "$pick" 2>/dev/null) || return 2
  fi
  [ "$raw" != '"none"' ] || return 1
  printf '%s' "$raw" | jq -c '.pr' 2>/dev/null || return 2
}

gh_pr_rest_json() {
  local ref="${1:-}" raw rest owner="" push_repo from_current=0 rc
  local norm='{number, url: .html_url, title,
    state: (if .merged_at != null then "MERGED" else (.state | ascii_upcase) end),
    mergedAt: .merged_at, headRefOid: .head.sha,
    headRefName: .head.ref, baseRefName: .base.ref, body: (.body // ""),
    changedFiles: .changed_files}
    | select((.number | type) == "number" and (.headRefOid | type) == "string")'

  if [ -z "$ref" ]; then
    ref=$(git branch --show-current 2>/dev/null) || ref=""
    [ -n "$ref" ] || return 2
    from_current=1
  fi

  case "$ref" in
    -*) return 2 ;;
    *://* | //*)
      # https://<host>/<owner>/<repo>/pull/<n>[/…] and nothing else
      rest="${ref#*://}"
      [ "$rest" != "$ref" ] || return 2
      # Owner and repo must start with a letter or digit: gh sends the path as written, so
      # a `.` or `..` segment would walk it somewhere else.
      if [[ "$rest" =~ ^[^/]+/([A-Za-z0-9][A-Za-z0-9._-]*)/([A-Za-z0-9][A-Za-z0-9._-]*)/pull/([0-9]+)(/.*)?$ ]]; then
        raw=$(gh api "repos/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}/pulls/${BASH_REMATCH[3]}" 2>/dev/null) || return 2
      else
        return 2
      fi
      ;;
    *:*)
      # <owner>:<branch>, a fork's branch. A git branch name cannot hold a colon, so exactly
      # one, with a GitHub login (letters, digits, hyphens) before it and a name after it.
      [ "$from_current" = 0 ] || return 2
      owner="${ref%%:*}"; ref="${ref#*:}"
      [[ "$owner" =~ ^[A-Za-z0-9][A-Za-z0-9-]*$ ]] || return 2
      case "$ref" in '' | *:* | -*) return 2 ;; esac
      raw=$(_gh_pr_rest_branch "$owner" "$ref") || return $?
      ;;
    *[!0-9]*)
      # A branch of this repository.
      rc=0
      raw=$(_gh_pr_rest_branch "" "$ref") || rc=$?
      # Nothing here, and the caller asked for "the current branch": it may be pushed to a
      # fork, whose PR `gh pr view` would find. Ask for that repository's branch. A failure
      # of this second read is "could not look", never "no PR".
      if [ "$rc" = 1 ] && [ "$from_current" = 1 ] && push_repo=$(_gh_pr_rest_push_repo "$ref"); then
        rc=0
        raw=$(_gh_pr_rest_branch "${push_repo%%/*}" "$ref" "$push_repo") || rc=$?
      fi
      [ "$rc" = 0 ] || return "$rc"
      ;;
    *)
      raw=$(gh api "repos/{owner}/{repo}/pulls/$ref" 2>/dev/null) || return 2
      ;;
  esac

  raw=$(printf '%s' "$raw" | jq -ce "$norm" 2>/dev/null) || return 2
  [ -n "$raw" ] || return 2
  printf '%s\n' "$raw"
}
