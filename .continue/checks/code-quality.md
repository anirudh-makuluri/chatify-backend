---
name: Code Quality Review
description: Review PR for code quality, best practices, and maintainability
---
Review this PR and check that:
  - Code follows consistent style and formatting
  - Functions and classes have clear, descriptive names
  - Error handling is implemented appropriately
  - No console.log statements in production code (use proper logging)
  - Code is well-documented with comments where needed
  - No unused imports or variables
  - Async/await is used correctly (no promise chains without proper error handling)
  - Database queries are optimized and use proper indexing considerations
