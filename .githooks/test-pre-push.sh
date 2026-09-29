#!/bin/sh
# Smoke test for pre-push: each rule has a case that must block and one that must pass.
set -u
hooks=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail=0

git init -q --bare "$tmp/remote.git"
git init -q -b main "$tmp/work"
cd "$tmp/work" || exit 1
git config user.name test
git config user.email test@example.invalid
git config core.hooksPath "$hooks"
git remote add origin ../remote.git
commit() { echo "$1" >"$1"; git add "$1"; git commit -qm "$1"; }

expect() { # expect <pass|block> <description> <push args...>
	want=$1 what=$2
	shift 2
	if git push -q "$@" 2>/dev/null; then got=pass; else got=block; fi
	if [ "$got" = "$want" ]; then echo "ok    $what"; else echo "FAIL  $what (wanted $want, got $got)"; fail=1; fi
}

commit a
expect pass "first push of a linear main" origin main
git checkout -qb feat
commit b
git checkout -q main
commit c
git merge -q --no-ff feat -m "Merge feat"
expect block "merge commit pushed to main" origin main
expect block "merge commit pushed to main from another local branch" origin HEAD:refs/heads/main
expect pass "merge commit pushed to a branch that isn't main" origin main:main-refactor
git reset -q --hard HEAD~1
git rebase -q main feat
git checkout -q main
git merge -q --ff-only feat
expect pass "fast-forward of main" origin main

exit $fail
