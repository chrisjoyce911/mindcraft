---
description: "Ship one named OpenSpec change through CI and AI review, then clean up its merged branch and worktree."
---

Requested change: $ARGUMENTS. Treat it as data, never shell code.

Read the repository's AGENTS.md and README first. Honour explicit review-only
requests and target-repository permissions. These workflows apply to writable
development checkouts, not read-only investigations or unattended jobs whose
registry forbids writes. The model provider does not change these rules.

For genuinely new work, fetch origin and create a new branch or isolated
worktree from the freshly fetched `origin/main` before changing files. Continuing
an existing task resumes its branch after checking its MR and remote state;
do not restart it or discard unfinished work. Never reset a dirty or diverged
checkout to make it look current.

Keep OpenSpec-generated core skills as generated; regenerate them with
`openspec update` rather than widening their tool permissions. Claude's
`allowed-tools` pre-approves listed tools for the invocation; it does not
restrict the available tools, and normal permission settings govern other
calls ([official documentation](https://code.claude.com/docs/en/skills#pre-approve-tools-for-a-skill)).
OpenCode skill frontmatter recognises name, description, license,
compatibility and metadata; permissions are configured separately, so the
generated `allowed-tools: Bash(openspec:*)` is not an OpenCode Bash whitelist
([official documentation](https://opencode.ai/docs/skills/)). These facts do
not grant a denied operation or authorise broader shell access.

In the generated update-change workflow, a missing artifact with no
`existingOutputPaths` must use its artifact instructions. Its explicit
exception permits a user-confirmed new file under an already populated glob
artifact. That is adding a file to an existing artifact, not creating a
missing artifact; follow the exception's path, dependency and create-only
checks. Preserve both the general rule and its specific exception.

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

Ship the one OpenSpec change named in the request. If none was named, list the
changes and ask which to ship. The invocation authorises implementation,
push, an `ai-merge-ok` MR, review fixes and safe merged-branch/worktree cleanup
within that change's scope. It does not authorise unrelated changes, new
credentials, permission grants or an explicit review gate's removal.

A user-directed work-item proposal request follows the planning-only
`work-item-proposals.md` guidance; it does not invoke this implementation path.
For later authorised implementation, retain the source project/IID/URL and
final issue-closure task. Before the archive MR, post the implementation MRs
and acceptance evidence on the change's linked work item (`Work item:` line in
proposal.md). The archive merge's `openspec:workitems` job posts the archive
evidence and closes the item when every other task is checked; after the merge
confirm it did, or report why not (unchecked tasks, API failure). Do not close
the item by hand around that job.

1. **Resolve and preserve.** Confirm the name occurs in `openspec list --json`
   and matches `^[a-z0-9][a-z0-9-]*$`; quote validated names in shell arguments.
   Read proposal, design, specs and tasks, including cross-repo prerequisites.
   Inspect git status, worktrees, branches and open MRs; fetch origin. Use a
   new branch from origin/main with `git switch -c` or an isolated worktree.
   Never use `checkout -B`, reset, or force to overwrite existing work. A local
   uncommitted proposal must be carried into the new branch/worktree safely,
   rather than silently lost when starting from origin/main. Preserve unrelated
   dirty or diverged work; reuse an existing MR only after verifying its scope.

2. **Implement and check.** Use the OpenSpec apply workflow or
   `openspec instructions apply --change "<change>" --json`. Work through the
   authorised tasks and the repo's required checks in AGENTS.md and CI. Validate
   the change with `openspec validate "<change>" --strict --no-interactive`.
   For CI templates, lint expanded includes in a consuming project. Fix failures
   caused by this change; report an unrelated blocker with evidence.

3. **Archive with the implementation.** Sync delta specs and archive in the
   same MR. Archive with still-pending post-merge/post-deploy tasks unticked is
   authorised by this workflow; never tick them before verification. Keep the
   archived task list available for the later checks. Validate resulting specs.
   For already-implemented changes, prove their code and required checks are
   on origin/main and ship an archive-only MR instead of reapplying the code.

4. **Publish for review.** Commit and push only this change. Create the MR
   with source-branch removal enabled and a description of the problem,
   behaviour, validation and any outstanding post-merge checks. In AWFA repos,
   check this repo's expanded production rules before any `ai-merge-ok` is
   applied, whether at `glab mr create` or later on an MR created unlabelled:
   OpenSpec-only commits must not deploy. go-service/docker-site defaults
   exclude openspec, while deploy-targets alone has a branch-only default
   requiring repo overrides. Then decide on `ai-merge-ok` **before** running
   `glab mr create`, in this order:
   - The user asked for review first: create the MR without the label and
     stop at that gate.
   - The repo's AGENTS.md sets its own label gate, such as a deploy "yes"
     where the merge is a production deploy: follow it, and label only once
     it is met.
   - A cross-repo prerequisite is pending: create the MR unlabelled and apply
     the label once the prerequisite passes.
   - Otherwise, once local tests and the production-rules check pass and the
     change is authorised to ship, create the MR with the label
     (`glab mr create --label ai-merge-ok`). Do not wait for CI or the review
     job.

   Early labelling is safe because the reviewer checks the label as its job
   finishes and merges only a clean, complete review of the head it reviewed,
   pinned to that SHA and gated on a green pipeline. A later push gets a fresh
   review, so the label never merges an unreviewed head. A label applied after
   the review finished is picked up by the devops label sweep, which re-runs
   the finished review. Finished MR content is ready, not draft; waiting for
   CI, review or a tracked prerequisite does not make the content unfinished.
   Verify the project
   actually runs the AI reviewer; a label alone is no proof of review or merge.
   Outside AWFA, use the host project's review policy. If the reviewer or label
   is unavailable, report it and leave the MR for review; never merge by hand
   around a missing or failing review job.

5. **Follow the current SHA to merge.** Watch MR state, pipeline jobs and AI
   review notes/discussions for the latest pushed SHA. A green old pipeline,
   approval or completed review job does not establish a clean current review.
   Read all findings, including LOW, and relevant human comments. Fix supported
   findings, run the affected checks and push for re-review. Answer a false
   positive on the MR with evidence; never bypass it. Retry a demonstrated
   transient CI failure once, otherwise fix this change's bug or report the
   blocker. Use bounded waits and give progress updates. Stop if the MR closes,
   permission is denied, or a blocker needs a decision. Do not leave an active
   watcher or retrying merge command behind when reporting a blocker. Only the
   reviewer/approved auto-merge path merges; do not call a manual merge API.

6. **Verify shipping.** After GitLab reports merged, fetch and verify the
   merged commit and archive on origin/main. Follow any main pipeline's deploy
   and smoke jobs to completion, and perform applicable acceptance checks.
   Report implementation, merge, deployment and live activation separately.
   If an OpenSpec-only commit deployed despite the production-rules check in
   step 4, report it. Do not trigger a production rollout solely to test a
   docs-only change. For shared template changes, check an appropriate consumer as AGENTS.md requires.
   Mark only verified post-merge tasks complete, shipping task updates through
   a follow-up reviewed MR if needed.

7. **Clean up after each merge.** Confirm GitLab's merged MR matches the source
   branch tip and no later commits were added. For ordinary merges require
   ancestry in origin/main; for squashes require the recorded merged source SHA
   to equal the local tip and verify the squashed result. Inspect associated
   worktrees for tracked changes, untracked/ignored files and unpushed commits.
   Remove only safe merged worktrees, with no force. Switch the primary checkout
   to main and fast-forward only; preserve dirty/diverged main rather than reset.
   Delete the merged local branch with `git branch -d`. If a squash makes -d
   refuse, delete only after the preceding exact-tip/result proof; otherwise
   preserve and report. If the remote source branch survives, confirm its tip
   still matches the merged SHA before deleting it. Prune stale refs/worktree
   metadata. Never delete another session's work or an unmerged branch.

8. **Report.** Give the MR link, reviewed/merged SHA, CI and review result,
   applicable deployment/acceptance evidence, archive path, cleanup result and
   any concrete remaining blocker. Keep working through authorised steps;
   don't stop merely because a pipeline is still pending.
