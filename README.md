# Dynamo Explorer

Local desktop application for exploring DynamoDB tables using existing AWS profiles.

## Current MVP

- Discovers profiles from `~/.aws/config` and `~/.aws/credentials`.
- Supports static profiles, roles, and active SSO sessions through AWS SDK v3.
- Lists tables by region and reads their schema, keys, and indexes.
- Runs `Scan` and `Query` operations with typed filters and document paths.
- Switches the full interface between English and Spanish and remembers the selected language.
- Paginates using `LastEvaluatedKey` and displays consumed capacity.
- Deletes individual records after showing a confirmation with the profile, region, table, and key.
- Keeps credentials and the AWS SDK outside the React renderer.

## Development

Requirements: Node.js 22 and npm (included with Node.js).

```bash
npm install
npm run dev
```

For IAM Identity Center profiles, sign in before opening the application:

```bash
aws sso login --profile profile-name
```

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Suggested minimum permissions

The selected profile needs `dynamodb:ListTables` on `*`. For the allowed tables, it needs
`dynamodb:DescribeTable`, `dynamodb:Query`, `dynamodb:Scan`, and, only when deletion is enabled,
`dynamodb:DeleteItem`. The policy should be restricted to the required accounts, regions, and tables.

## Security

The renderer runs with context isolation and sandboxing, without Node.js integration. It can only use
the five methods defined in the preload and never receives access keys or session tokens. The application
does not include a backend, telemetry, or credential synchronization.
