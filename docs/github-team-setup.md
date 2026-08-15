# GitHub Team Setup

This repo currently uses `origin` as `https://github.com/PradeepVerma07/360degrees.git`.
That looks like a personal GitHub account. GitHub Teams only work inside a GitHub organization, so use this checklist when you are ready to manage the app with a team.

## Recommended Team Model

- Organization: your company or project organization
- Repository: `360degrees`
- Team: `ci360-web-team`
- Default branch: `main`
- Required status check: `Web CI / Build React app and server`

## Setup Steps

1. Create a GitHub organization, or use an existing one.
2. Create a team named `ci360-web-team`.
3. Add developers to the team.
4. Transfer this repository into the organization, or create a new organization repo and push this code there.
5. Give `ci360-web-team` `Write` access for developers, or `Maintain` access for leads.
6. Update `.github/CODEOWNERS` and replace `@PradeepVerma07` with `@your-org/ci360-web-team`.
7. Open repository settings, then enable branch protection for `main`.
8. Require pull requests before merging.
9. Require at least one approval.
10. Require review from Code Owners.
11. Require the `Web CI / Build React app and server` status check.
12. Block force pushes and direct pushes to `main`.

## Working Agreement

- Create feature branches from `main`.
- Open pull requests into `main`.
- Keep secrets in GitHub repository secrets or Hostinger environment variables, never in committed files.
- Run `npm run build` before requesting review.
- Add database notes to the pull request when a change affects MySQL schema or seed data.

## Useful Repository Settings

- Enable Dependabot alerts.
- Enable secret scanning if the repository has GitHub Advanced Security available.
- Add branch rules before inviting the full team.
- Keep the Android APK workflow manual or limited to app changes, because it commits a generated APK back into the repo.
