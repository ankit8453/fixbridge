import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

/**
 * Asks Google what a project can actually do.
 *
 * **Read this before running it.** An OAuth client id and secret are not an
 * API key, and Maps Platform is not called with one. The client id proves *a
 * person* is signing in; a Maps request is billed against *a project* and is
 * authorised by an API key or a service account. So these credentials can
 * never call the Geocoding API themselves, no matter what is enabled.
 *
 * What they *can* do — and the reason this script is worth running — is sign
 * in as you and ask Google three questions you would otherwise be clicking
 * through the console to answer:
 *
 *   1. Which projects does this account have?
 *   2. Which of the APIs we need are enabled on them?
 *   3. Is billing attached? Maps Platform refuses every request without it,
 *      free tier included, and that surprises people at the worst moment.
 *
 * Usage, from apps/api:
 *
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npx tsx scripts/check-google-apis.ts
 *
 * Or put both in apps/api/.env — it is gitignored, and these are secrets.
 */

/* -------------------------------------------------------------------------- */
/* What FixBridge would need                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Only what the location work actually calls. Deliberately not a wishlist —
 * every enabled API is another key surface and another line on a bill.
 */
const NEEDED = [
  {
    service: 'geocoding-backend.googleapis.com',
    name: 'Geocoding API',
    why: 'address text to coordinates — the thing the stub currently fakes',
    required: true,
  },
  {
    service: 'places-backend.googleapis.com',
    name: 'Places API',
    why: 'the search box on the map picker ("Vijay Nagar, Jabalpur")',
    required: true,
  },
  {
    service: 'maps-android-backend.googleapis.com',
    name: 'Maps SDK for Android',
    why: 'only if the pin picker uses Google tiles rather than OpenStreetMap',
    required: false,
  },
  {
    service: 'maps-ios-backend.googleapis.com',
    name: 'Maps SDK for iOS',
    why: 'same, for the iOS build that does not exist yet',
    required: false,
  },
  {
    service: 'static-maps-backend.googleapis.com',
    name: 'Maps Static API',
    why: 'a picture of the pin in the admin console, if we ever want one',
    required: false,
  },
] as const;

/**
 * Read-only, and the narrowest scope that answers the question. This script
 * looks; it never enables anything. Turning an API on costs money and is a
 * decision, not a side effect.
 */
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform.read-only';

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

/* -------------------------------------------------------------------------- */
/* OAuth — installed-app flow, with PKCE                                      */
/* -------------------------------------------------------------------------- */

const base64url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

/**
 * Waits on a loopback redirect for the authorisation code.
 *
 * Loopback rather than a pasted code: Google has deprecated the out-of-band
 * copy-paste flow, and this is what replaced it. The port is fixed so it can be
 * registered on the OAuth client once.
 */
function waitForCode(port: number, expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      const state = url.searchParams.get('state');

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(code ? 'Signed in. You can close this tab.' : `Sign-in failed: ${error ?? 'no code'}`);
      server.close();

      if (error) return reject(new Error(`Google returned: ${error}`));
      if (!code) return reject(new Error('no authorisation code came back'));
      // Guards against a stray request landing on the port mid-flow.
      if (state !== expectedState) return reject(new Error('state mismatch — ignoring'));

      resolve(code);
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1');

    setTimeout(() => {
      server.close();
      reject(new Error('timed out waiting for the browser'));
    }, 180_000).unref();
  });
}

async function authorise(): Promise<string> {
  const port = 8765;
  const redirectUri = `http://127.0.0.1:${port}`;
  const state = base64url(randomBytes(16));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId as string);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('Open this in a browser and sign in as the account that owns the project:\n');
  console.log(`  ${authUrl.toString()}\n`);
  console.log('Waiting for the redirect...\n');

  const code = await waitForCode(port, state);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId as string,
      client_secret: clientSecret as string,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const body = (await response.json()) as { access_token?: string; error_description?: string };

  if (!response.ok || !body.access_token) {
    throw new Error(`could not exchange the code: ${body.error_description ?? response.status}`);
  }

  return body.access_token;
}

/* -------------------------------------------------------------------------- */
/* The questions                                                              */
/* -------------------------------------------------------------------------- */

async function get<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body = (await response.json()) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new Error(body.error?.message ?? `${response.status} from ${url}`);
  }

  return body;
}

interface Project {
  projectId: string;
  name?: string;
  lifecycleState?: string;
}

async function listProjects(token: string): Promise<Project[]> {
  const body = await get<{ projects?: Project[] }>(
    'https://cloudresourcemanager.googleapis.com/v1/projects',
    token,
  );

  return (body.projects ?? []).filter((project) => project.lifecycleState !== 'DELETE_REQUESTED');
}

/** Enabled services, paged — a busy project can have well over fifty. */
async function enabledServices(token: string, projectId: string): Promise<Set<string>> {
  const enabled = new Set<string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(`https://serviceusage.googleapis.com/v1/projects/${projectId}/services`);
    url.searchParams.set('filter', 'state:ENABLED');
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const body = await get<{ services?: { config?: { name?: string } }[]; nextPageToken?: string }>(
      url.toString(),
      token,
    );

    for (const service of body.services ?? []) {
      if (service.config?.name) enabled.add(service.config.name);
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return enabled;
}

/**
 * Maps Platform refuses every request on a project with no billing account —
 * free tier included. It is the commonest reason a correctly enabled API still
 * returns REQUEST_DENIED, so it is checked rather than assumed.
 */
async function billingEnabled(token: string, projectId: string): Promise<boolean | null> {
  try {
    const body = await get<{ billingEnabled?: boolean }>(
      `https://cloudbilling.googleapis.com/v1/projects/${projectId}/billingInfo`,
      token,
    );
    return body.billingEnabled ?? false;
  } catch {
    // Usually means the Cloud Billing API is not enabled on the project, which
    // is not the same as "no billing" — so say unknown rather than guess.
    return null;
  }
}

async function main(): Promise<void> {
  if (!clientId || !clientSecret) {
    throw new Error(
      'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — as environment variables, or in apps/api/.env',
    );
  }

  const token = await authorise();
  const projects = await listProjects(token);

  if (projects.length === 0) {
    console.log('This account can see no Google Cloud projects.');
    return;
  }

  console.log(`${projects.length} project(s) visible to this account.\n`);

  for (const project of projects) {
    console.log(`── ${project.name ?? project.projectId} (${project.projectId})`);

    let enabled: Set<string>;
    try {
      enabled = await enabledServices(token, project.projectId);
    } catch (error) {
      console.log(`   could not read services: ${(error as Error).message}\n`);
      continue;
    }

    const billing = await billingEnabled(token, project.projectId);
    console.log(
      `   billing    ${billing === null ? 'unknown' : billing ? 'ON' : 'OFF — Maps will refuse every request'}`,
    );

    for (const api of NEEDED) {
      const on = enabled.has(api.service);
      const mark = on ? 'yes' : api.required ? 'NO ' : '-  ';
      console.log(`   ${mark}  ${api.name}${on ? '' : `  (${api.why})`}`);
    }

    console.log('');
  }

  console.log(
    'Reminder: none of the above is callable with the client id and secret.\n' +
      'Maps Platform needs an API key from the project — Credentials → Create\n' +
      'credentials → API key — restricted to the APIs marked yes above.',
  );
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  console.error(
    '\nIf sign-in failed on a redirect_uri mismatch: this needs an OAuth client of\n' +
      'type "Desktop app", or a Web client with http://127.0.0.1:8765 added to its\n' +
      'authorised redirect URIs.',
  );
  process.exit(1);
});
