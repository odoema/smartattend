# SmartAttend Security Policy

## Security and confidentiality

SmartAttend is proprietary software. Security vulnerabilities, exposed credentials, authentication weaknesses and other sensitive findings must not be disclosed publicly through GitHub issues or public discussions.

## Reporting

Report suspected security issues privately to the software owner. Include enough information to reproduce the issue, but do not include passwords, access tokens, private keys, personal data or other secrets in the report.

## Credentials

Never commit secrets to this repository. Environment variables, deployment tokens, database credentials, email-provider credentials and signing keys must be stored in the appropriate hosting or CI/CD secret store.

If a credential is accidentally exposed, treat it as compromised: revoke or rotate it immediately and investigate the repository history and deployment logs.

## Client access

Client repository access is granted on a least-privilege basis. Client access does not by itself transfer intellectual-property ownership.

## Supported security practice

- Use HTTPS for all production traffic.
- Keep production secrets outside source control.
- Review authentication, authorisation, database policies and API validation before production releases.
- Keep dependencies and GitHub Actions pinned to maintained major versions and review automated dependency/security alerts.
- Do not use production credentials in development or test environments.
- Remove or anonymise real student/user data from development and test fixtures.
