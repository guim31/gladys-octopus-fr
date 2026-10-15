# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

- **Secrets**: the e-mail address and the password of the Octopus Energy
  customer area live in the Gladys configuration. The integration sends them
  only to the Octopus Energy France API (`obtainKrakenToken`), and only when
  it has no valid refresh token; it never writes them to `/data` nor to the
  logs (the logger blanks them even inside an error message). The access
  token (about an hour) stays in memory.
- **Stored in `/data`**: `octopus-state.json`, readable by the owner only
  (0600), written atomically: the Octopus refresh token (about a week),
  keyed by a hash of the e-mail address (no address in the file), and per
  meter how far the energy tracking was fed and the last day announced to
  the scenes. Deleting the file only means one sign-in with the password.
- **Network**: requests go only to `https://api.oefr-kraken.energy` in HTTPS,
  certificates verified; the integration opens no port and needs no access
  to the local network. It reads data and never changes anything on the
  account.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Octopus Energy and its API, and the other devices and services of your
network.
