# Connecting: configuration, TLS, startup and authentication

This guide covers everything between "I have a connection string" and "the connection is ready for queries": how options are resolved, how hosts are tried, how the connection is encrypted and the server's identity checked, how the protocol version is agreed, and how the client proves who it is (SCRAM, channel binding, MD5, cleartext, client certificates, short-lived IAM tokens).

Files: [../config.ts](../config.ts) (options), [../connect.ts](../connect.ts) (hosts, TLS, retries, cancel connections), [../connection.ts](../connection.ts) (`#startup`, authentication), [scram.ts](scram.ts), [md5.ts](md5.ts), [encoding.ts](encoding.ts), [../capabilities.ts](../capabilities.ts), [../node-socket.ts](../node-socket.ts) (TLS on Node). The user-facing option reference is [../README.md](../README.md#connecting).

## Contents

- [The whole sequence](#the-whole-sequence)
- [Configuration](#configuration)
- [Hosts and failover](#hosts-and-failover)
- [TLS from first principles](#tls-from-first-principles)
- [TLS in the driver](#tls-in-the-driver)
- [Connect timeout and abort](#connect-timeout-and-abort)
- [Protocol version negotiation](#protocol-version-negotiation)
- [Startup, step by step](#startup-step-by-step)
- [Authentication methods](#authentication-methods)
- [SCRAM-SHA-256](#scram-sha-256)
- [Channel binding](#channel-binding)
- [Restricting methods: `requireAuth` and `channelBinding`](#restricting-methods-requireauth-and-channelbinding)
- [Passwords: strings, functions, `.pgpass`, IAM tokens](#passwords-strings-functions-pgpass-iam-tokens)
- [Client certificates](#client-certificates)
- [Crypto](#crypto)
- [After startup: version check and capabilities](#after-startup-version-check-and-capabilities)
- [Decisions](#decisions)
- [Glossary](#glossary)

## The whole sequence

```mermaid
sequenceDiagram
    participant D as Driver
    participant S as Server
    Note over D: resolveConfig (options, URL, PG* env, defaults)
    D->>S: TCP connect (TCP_NODELAY)
    alt sslmode needs TLS (default for remote hosts)
        D->>S: SSLRequest
        S-->>D: 'S'
        D->>S: TLS handshake (verify chain + host name)
    else direct TLS (sslnegotiation=direct)
        D->>S: TLS handshake right away, ALPN "postgresql"
    end
    D->>S: StartupMessage (3.2, user, database, client_encoding, DateStyle, …)
    S-->>D: AuthenticationSASL [SCRAM-SHA-256-PLUS, SCRAM-SHA-256]
    D->>S: SASLInitialResponse (client-first)
    S-->>D: AuthenticationSASLContinue (server-first: nonce, salt, iterations)
    D->>S: SASLResponse (client-final: channel binding, proof)
    S-->>D: AuthenticationSASLFinal (server signature)
    S-->>D: AuthenticationOk
    S-->>D: ParameterStatus × n, BackendKeyData
    S-->>D: ReadyForQuery
    Note over D: check PostgreSQL ≥ 18, detect capabilities, decide statement naming
```

## Configuration

<a id="configuration"></a>
`resolveConfig(options)` ([../config.ts](../config.ts)) turns whatever the caller gave into a `ResolvedConfig` with every default applied. It runs once per pool (or per `connect()`), not per connection.

### Where values come from

In order of precedence:

1. **Explicit options** (`{ host, user, ssl, … }`).
2. **The connection string** (`connectionString`), in either form:
   - URL: `postgres://user:password@host1:5432,host2/dbname?sslmode=require&application_name=app` (percent-encoded; IPv6 hosts in brackets; `?ssl=true` is accepted as node-postgres does and means `sslmode=require`).
   - Keywords: `host=localhost dbname='my db' sslmode=verify-full` (single quotes and backslash escapes as libpq).
3. **`PG*` environment variables** (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE`, `PGSSLROOTCERT`, `PGCONNECT_TIMEOUT`, `PGTARGETSESSIONATTRS`, `PGREQUIREAUTH`, …; the `ENV_KEYWORDS` table), from `options.env` or `process.env`.
4. **Defaults**: host `localhost`, port 5432, user `$USER` (or `$USERNAME`, else `postgres`), database = the user name, connect timeout 30 s.
5. **`.pgpass`**, only for the password, and only when the server asks for one ([below](#passwords-strings-functions-pgpass-iam-tokens)).

These follow **libpq**, PostgreSQL's own C client library, so connection strings and environment variables that work with `psql` work here. Keywords libpq knows are interpreted; **unknown** keywords in the connection string become startup parameters (run-time settings such as `search_path=app`), as do `params` and `options` (`PGOPTIONS`, command-line style: `-c statement_timeout=5s`).

Errors in the string never echo values (a malformed percent-encoding might be in the password).

### Notable resolved fields

| Field                 | Resolved from                                              | Notes                                                                                                                |
| --------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `hosts`               | `host` (comma-separated), `port` (one, or one per host)    | `/path` is a Unix-socket directory                                                                                   |
| `ssl.mode`            | `ssl`, `sslmode`                                           | default `verify-full` for remote hosts, `prefer` when every host is local (Unix socket, `localhost`, `127.x`, `::1`) |
| `ssl.negotiation`     | `sslnegotiation`                                           | `direct` needs `require`, `verify-ca` or `verify-full`                                                               |
| `ssl.rootCertFile`    | `sslrootcert`                                              | `system` means the platform's CA store and implies `verify-full`                                                     |
| `channelBinding`      | `channel_binding`                                          | `prefer` (default), `require`, `disable`                                                                             |
| `protocol`            | `protocol`, `min_protocol_version`, `max_protocol_version` | a range of minor versions; default 3.0 to 3.2                                                                        |
| `requireAuth`         | `require_auth`                                             | a set of allowed methods, or `undefined` for any                                                                     |
| `connectTimeout`      | `connectTimeout` (ms), `connect_timeout` (s)               | libpq treats values below 2 s as 2 s; 0 = none                                                                       |
| `targetSessionAttrs`  | `target_session_attrs`                                     | `any`, `read-write`, `read-only`, `primary`, `standby`, `prefer-standby`                                             |
| `registry`, `catalog` | `codecs`                                                   | a fresh `TypeCatalog` per resolved config: shared by a pool's connections ([../CODECS.md](../CODECS.md))             |

## Hosts and failover

`openConnection(config)` ([../connect.ts](../connect.ts)) tries each host in order and returns the first that connects **and** matches `targetSessionAttrs`:

```ts
const passes =
	config.targetSessionAttrs === 'prefer-standby'
		? ['standby', 'any']
		: [config.targetSessionAttrs];
for (const pass of passes)
	for (const host of config.hosts) {
		try {
			connection = await connectHost(config, host, signal);
		} catch (e) {
			errors.push(e);
			continue;
		}
		if (pass === 'any' || (await matchesTarget(connection, pass)))
			return connection;
		await connection.close();
		errors.push(new ConnectionError(`${host} is not a ${pass} server`));
	}
throw errors.length === 1
	? errors[0]
	: new ConnectionError(`Could not connect to any host: …`, {
			cause: new AggregateError(errors),
		});
```

`matchesTarget` reads the server's role from the parameters it reported at login (`in_hot_standby`, `default_transaction_read_only`), and only queries (`pg_is_in_recovery()`) if they're missing. A **standby** is a read-only replica; a **primary** accepts writes. With `prefer-standby`, a first pass looks for a standby and a second accepts any.

## TLS from first principles

Without encryption, anyone on the network path can read your queries, your data, and (with the weaker authentication methods) your password, and can even change what is sent. **TLS** (Transport Layer Security, what HTTPS uses) fixes that:

- **Encryption**: client and server agree on keys during a **handshake**, then everything is encrypted.
- **Server identity**: the server presents a **certificate**: its public key and name, signed by a **certificate authority** (CA). The client checks the signature chain up to a CA it trusts (**chain verification**), and that the name in the certificate matches the host it meant to reach (**host-name verification**). Without both checks, an attacker in the middle could present their own certificate and decrypt everything: encryption with an unverified certificate stops eavesdroppers but not impostors.
- **Client identity** (optional): the client can present its own certificate (**mutual TLS**), which Postgres can accept instead of a password ([client certificates](#client-certificates)).

PostgreSQL's `sslmode` setting says how much of this to insist on:

| `sslmode`     | Encrypt             | Verify chain | Verify host name | If the server has no TLS |
| ------------- | ------------------- | ------------ | ---------------- | ------------------------ |
| `disable`     | never               |              |                  | fine                     |
| `allow`       | only if plain fails | no           | no               | fine                     |
| `prefer`      | if possible         | no           | no               | fine                     |
| `require`     | always              | no           | no               | fail                     |
| `verify-ca`   | always              | yes          | no               | fail                     |
| `verify-full` | always              | yes          | yes              | fail                     |

The driver defaults to **`verify-full` for remote hosts** (libpq defaults to `prefer`, which silently falls back to plain text and doesn't verify anything) and `prefer` for local ones, where there's no network to attack.

## TLS in the driver

<a id="tls-in-the-driver"></a>
`connectHost` turns the mode into a list of **plans** to try:

| Mode                                              | Plans, in order                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `disable`, or a Unix socket with `prefer`/`allow` | `plain`                                                                                                    |
| `allow`                                           | `plain`, then `tls` (only if the server rejected the plain connection's authentication, SQLSTATE class 28) |
| `prefer`                                          | `tls-optional`, then `plain` (only after a connection-level failure, not a server error)                   |
| `require`, `verify-ca`, `verify-full`             | `tls`, or `direct` with `sslnegotiation=direct`                                                            |

`attempt(config, host, plan, version)` runs one plan:

1. **Certificates are read in parallel** with the TCP connection: `tlsOptions()` loads the CA (from `ssl.ca`, then `rootCertFile`, then `~/.postgresql/root.crt` for verify modes; otherwise the platform's store), the client certificate and key (from `cert`/`key`, `certFile`/`keyFile`, or `~/.postgresql/postgresql.crt`/`.key` when both exist), and the passphrase. A certificate without a key, or the reverse, is an error. The SNI server name (`servername`) is the host unless it is an IP address.
2. **TCP connect** through the socket factory. On Node, `node:tls` is preloaded while the TCP handshake is in flight (~3 ms saved on a cold start).
3. **`tls` / `tls-optional`**: send an **SSLRequest** and read the one-byte answer (`requestSsl`). `S` → `socket.startTls(options)`; `N` → `tls` fails ("the server does not support TLS"), `tls-optional` continues in plain text. If **more than one byte** arrives, the connection is refused: the server sends exactly one byte, so extra bytes can only have been injected by someone in the middle, hoping the client will read them as if they came over TLS.
4. **`direct`** (PostgreSQL 17+): the TLS handshake starts immediately, with ALPN protocol `postgresql`, saving the SSLRequest round trip.
5. `Connection.open(socket, config, { host, version, cancel })`: the startup handshake. `cancel` sends cancel requests to the same host **with the same TLS plan** (a cancel request is sent on a new connection; leaking it in plain text would leak the cancel key).

Verification itself is done by the runtime's TLS (`rejectUnauthorized: verifyChain`, and `checkServerIdentity` checking `host` when `verifyHostname`, in [../node-socket.ts](../node-socket.ts)). Cloudflare Workers always verify against public CAs and can't do custom CAs, client certificates or direct TLS ([../ARCHITECTURE.md](../ARCHITECTURE.md#cloudflare-workers-cloudflare-socketts)).

## Connect timeout and abort

`connectHost` races the whole attempt (TCP, TLS, startup, authentication, every plan and version) against `connectTimeout` and the optional `signal`. On timeout or abort it destroys the socket of the attempt in flight and rejects (`ETIMEDOUT`, or "Connecting was aborted"). A connection that completes after the race was lost is destroyed, so nothing leaks.

## Protocol version negotiation

<a id="protocol-version-negotiation"></a>
The driver asks for the **newest** version in `config.protocol` (3.2 by default) and accepts anything down to the minimum (3.0):

- A server or pooler that speaks only an older 3.x answers the StartupMessage with **NegotiateProtocolVersion** (newest minor it supports, and the names of `_pq_.` options it didn't recognise). `Connection.#negotiated` checks it isn't below `min_protocol_version` (`EPROTOCOL` otherwise) and continues at that version.
- Some poolers instead **reject** 3.2 with an error mentioning "protocol" (`rejectsProtocol32` recognises a few SQLSTATEs). `connectHost` then retries the same plan once asking for the minimum version.
- `protocol: '3.0'` (exact) or `maxProtocolVersion` force a version.

What changes with the version is the length of the cancel key (`BackendKeyData`: 4 bytes in 3.0, up to 256 in 3.2) and therefore of `CancelRequest`. `connection.protocol` and `capabilities.protocol` report what was agreed.

## Startup, step by step

`Connection.#startup()` ([../connection.ts](../connection.ts)):

1. Write the **StartupMessage** with `user`, `database`, `client_encoding=UTF8`, `DateStyle=ISO, MDY` (so text dates parse predictably), `application_name` if set, and the configured `params`.
2. If a password is configured, start loading the SCRAM crypto module now (`scramCrypto()`), while the server starts its backend process: ~3 ms that would otherwise come after the server asks.
3. Loop over startup messages (`#nextStartupMessage` reads the inbox):

| Message                         | Action                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AuthenticationCleartextPassword | check `requireAuth` allows `password` and channel binding isn't required; send the password                                                                                          |
| AuthenticationMD5Password       | check `md5` is allowed; send `md5Password(user, password, salt)`                                                                                                                     |
| AuthenticationSASL              | if no `SCRAM-SHA-256*` mechanism is offered (e.g. only `OAUTHBEARER`), fail with `EAUTHMETHOD`; else check `scram-sha-256` is allowed, build a `ScramClient`, send its first message |
| AuthenticationSASLContinue      | send `scram.final(serverFirst)`                                                                                                                                                      |
| AuthenticationSASLFinal         | `scram.verify(serverFinal)`: the server must prove it knows the password too                                                                                                         |
| AuthenticationOk                | if SCRAM ran but wasn't verified, fail; if no method ran (trust), check `none` is allowed and binding isn't required                                                                 |
| AuthenticationUnsupported       | GSSAPI, SSPI, Kerberos: fail with `EAUTHMETHOD`, naming the method                                                                                                                   |
| NegotiateProtocolVersion        | [above](#protocol-version-negotiation)                                                                                                                                               |
| BackendKeyData                  | keep pid and secret key, for cancel requests                                                                                                                                         |
| ErrorResponse                   | throw it (wrong password, unknown database, too many connections)                                                                                                                    |
| ReadyForQuery                   | done: version check, capabilities, statement naming ([below](#after-startup-version-check-and-capabilities))                                                                         |

ParameterStatus messages are recorded by `#dispatch` before they reach the loop, so `connection.parameters` has `server_version`, `TimeZone`, `in_hot_standby` and the rest.

## Authentication methods

The server decides the method (from its `pg_hba.conf` rules for this user, database and address) and asks for it; the client can only comply or refuse.

| Method                        | What crosses the network                              | Notes                                                                               |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| trust                         | nothing                                               | the server lets the user in                                                         |
| `password` (cleartext)        | the password itself                                   | only acceptable over TLS                                                            |
| `md5`                         | `"md5" + md5(md5(password + user) + salt)`            | legacy: the stored hash `md5(password + user)` is enough to log in, and MD5 is weak |
| `scram-sha-256`               | a proof derived from the password; never the password | the default since PostgreSQL 14; the server proves itself too                       |
| `cert`                        | a client certificate during TLS                       | no password message at all                                                          |
| GSSAPI, SSPI, Kerberos, OAuth |                                                       | not supported: a clear `ConnectionError` with code `EAUTHMETHOD`                    |

[md5.ts](md5.ts) implements MD5 in plain JavaScript, because WebCrypto (the crypto available everywhere) doesn't offer MD5.

## SCRAM-SHA-256

<a id="scram-sha-256"></a>
**SCRAM** (Salted Challenge Response Authentication Mechanism, RFC 5802 and RFC 7677) lets both sides prove they know the password without sending it, and without the server storing it: the server keeps only derived keys. [scram.ts](scram.ts) `ScramClient` is the client side.

### The messages

```
client-first:  n,,n=*,r=<client nonce>
server-first:  r=<client nonce + server nonce>,s=<salt, base64>,i=<iterations>
client-final:  c=<base64(gs2 header [+ binding data])>,r=<full nonce>,p=<proof, base64>
server-final:  v=<server signature, base64>          (or e=<error>)
```

- `n,,` is the **GS2 header**: `n` means "no channel binding", `y` "I could bind but you didn't offer it", `p=tls-server-end-point` "I'm binding" ([channel binding](#channel-binding)).
- `n=*`: the user name is ignored by Postgres (it uses the startup user), so `*`.
- The **nonce** is 18 random bytes, base64-encoded; the server appends its own. A replayed old exchange won't have the new nonce.

### The math

From the password, the salt and the iteration count:

```
SaltedPassword = PBKDF2-HMAC-SHA-256(SASLprep(password), salt, iterations)   // deliberately slow
ClientKey      = HMAC(SaltedPassword, "Client Key")
StoredKey      = SHA-256(ClientKey)          // what the server stores
ServerKey      = HMAC(SaltedPassword, "Server Key")  // the server stores this too
AuthMessage    = client-first-bare + "," + server-first + "," + client-final-without-proof
ClientProof    = ClientKey XOR HMAC(StoredKey, AuthMessage)
ServerSignature= HMAC(ServerKey, AuthMessage)
```

The server, knowing `StoredKey`, recomputes `HMAC(StoredKey, AuthMessage)`, XORs it with the proof to recover `ClientKey`, and checks `SHA-256(ClientKey) == StoredKey`. The client checks the server's `v=` signature against its own `ServerSignature` (`verify`, with a constant-time comparison so timing reveals nothing): only someone holding `ServerKey` could produce it, so this proves the server is genuine, not an impostor that accepts anything.

The checks in `final` and `verify`:

- the server nonce must **start with** the client nonce and be longer;
- the salt must be present and the iteration count a positive integer;
- `AuthenticationOk` without a verified server signature is refused (`#startup`): a server that skips the final step hasn't proven anything.

### SASLprep

Passwords are normalised before hashing, as the server does (RFC 4013, `saslprep()`): certain characters removed, non-ASCII spaces mapped to spaces, Unicode NFKC normalisation; and, like the server, a password that SASLprep would reject (control characters, …) is used as it is.

### The key cache

PBKDF2 with 4096+ iterations takes milliseconds on purpose. The salt and count only change when the role's password changes, so `cachedKeys` keeps the derived keys for up to 16 (iterations, salt, password) combinations: a pool opening 20 connections runs PBKDF2 once. The keys grant nothing beyond the password the configuration already holds in memory.

## Channel binding

<a id="channel-binding"></a>
SCRAM over TLS still has a gap: if an attacker in the middle terminates TLS with a certificate the client accepted (because it didn't verify it), they can relay the SCRAM exchange to the real server. **Channel binding** closes it by mixing the TLS connection's identity into the SCRAM proof: the proof only works on the TLS connection the client actually has.

Postgres implements `tls-server-end-point` (RFC 5929): the binding data is a hash of the **server's certificate**, so a relay with a different certificate produces a different proof. The mechanism is then called `SCRAM-SHA-256-PLUS`.

`Connection.#scram`:

1. If the connection is encrypted, the server offered `-PLUS`, and `channelBinding` isn't `disable`, read the server certificate (DER bytes, `socket.peerCertificate()`) and compute the binding (`serverEndPoint(der)`).
2. `serverEndPoint` parses just enough of the certificate's DER structure (`derHeader`) to find its **signature algorithm**, maps it to the hash RFC 5929 prescribes (SHA-256 for MD5/SHA-1/SHA-256 signatures, SHA-384, SHA-512; RSASSA-PSS assumed SHA-256), and hashes the whole certificate. An algorithm without a defined hash (Ed25519) gives no binding.
3. The GS2 header becomes `p=tls-server-end-point,,` and the `c=` attribute carries the header plus the hash.
4. If binding was possible but the server didn't offer `-PLUS`, the header is `y,,`: the server, which does support it, then knows something stripped `-PLUS` from its offer (a **downgrade attack**) and fails the authentication.

On Workers, the certificate isn't exposed, so SCRAM runs without binding there.

## Restricting methods: `requireAuth` and `channelBinding`

The server picks the method, so a malicious server (or an impostor) could ask for `password` to receive your password in clear. Two options let the client refuse:

- **`requireAuth`** (libpq's `require_auth`): a list of allowed methods (`'scram-sha-256'`, `['scram-sha-256', 'none']`) or of forbidden ones (`'!password,!md5'`), never mixed. Methods: `password`, `md5`, `scram-sha-256`, `gss`, `sspi`, `none`. `#allow(method)` checks each request against it and fails with `EAUTHMETHOD` before sending anything. `oauth` is rejected at configuration time, since it isn't supported (`!oauth` is accepted and harmless).
- **`channelBinding: 'require'`**: authentication must be SCRAM-SHA-256-PLUS. Any other method (`#refuseWithoutBinding`) or SCRAM without binding fails.

## Passwords: strings, functions, `.pgpass`, IAM tokens

`Connection.#password()` is called **only when the server asks** for a password:

```ts
async #password(): Promise<string> {
	const source = this.#config.password;
	if (typeof source === 'function') return source();
	if (source !== undefined) return source;
	const file = await readPgpass(this.#config.passfile);
	const found = file === undefined ? undefined : findPgpassPassword(file, { ...host, database, user });
	if (found === undefined) throw new ConnectionError('The server requested a password, but none was given');
	return found;
}
```

- A **string**: used as is.
- A **function** (sync or async): called for **every new connection**. This is how short-lived credentials work: cloud databases (AWS RDS/Aurora IAM authentication, Google Cloud SQL, Azure Entra ID) accept a token that expires after minutes as the password, so the pool must fetch a fresh one each time it opens a connection: `password: () => signer.getAuthToken()`.
- Otherwise, **`.pgpass`** (`passfile`, `PGPASSFILE`, or `~/.pgpass`): lines `host:port:database:user:password`, `*` matching anything, `\` escaping `:` and `\`, a Unix socket matching `localhost` (`findPgpassPassword` in [../config.ts](../config.ts)). It is read with dynamic `import('node:fs/promises')`, so runtimes without a file system just don't find it.

## Client certificates

For `cert` authentication (mutual TLS), the client presents a certificate during the TLS handshake and the server maps its common name to the user; no password message follows. Give `ssl: { cert, key }` (PEM text) or `certFile`/`keyFile` (libpq's `sslcert`/`sslkey`, `PGSSLCERT`/`PGSSLKEY`), with `passphrase` for an encrypted key; without any, `~/.postgresql/postgresql.crt` and `.key` are used when both exist. The Node socket puts them in a cached TLS context ([../ARCHITECTURE.md](../ARCHITECTURE.md#node-bun-and-deno-node-socketts)). A wrong passphrase fails in `tls.connect` with a `ConnectionError`.

## Crypto

<a id="crypto"></a>
`scramCrypto()` picks the implementation once:

- **`node:crypto`** where the runtime has it (Node, Bun, Deno, Workers with `nodejs_compat`), reached through `process.getBuiltinModule`: HMAC and SHA-256 are synchronous and take microseconds, while PBKDF2 runs on Node's thread pool, off the main thread.
- **WebCrypto** (`crypto.subtle`) otherwise: every call is asynchronous, which is slower for many small HMACs but available everywhere.

[encoding.ts](encoding.ts) has the small helpers SCRAM needs: standard base64 encode/decode (strict: invalid input throws), UTF-8 via `TextEncoder`/`TextDecoder`, hex.

## After startup: version check and capabilities

On ReadyForQuery:

1. **`checkServerVersion(parameters.get('server_version'))`** ([../capabilities.ts](../capabilities.ts)): `parseServerVersion` turns `18.6 (Debian …)` into `180006`; below 180000 the connection fails with `EVERSION` ("quarry requires PostgreSQL 18 or later"). A version that can't be parsed (a pooler hiding or replacing it) passes: such a pooler is assumed to front 18+.
2. **`detectCapabilities`**: `{ protocol, protocolMinor, serverVersion, saslMechanisms, pgbouncer }`, where `pgbouncer` is read from the parameters PgBouncer 1.26+ reports (`pgbouncer.version`, `.pool_mode`, `.max_prepared_statements`). Exposed as `connection.capabilities`.
3. **Statement naming**: `naming(statementNames(capabilities.pgbouncer), config.preparePipelined)` decides whether cached statements are always named, named only when alone, or never ([../ARCHITECTURE.md](../ARCHITECTURE.md#part-8-behind-pgbouncer)).

## Decisions

Why connecting works this way. Each links to its full entry (what it is, why, the alternatives, the cost, measured impact) in [DECISIONS.md](../DECISIONS.md):

- [libpq-compatible configuration](../DECISIONS.md#libpq-compatible-configuration): the same connection strings, environment variables and `.pgpass` every Postgres tool understands.
- [`verify-full` by default, and strict TLS and SCRAM checks](../DECISIONS.md#verify-full-by-default-and-strict-tls-and-scram-checks): secure unless you opt out; extra bytes after SSLRequest refused; the server's SCRAM signature always verified; `requireAuth`.
- [Password functions, called for every new connection](../DECISIONS.md#password-functions-called-for-every-new-connection): rotating IAM tokens work without restarting the pool.
- [SCRAM with `node:crypto`, and a derived-key cache](../DECISIONS.md#scram-with-nodecrypto-and-a-derived-key-cache): pools open quickly without weakening anything.
- [A TLS secure-context cache](../DECISIONS.md#a-tls-secure-context-cache): the CA is parsed once, not per connection.
- [Lazy `node:tls`, `getBuiltinModule`, and preloading](../DECISIONS.md#lazy-nodetls-getbuiltinmodule-and-preloading): work overlapped with network waits: faster cold connects.
- [Ask for protocol 3.2, accept 3.0, retry once](../DECISIONS.md#ask-for-protocol-32-accept-30-retry-once): stronger cancel keys where available, compatibility with every pooler.
- [PostgreSQL 18 or later only](../DECISIONS.md#postgresql-18-or-later-only): with a clear error on older servers.
- [`close()` with libpq semantics](../DECISIONS.md#close-with-libpq-semantics): no waiting for the backend to exit.

## Glossary

**ALPN**: a TLS extension naming the application protocol; Postgres direct TLS uses `postgresql`.

**Certificate / CA**: a signed statement binding a public key to a name / the authority whose signature makes it trusted.

**Channel binding**: tying an authentication exchange to the specific TLS connection it runs on.

**DER / PEM**: binary and base64-text encodings of certificates.

**Downgrade attack**: an attacker removing stronger options so both sides fall back to a weaker one.

**IAM token**: a short-lived credential from a cloud provider, used as a database password.

**libpq**: PostgreSQL's official C client library, the reference for connection options.

**Nonce**: a random value used once, so an old exchange can't be replayed.

**PBKDF2**: a deliberately slow key-derivation function (many HMAC iterations).

**`pg_hba.conf`**: the server's file of rules choosing the authentication method per user, database and address.

**SASL / SCRAM**: a framework for authentication mechanisms / the challenge-response mechanism Postgres uses.

**SNI**: the TLS extension that tells the server which host name the client wants.

**Standby / primary**: a read-only replica / the server that accepts writes.

**TLS**: Transport Layer Security: encryption and server (optionally client) authentication.
