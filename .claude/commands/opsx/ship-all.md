---
description: "Ship all open OpenSpec changes sequentially in dependency order with CI, AI review and cleanup."
---

Read the repository's AGENTS.md and README first. Honour explicit review-only
requests and target-repository permissions. These workflows apply to writable
development checkouts, not read-only investigations or unattended jobs whose
registry forbids writes. The model provider does not change these rules.

For genuinely new work, fetch origin and create a new branch or isolated
worktree from the freshly fetched `origin/main` before changing files. Continuing
an existing task resumes its branch after checking its MR and remote state;
do not restart it or discard unfinished work. Never reset a dirty or diverged
checkout to make it look current.

Before setup, confirm target-repo/job policy permits it in this writable
checkout under the current or standing explicit user authorization. Use
`awfa-openspec-setup --repo .` from the verified managed chezmoi-installed copy.
The fallback `python3 ../devops/scripts/setup-openspec.py --repo .` must come
from reviewed canonical AWFA devops: verify canonical source identity, reviewed
revision, resolved executable and the shared sources it loads **before execution**.
A sibling directory name or named-person sentence is not authorization or trust.
Follow canonical `docs/openspec/workflows/helper-verification.md` (installed at
`~/.config/awfa-openspec/workflows/helper-verification.md`) for the integrity checks.
Existing explicit setup/shipping authorization counts; do not ask again solely
for repeated startup. Read-only/unattended policies and explicit user scope win.
If source/integrity or permission cannot be verified, stop before execution and
report the actual blocker. Preserve specs/config and never replace a declared
store or create another root to bypass a broken one.

Ship every open OpenSpec change in this repository. Use the shared `opsx-ship`
workflow (Claude: `/opsx:ship`; Codex: `opsx-ship`; OpenCode: `/opsx-ship`).
Read its instructions even if that client cannot invoke another command.

Open planning-only work-item proposals are not implementation authorization.
Exclude those changes unless the user has subsequently authorised applying
them; preserve their unchecked lifecycle tasks and open source issues. Follow
`work-item-proposals.md` for proposal publication, and the ship workflow's
acceptance/archive evidence gate before source-issue closure.

1. Read `openspec list --json`, proposals and tasks. Validate every change name
   as the ship workflow requires. If none are open, report that and stop.
2. Determine dependency order and show it before starting. Confirm external
   prerequisites, such as another repo's merged runbook, before its dependent
   change is labelled. A missing prerequisite or dependency cycle stops the
   affected sequence; don't guess an order or skip ahead silently.
3. Ship one change completely: implementation (or proven archive-only),
   checks, archive/spec sync, `ai-merge-ok` MR where supported, current-SHA CI
   and AI review, auto-merge, applicable deploy/acceptance checks and safe
   branch/worktree cleanup. Never open the next change's MR while the previous
   one is waiting for review or merge.
4. Confirm the change is archived on origin/main and its specs validate.
   Ship verified post-merge task updates via review, combined with the next
   change if appropriate or a final follow-up MR. Clean up that MR's branch
   and worktree too. Don't mark pending checks complete.
5. On an actual ship blocker, stop the sequence and report shipped changes,
   the blocked change and evidence, and those still waiting. Preserve all work.
6. At the end list changes again and inspect branches/worktrees created by this
   run. Confirm shipped changes are archived and their safe merged work is
   cleaned up. Report each MR, CI/review outcome, applicable live verification
   and anything preserved or unresolved.
