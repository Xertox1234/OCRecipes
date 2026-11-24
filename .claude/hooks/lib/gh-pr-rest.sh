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
# usage: gh_pr_rest_json <ref>      ref = a PR number, a PR URL, a branch name, or '' (current branch)
# stdout (rc 0 only): {"number","url","title","state","mergedAt","headRefOid"}
#   state is OPEN | CLOSED | MERGED, as `gh pr view` prints it (REST says closed + merged_at).
# rc 0  found
# rc 1  the lookup worked and there is NO pull request for this branch
# rc 2  could not look (gh failed, an answer that is not a PR, a ref this cannot key on)
# Callers warn differently on 1 and 2, so an error must never be reported as "no PR".
#
# A branch can have several PRs (a reused branch name). Like `gh pr view`: the open one, else
# the newest. Every page of the list is read.
#
# The caller decides which HOSTS a URL ref may name before calling (pr-verify.sh and
# git-safety.sh both restrict to the configured GitHub host). This function only reads
# owner/repo/number out of a URL; `gh api` then talks to gh's configured host, never the URL's.
#
# Tests: .claude/hooks/test-gh-pr-rest.sh

gh_pr_rest_json() {
  local ref="${1:-}" raw rest enc
  local norm='{number, url: .html_url, title,
    state: (if .merged_at != null then "MERGED" else (.state | ascii_upcase) end),
    mergedAt: .merged_at, headRefOid: .head.sha}
    | select((.number | type) == "number" and (.headRefOid | type) == "string")'

  if [ -z "$ref" ]; then
    ref=$(git branch --show-current 2>/dev/null) || ref=""
    [ -n "$ref" ] || return 2
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
    *[!0-9]*)
      # A branch. gh fills placeholders anywhere in an endpoint or a -F value — {owner},
      # {repo}, {branch} and the legacy :owner, :repo, :branch — so `head={owner}:<name>`
      # turned a branch called repo-cleanup into "<repo name>-cleanup" and x{repo}y into some
      # other branch. Percent-encoding EVERY byte of the name (and the colon) leaves only the
      # one {owner} this line means, and nothing in the name for gh to match.
      enc=$(printf '%s' "$ref" | od -v -An -tx1 | tr -d ' \n' | sed 's/../%&/g') || return 2
      [ -n "$enc" ] || return 2
      # --paginate: GitHub pages this list at 100. Reading one page meant a branch name with
      # more PRs than that could miss its open PR and answer with a closed one.
      raw=$(gh api --paginate "repos/{owner}/{repo}/pulls?state=all&per_page=100&head={owner}%3A$enc" \
        2>/dev/null) || return 2
      # GitHub ignores a head filter it cannot parse and lists every PR, so a row for another
      # branch means the filter was not applied: that is "could not look", not "found". The
      # same for a row whose head lives in another repository (a fork, or a deleted one,
      # whose head repo is null): it is not this repository's branch.
      # gh prints the pages as one array or as one array per page, by version: -s reads
      # either, and anything that is not an array (an error object) is "could not look".
      raw=$(printf '%s' "$raw" | jq -cs --arg b "$ref" '
        if length == 0 or any(.[]; type != "array") then error("not a list") else add end
        | if length == 0 then "none"
        elif all(.[]; .head.ref == $b and .head.repo.full_name == .base.repo.full_name)
          then (map(select(.state == "open"))[0] // .[0])
        else error("head filter not applied") end' 2>/dev/null) || return 2
      [ "$raw" != '"none"' ] || return 1
      ;;
    *)
      raw=$(gh api "repos/{owner}/{repo}/pulls/$ref" 2>/dev/null) || return 2
      ;;
  esac

  raw=$(printf '%s' "$raw" | jq -ce "$norm" 2>/dev/null) || return 2
  [ -n "$raw" ] || return 2
  printf '%s\n' "$raw"
}
