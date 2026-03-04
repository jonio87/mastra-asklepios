# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: {{SECURITY_EMAIL}}
3. Include: description, steps to reproduce, potential impact
4. Expected response time: 48 hours

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x.x   | ✅ Current |

## Security Practices

- No secrets in source code (enforced by pre-commit hooks)
- Dependencies audited via `npm audit`
- TypeScript strict mode prevents common vulnerability patterns
- All external input validated with Zod schemas
