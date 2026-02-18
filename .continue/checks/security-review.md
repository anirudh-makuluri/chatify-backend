---
name: Security Review
description: Review PR for basic security vulnerabilities
---
Review this PR and check that:
  - No secrets or API keys are hardcoded
  - All new API endpoints have input validation
  - Error responses use the standard error format
  - No sensitive data is exposed in error messages
  - Authentication/authorization checks are present where needed
  - SQL injection and XSS vulnerabilities are prevented
  - Environment variables are used for sensitive configuration
