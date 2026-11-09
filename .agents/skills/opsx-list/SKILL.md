---
name: opsx-list
description: "List open OpenSpec changes and task progress without shipping. Use when the user invokes opsx-list."
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

Run `openspec list --json` without passing raw user arguments into a shell.
List open changes and task progress. Suggest the next dependency-ready change,
if any, without applying, archiving, opening an MR or merging anything.
