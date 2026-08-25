# Setup

## Requirements

- Copilot App with project custom-agent discovery.
- The Microsoft Learn MCP server configured in Copilot App and exposed as `microsoft-learn/*`.
- Microsoft MCP Server for Enterprise configured as `microsoft-enterprise/*` for the Intune workshop.

No project extension, SDK package, local service, storage root, environment variable, or committed
MCP configuration is required.

Copilot App inherits MCP servers configured for a repository or Copilot CLI and also supports
managing servers in App settings. Configure the official Microsoft Learn endpoint there and name the
server `microsoft-learn`, matching the agent allow-list. See
[customizing Copilot App](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app)
and [Microsoft Learn MCP setup](https://learn.microsoft.com/en-us/training/support/mcp-get-started).

Installed product skills may remain available elsewhere in Copilot App, but this project does not load
them. `learn-researcher` uses direct Learn discovery in every mode, and fetched Learn pages are the only
citation evidence.

## Enterprise MCP external client

The tenant-side Microsoft-owned service principal must have app ID
`e8c77dc2-69b3-43f4-bc51-3213c9d915b4`. Configure the external client with:

- server name `microsoft-enterprise`;
- endpoint `https://mcp.svc.cloud.microsoft/enterprise`;
- interactive delegated authentication; app-only workflows are not supported;
- a dedicated single-tenant client app registration and its exact redirect URI; and
- only these reviewed delegated scopes:

```text
MCP.Device.Read.All
MCP.Group.Read.All
MCP.GroupMember.Read.All
MCP.LicenseAssignment.Read.All
MCP.Organization.Read.All
MCP.RoleManagement.Read.Directory
MCP.User.Read.All
```

Do not grant all available MCP scopes. Microsoft documents that a custom client needs its own
application registration, client ID, tenant ID, redirect URI, delegated permissions, and admin
consent in [Get started with Microsoft MCP Server for Enterprise](https://learn.microsoft.com/graph/mcp-server/get-started).
The server service principal existing in the tenant does not prove that this external client
registration or its OAuth2 permission grant exists.

An application or cloud application administrator can grant the reviewed set with Microsoft Entra
PowerShell:

```powershell
$reviewedScopes = @(
    'MCP.Device.Read.All'
    'MCP.Group.Read.All'
    'MCP.GroupMember.Read.All'
    'MCP.LicenseAssignment.Read.All'
    'MCP.Organization.Read.All'
    'MCP.RoleManagement.Read.Directory'
    'MCP.User.Read.All'
)

Grant-EntraBetaMCPServerPermission `
    -ApplicationId '<external-client-application-id>' `
    -Scopes $reviewedScopes
```

Granting specific scopes is additive. Audit the resulting OAuth2 permission grant and revoke every
scope outside the reviewed set before the workshop; do not reuse a broadly consented client. See
[Manage Microsoft MCP Server for Enterprise permissions](https://learn.microsoft.com/powershell/entra-powershell/how-to-manage-mcp-server-permissions?view=entra-powershell).

Configure both MCP servers in Copilot App, start a fresh project session, and select
`intune-discovery-coach`. Test one bounded Entra query and confirm that the response shows the
generated Microsoft Graph request path. Enterprise MCP currently performs read-only operations and
cannot read or change Intune configuration or managed-device state; those facts must come from the
Intune admin center or assigned endpoint.

**Deployment blocker:** this repository contains no tenant credentials or external client ID, so it
cannot prove or create the client registration. Deployment is ready only after an administrator
records the external client application ID, verifies its service principal and redirect URI, and
confirms that its grant contains exactly the seven reviewed scopes.

## Use

For a quick question, ask in the current project chat. The project instructions direct Copilot to
use native Microsoft Learn tools and return clickable Markdown references.

For focused learning, provide one objective, your current level, and a time budget. The coordinator
asks one short diagnostic question unless you request an immediate lesson. It then launches:

- `Learning mode: focused`;
- `Learning phase: lesson`;
- `Learning objective`, `Learner level`, `Time budget`, and `Diagnostic response`;
- the same callback envelope and default context tier used by research.

Answer the lesson's recall and application questions in the project chat. A fresh
`Learning phase: feedback` child receives the exact lesson and your responses, reuses only the lesson's
References, and returns targeted correction plus a learning ledger.

For isolated research, invoke `/orchestrate` and request one callback-enabled child:

- agent: `learn-researcher`;
- kickoff: `Research mode: standard`, callback session ID, frozen-task SHA-256, unique callback nonce,
  and the complete research question, version/platform scope, and constraints;
- coordination: `coordinate_with_creator: true`;
- notification: `notify_on_idle: always`, used only to diagnose missing callbacks;
- context: `context_tier: default`. Use `long_context` only for a packet over 15,000 characters, more
  than 30 fixed atoms, a multi-answer comparison, or a prior default run that reaches 120,000 input
  tokens or exhibits context loss.

Accept only `STARTED`, `COMPLETED`, or `FAILED` callbacks from the expected child with both exact
identifiers. Verify a complete normalized answer before archiving the child. An idle child without a
matching callback is a delivery failure and is not automatically retried. See the
[built-in skills reference](https://docs.github.com/en/copilot/reference/github-copilot-app-reference/built-in-skills).

When a child must test agent changes that are not on the default branch, commit and push the feature
branch first, pass that branch as `base_branch`, and verify the child contains the expected commit.
Native child-session creation resolves the pushed branch state; an unpushed local commit is not inherited.

For evidence review, use `Research mode: evaluation`, save the returned coordinator-only packet as a
session artifact, and give `citation-critic` that exact path. It independently fetches only the Learn
URLs already in References. Give its repair brief and the prior answer to a fresh callback-enabled
researcher in one repair-mode packet. Do not put a generated Markdown packet in kickoff attachments;
those accept only app-staged creator images, and Git staging is unrelated.

## Validate repository contracts

```sh
node --test
```

Project agent changes may require a new turn or session before they appear in the agent picker.
