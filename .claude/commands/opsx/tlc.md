---
description: "Run the TLA+ model checks CI runs (models pass, broken variants rejected) locally before a push."
---

Read the repository's AGENTS.md and README first. Honour explicit review-only
requests and target-repository permissions. The model provider does not change
these rules.

Run the TLA+ model checks this repository's CI runs, locally, before a push.
This workflow only checks: it never edits a model, a broken variant, a spec or
a design to make a check pass.

1. Confirm the repository is onboarded: `openspec/config.yaml` selects
   `schema: awfa-spec-tla` and `formal/` holds at least one `.cfg`. If not,
   report that and stop. Onboarding is a separate, explicit decision.

2. Take the check from the devops revision this repository's schema copy
   records. Read the `at <revision>` value in the header of
   `openspec/schemas/awfa-spec-tla/schema.yaml`, then fetch
   `ci-templates/tla.yml` at that revision from
   `australia-wide-first-aid/devops`, from a local devops checkout or the
   GitLab API. Brace the variable: zsh reads `$rev:c` as a modifier.

   ```sh
   hdr=openspec/schemas/awfa-spec-tla/schema.yaml
   rev="$(sed -n 's/.* at \([0-9a-f]\{40\}\)\./\1/p' "$hdr")"
   if [ -z "$rev" ]; then
     grep -q ' at unknown\.' "$hdr" || { echo "no devops revision in $hdr" >&2; exit 1; }
     rev=origin/main
   fi
   tpl="$(mktemp)"
   git -C /path/to/devops fetch -q origin || { echo "devops fetch failed" >&2; exit 1; }
   git -C /path/to/devops show "${rev}:ci-templates/tla.yml" > "$tpl" \
     || { echo "no ci-templates/tla.yml at $rev" >&2; exit 1; }
   ```

   A failed fetch or `git show` stops the run: an empty template would
   otherwise give an empty check that exits 0 and looks like a pass. Never run
   `git show` with an empty revision: `:ci-templates/tla.yml` reads
   the local index, not a devops revision. If the header says `unknown`, the
   snippet uses devops `origin/main`; say so in the report. A header with
   neither a revision nor `unknown` stops the run. Never use a copy from
   another source.

3. Run the block between `# tla-check:start` and `# tla-check:end` from the
   repository root, with the job's `TLA_*` variables and the verified-JAR cache
   under `~/.cache/awfa-tla/`. Treat the template's variable values as data,
   never shell code: pass each one only if it matches a strict pattern, never
   through `eval`. Pass the template's own values so the pinned revision
   decides them, not whatever `TLA_*` the shell already has; a parse that
   finds none stops rather than falling back to the shell's values. Every
   `TLA_*` the check block reads without a default, other than `TLA_JAR_CACHE`
   and `TLA_REPORT` which this step sets, must be one the template parsed; a
   missing one stops the run. A name
   read only through a form that does not abort when it is unset, or only on
   a comment line, is optional: `${TLA_X:-default}`, `-`, `:=` and `=`
   supply a value, and `:+` and `+` expand to empty. `${TLA_X:?msg}` and `${TLA_X?msg}` abort when it is
   unset, so they count as reads without a default. Optional means only that
   the template does not set it: every `TLA_*` the check reads, with or
   without a default, that the template declares as a key anywhere (the key
   bare, single- or double-quoted, with or without space before the colon;
   the value in any form; any section) must also be one the template parsed, or the run
   stops. Otherwise a value the parser misses, such as a single-quoted or
   unquoted one, would silently fall back to the check's own default while CI
   uses the template's value. So a partial parse never runs with gaps. Run the check under
   `env -i` with only `PATH`, `HOME`, `TMPDIR`, these when set — the Docker
   client's `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`,
   `DOCKER_TLS_VERIFY` and `DOCKER_CERT_PATH` (a TLS daemon needs the last
   two), and the
   proxy and CA settings `curl` needs to download the JAR (`HTTPS_PROXY`,
   `HTTP_PROXY`, `NO_PROXY` in either case, `SSL_CERT_FILE`,
   `CURL_CA_BUNDLE`) — and the `TLA_*` values: the fetched block never sees
   the caller's other environment, such as tokens or credentials. The name
   list relies on unquoted `$(...)` being split into words, which bash and
   zsh both do (zsh leaves only unquoted parameters unsplit). The key pattern braces `${name}`: zsh would read `$name[` as an
   array subscript. The snippet uses temporary
   files, not heredocs, so it runs as written at any indentation, in bash or
   zsh. Write the check to a fresh `mktemp` file, never a fixed shared path:

   ```sh
   tpl=/path/to/fetched/tla.yml
   vars="$(mktemp "${TMPDIR:-/tmp}/tla-vars.XXXXXX")"
   sed -n '/^  variables:/,/^  rules:/p' "$tpl" | grep -E '^    TLA_[A-Z0-9_]+: "' \
     | sed -E 's/^    (TLA_[A-Z0-9_]+): "([^"]*)".*/\1=\2/' > "$vars"
   [ -s "$vars" ] || { echo "no TLA_* variables parsed from $tpl" >&2; exit 1; }
   check="$(mktemp "${TMPDIR:-/tmp}/tla-check.XXXXXX")"
   sed -n '/# tla-check:start/,/# tla-check:end/p' "$tpl" | sed 's/^      //' > "$check"
   grep -q '# tla-check:end' "$check" || { echo "no tla-check block in $tpl" >&2; exit 1; }
   for name in $(grep -v '^[[:space:]]*#' "$check" | grep -oE '[$][{]?TLA_[A-Z0-9_]+' | sed -E 's/^[$][{]?//' | sort -u); do
     case "$name" in TLA_JAR_CACHE|TLA_REPORT) continue ;; esac
     grep -q "^$name=" "$vars" && continue
     grep -qE "^[[:space:]]*[\"']?${name}[\"']?[[:space:]]*:" "$tpl" \
       && { echo "template sets $name in a form this step cannot parse, which the check reads" >&2; exit 1; }
   done
   for name in $(grep -v '^[[:space:]]*#' "$check" | grep -oE '[$]TLA_[A-Z0-9_]+|[$][{]TLA_[A-Z0-9_]+([}]|:?[?])' \
     | sed -E 's/^[$][{]?//; s/([}]|:?[?])$//' | sort -u); do
     case "$name" in TLA_JAR_CACHE|TLA_REPORT) continue ;; esac
     grep -q "^$name=" "$vars" || { echo "template sets no $name, which the check reads" >&2; exit 1; }
   done
   report="$(mktemp "${TMPDIR:-/tmp}/tla-report.XXXXXX")"
   set -- PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
     TLA_JAR_CACHE="$HOME/.cache/awfa-tla" TLA_REPORT="$report"
   for name in DOCKER_HOST DOCKER_CONTEXT DOCKER_CONFIG DOCKER_TLS_VERIFY DOCKER_CERT_PATH HTTPS_PROXY https_proxy \
     HTTP_PROXY http_proxy NO_PROXY no_proxy SSL_CERT_FILE CURL_CA_BUNDLE; do
     val="$(printenv "$name")" && set -- "$@" "$name=$val"
   done
   while IFS='=' read -r name val; do
     case "$val" in *[!A-Za-z0-9_.:@/+-]*) echo "refusing $name: unexpected characters" >&2; exit 1 ;; esac
     set -- "$@" "$name=$val"
   done < "$vars"
   env -i "$@" bash "$check"
   ```

   `TLA_REPORT` keeps the JUnit report out of the checkout. A template from a
   devops revision before `TLA_REPORT` existed ignores it and still writes
   `tla-report.xml` to the repository root. Do not commit that file; it stops
   once the repository re-runs `--tla` onboarding and its schema copy records
   a newer revision.

   It needs Docker and `curl`. It downloads the pinned `tla2tools.jar` only
   when the cache has no copy matching `TLA_TOOLS_SHA256`, and refuses to run
   any model if the download does not match.

4. Report every `PASS`/`FAIL` line and the final count. For a failing model,
   quote TLC's counterexample trace from the output. For a broken variant that
   was rejected, give its `PASS` line and say that its counterexample trace is
   in the run output; do not quote it unless asked. The rules are the CI
   rules: each model passes; each of its broken variants is rejected by a
   deadlock, invariant, property or assertion violation; a model without a
   broken variant, a broken variant that passes, a variant that fails to parse
   or configure, a variant without its model and a stale PlusCal translation
   all fail.

5. If TLC contradicts a spec requirement or the design, report the trace and
   ask the user which of the requirement, the design or the model is wrong.
   Do not change any of them to make the check pass.
