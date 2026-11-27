# Issue tracker: GitHub

Issues and specs for this repository live in GitHub Issues. Use GitHub Desktop for local work and the GitHub website or available GitHub tools for issue operations.

GitHub CLI is not required.

## Who uses this file

This file is written for both people and coding agents:

- People use it to choose the issue format, add labels and manage issue work.
- Agents use it to find, create, read, label and close issues consistently.

The agent still has to follow GitHub account, permission and repository rules.

## Conventions

- **Create an issue**: Use the GitHub website's **New issue** button and the task, feature request or bug report template.
- **Read an issue**: Open the issue page or use an available GitHub tool.
- **List issues**: Use GitHub Issues search or an available GitHub tool.
- **Make an issue a sub-issue**: Use GitHub's sub-issue control in the parent issue. If sub-issues are unavailable, put `Part of #<parent>` at the top of the child issue.
- **Block another issue**: Use GitHub's issue dependency control when available. Otherwise, put `Blocked by: #<n>, #<n>` at the top of the child issue.
- **Count open blockers**: An issue is startable when it has no open blockers.
- **Comment on an issue**: Use the issue page or an available GitHub tool.
- **Apply or remove labels**: Use the issue's label control or an available GitHub tool.
- **Close an issue**: Add the explanation as a comment, then close the issue.

Use `.github/ISSUE_TEMPLATE/task.md`, `.github/ISSUE_TEMPLATE/feature_request.md` and `.github/ISSUE_TEMPLATE/bug_report.md` as the issue formats. Follow `CONTRIBUTING.md` for issue-first work, Docker-only checks and focused pull requests.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Here, “surface” means a place where work requests can arrive. At present, the triage queue is based on GitHub Issues, not pull requests.

Set this to `yes` only if code or proposals submitted through pull requests should also be treated as feature requests. That would make pull requests part of the triage queue, where an agent or maintainer could read them, apply labels and decide whether to accept, revise or reject the proposal.

GitHub shares one number space across issues and pull requests, so check whether a bare `#42` refers to an issue or pull request before acting on it.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Fetch the issue as described under **Read an issue** above.
