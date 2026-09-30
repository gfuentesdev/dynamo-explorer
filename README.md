# Dynamo Explorer

[![CI](https://github.com/gfuentesdev/dynamo-explorer/actions/workflows/ci.yml/badge.svg)](https://github.com/gfuentesdev/dynamo-explorer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Local desktop application (Electron + React) for exploring DynamoDB tables using your existing AWS profiles.

## Features

- Discovers profiles from `~/.aws/config` and `~/.aws/credentials`.
- Supports static profiles, roles, and active SSO sessions through AWS SDK v3.
- Lists tables by region and reads their schema, keys, and indexes.
- Runs `Scan` and `Query` operations with typed filters and document paths.
- Switches the full interface between English and Spanish and remembers the selected language.
- Paginates using `LastEvaluatedKey` and displays consumed capacity.
- Deletes individual records after showing a confirmation with the profile, region, table, and key.
- Keeps credentials and the AWS SDK outside the React renderer.

> **Status:** early MVP. The app runs from source in development mode; there are no packaged installers yet.

## Requirements

- [Node.js](https://nodejs.org/) 22.12 or newer (npm is included). If you use nvm, run `nvm use` in the project folder.
- macOS, Linux, or Windows.
- To connect to AWS: at least one profile in `~/.aws`. For IAM Identity Center (SSO) profiles you also need the
  [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) to sign in.
- To try it without AWS: [Docker](https://docs.docker.com/get-docker/) (see [Try it without an AWS account](#try-it-without-an-aws-account)).

## Quick start with your AWS profiles

```bash
git clone https://github.com/gfuentesdev/dynamo-explorer.git
cd dynamo-explorer
npm install
npm run dev
```

`npm install` also downloads the Electron binary for your platform, so the first install can take a minute.

Select a profile and region in the sidebar. The region defaults to the one set in the profile, or `us-east-1`.
The app also honors `AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE` if your profiles live somewhere else.

For IAM Identity Center profiles, sign in before opening the application (and again when the session expires):

```bash
aws sso login --profile profile-name
```

## Try it without an AWS account

The repository includes everything needed to run the app against
[DynamoDB Local](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html) with sample data.
It uses a dummy `local` profile stored in [`local-dynamodb/`](local-dynamodb), so your `~/.aws` files are not touched.

1. Start DynamoDB Local on port 8000 (leave this terminal open; data is kept in memory and is lost when it stops):

   ```bash
   npm run local:db
   ```

2. In a second terminal, create the sample tables `Orders` (with a GSI and an LSI) and `Products`:

   ```bash
   npm run local:seed
   ```

3. Start the app pointed at DynamoDB Local:

   ```bash
   npm run dev:local
   ```

   Choose the `local` profile. Try a `Query` on `Orders` with partition key `CUST#alice`, or a `Query` on
   `StatusIndex` with `SHIPPED`.

If port 8000 is taken, map another port (for example `docker run --rm -p 8001:8000 amazon/dynamodb-local -jar DynamoDBLocal.jar -sharedDb -inMemory`)
and set `AWS_ENDPOINT_URL_DYNAMODB=http://localhost:8001` before running `local:seed` and `dev:local`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts the app in development mode with hot reload. |
| `npm run dev:local` | Same as `dev`, but against DynamoDB Local with the dummy `local` profile. |
| `npm run local:db` | Runs DynamoDB Local in Docker on port 8000. |
| `npm run local:seed` | Creates and fills the sample tables in DynamoDB Local. |
| `npm run build` | Type-checks and builds the app into `out/`. |
| `npm run preview` | Runs the production build from `out/`. |
| `npm run typecheck` | Runs the TypeScript compiler without emitting files. |
| `npm test` | Runs the unit tests once (`npm run test:watch` for watch mode). |

## Suggested minimum permissions

The selected profile needs `dynamodb:ListTables` on `*`. For the tables you want to explore, it needs
`dynamodb:DescribeTable`, `dynamodb:Query`, and `dynamodb:Scan`. `dynamodb:DeleteItem` is only needed if you want
to delete records; the delete button is always shown, so omit this permission to keep a profile read-only.
Restrict the policy to the required accounts, regions, and tables.

## Security

The renderer runs with context isolation and sandboxing, without Node.js integration. It can only use
the five methods defined in the preload and never receives access keys or session tokens. The application
does not include a backend, telemetry, or credential synchronization.

Profile or table names containing `prod`, `production`, or `live` show a production badge and an extra warning
before deleting.

## Troubleshooting

- **"Electron failed to install correctly"** — the binary download was interrupted. Run `rm -rf node_modules && npm install`.
  Behind a proxy or firewall, set [`ELECTRON_MIRROR`](https://www.electronjs.org/docs/latest/tutorial/installation#mirror).
- **No profiles appear** — check that `~/.aws/config` has `[profile name]` sections (or `[default]`), or that
  `~/.aws/credentials` exists.
- **"The AWS session expired"** — run `aws sso login --profile profile-name` and refresh the tables.
- **The app shows DynamoDB Local tables when using `npm run dev`** — unset `AWS_ENDPOINT_URL_DYNAMODB` in your shell.
- **No tables with `dev:local`** — make sure `npm run local:db` is still running and run `npm run local:seed` again
  (DynamoDB Local runs in memory, so restarting it clears the data).

## License

[MIT](LICENSE)
