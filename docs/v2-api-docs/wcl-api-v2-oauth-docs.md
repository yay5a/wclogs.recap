# API Documentation

## Working With OAuth
```
Warcraft Logs Classic uses OAuth 2.0 for API authentication. OAuth allows clients to request and
then use an access token to authenticate API requests. We recommend that developers use
stable libraries for performing the OAuth process instead of implementing their own.
```
```
When using a library, developers typically need four items to get started: their client_id,
client_secret, authorize_uri, and token_uri.
```

## Client ID and Client Secret
```
The first step in using OAuth is getting a client_id and client_secret by creating a new client.
```
1. Log in to Warcraft Logs Classic.
2. Go to the client management page and click Create Client.
3. Enter a client name. The client name is used to identify the client in the list view. Client
    names will be visible to your site users when authorizing them.
4. Enter any redirect URIs needed. If you need to support multiple redirects you can separate
    the URLs with commas. Make sure you escape commas within a single URI.
5. Click Create.

## OAuth URIs
```
OAuth requires two commonly-used URIs to work properly. The authorize_uri gets user
authorization to allow applications to access certain information, such as the fights and events
of a private report. The token_uri submits items, such as authorization codes, to request access
tokens applications can use with the v2 API.
```

- The Authorization URI is: https://www.warcraftlogs.com/oauth/authorize
- The Token URI is: https://www.warcraftlogs.com/oauth/token

The v2 APIs require access tokens granted one of three possible flows: the client credentials
flow, the authorization code flow, or the PKCE code flow.

### Client Credentials Flow

The client credentials flow is used to access the public API. No user authorization is required in
this flow, and only public information is accessible, i.e., no private reports may be accessed.

The APIs under /api/v2/client are accessed using this flow.

In the OAuth client credentials flow, a pair of client credentials (client_id and client_secret) is
exchanged for an access token.

To request access tokens, an application must make a POST request with the following
multipart form data to the token URI: grant_type=client_credentials

The application must pass basic HTTP auth credentials using the client_id as the user and the
client_secret as the password.

```
curl -u {client_id}:{client_secret} -d grant_type=client_credentials https://www.warcraftlogs.com/oauth/token
```
After an application retrieves an access token, it provides that token when making requests to
API resources. This is done via an authorization header:

```
curl --header "Authorization: Bearer <access_token>" <GRAPHQL API URL>
```
If you wish to use the client credentials code flow with a browser-based application (where
CORS is an issue), then you will need to have a server that is responsible for obtaining access
tokens that can then be used in the browser. If you do not have a server, then you should
consider using the PKCE code flow instead.

### Authorization Code Flow

The OAuth 2.0 Authorization Code Flow allows an application to access a user's data on their
behalf. This allows an application to acquire more sensitive, opt-in information about a user,
such as a user's private reports, after obtaining the user's permission to do so. The
Authorization Code Flow has two major parts: the authorization code request and the
access token request.

The APIs under /api/v2/user are accessed using this flow.

For an authorization code request, an application needs to either redirect the browser or open a
new window to the authorize URI with the following query parameters:

After the user has granted authorization, the application sends the user back to the
redirect_uri site with the state query parameter and a code query parameter. code is the
authorization code that represents the user's agreement to allow an application to access their
private data.

To request access tokens, an application needs to provide the following POST parameters to the
token URI, using the developer's client ID and secret with HTTP basic authorization:

```
curl -X POST https://www.warcraftlogs.com/oauth/token
-u <client id>:<client secret>
-d redirect_uri=<redirect URI used in authorize request>
```
```
client_id
The developer's client ID.
state
A semi-random data blob to send back with when completing authorization.
redirect_uri
The redirect URL is where the user will be redirected after approving or denying a
request for authorization.
response_type
The code type being requested. For the authorization code flow, this value should be
code.
```
```
redirect_uri
The same redirect_uri used when obtaining the authorization.
grant_type
The previously-retrieved authorization_code.
code
The code for the specific grant_type used.
```
### Example Curl Request

```
-d grant_type=authorization_code
-d code=<authorization code>
```
After an application retrieves an access token, it provides that token when making requests to
API resources. This is done via an authorization header:

```
curl --header "Authorization: Bearer <access_token>" <GRAPHQL API URL>
```

### PKCE Code Flow

The OAuth 2.0 PKCE code flow allows an application to access a user's data on their behalf. This
allows an application to acquire more sensitive, opt-in information about a user, such as a
user's private reports, after obtaining the user's permission to do so. The PKCE code flow has
two major parts: the authorization code request and the access token request.

The APIs under /api/v2/user can be accessed using this flow. The PKCE code flow is used from
applications (e.g., browser-based apps) that are not able to securely access a client secret, so a
code challenge/verifier is used instead.

For an authorization code request, an application needs to either redirect the browser or open a
new window to the authorize URI with the following query parameters:

```
client_id
The developer's client ID.
code_challenge
The code challenge should be a Base64 encoded version of the code verifier string
with URL and filename-safe characters. The trailing '=' characters should be removed
and no line breaks, whitespace, or other additional characters should be present.
code_challenge_method
This should be set to S256.
state
A semi-random data blob to send back with when completing authorization.
redirect_uri
The redirect URL is where the user will be redirected after approving or denying a
request for authorization.
response_type
The code type being requested. For the PKCE code flow, this value should be code.
```

Both the state and the code verifier should be stored in the session so that the callback can
retrieve them.

### Example (PHP) of Generating the Code Verifier and Code Challenge
```
$code_verifier = Str::random(128);
$encoded = base64_encode(hash('sha256', $code_verifier, true));
$codeChallenge = strtr(rtrim($encoded, '='), '+/', '-_');
```
After the user has granted authorization, the application sends the user back to the
redirect_uri site with the state query parameter and a code query parameter. code is the
authorization code that represents the user's agreement to allow an application to access their
private data.

To request access tokens, an application needs to provide the following POST parameters to the
token URI:

After an application retrieves an access token, it provides that token when making requests to
API resources. This is done via an authorization header:

```
curl --header "Authorization: Bearer <access_token>" <GRAPHQL API URL>
```
```
client_id
The developer's client ID.
code_verifier
The code verifier should be a random string of between 43 and 128 characters
containing letters, numbers and "-", ".", "_", "~", as defined in the RFC 7636
specification. This should be retrieved from the session.
redirect_uri
The same redirect_uri used when obtaining the authorization.
grant_type
"authorization_code"
code
The code for the specific grant_type used.
```

### GraphQL

The v2 API uses GraphQL. We recommend using the Altair GraphQL client for working with
GraphQL. You can set up the Bearer authorization and work inside the app as an API
playground.

- The public API is found at https://www.warcraftlogs.com/api/v2/client. It uses the client
    credentials flow outlined in the OAuth section above, which means you just need to obtain
    an access token and include it in the Authorization field.
- The private API is found at https://www.warcraftlogs.com/api/v2/user. It uses the
    authorization code flow outlined in the OAuth section above, so you have to get the user's
    permission to view private reports before you can use this API.

### Viewing Detailed Documentation

GraphQL uses schemas that document everything, so if you use a client like Altair, you can fetch
the schemas and start browsing the API documentation in the client itself.

You can also view the schema in your browser by clicking here.

## Quota Management

Your usage of the API is rate-limited. Here's how to avoid running out of points.

### Caching Responses

Caching responses is the most effective way to reduce your usage. Cache data locally to avoid
repeated queries for the same information. Depending on your use-case, data can be cached
for various amounts of time.

#### What to cache

- Game data (abilities, classes): cache indefinitely. Only changes on content patches.
- Report metadata (fight list, actor list): we support both live logs (which continually upload
    new fights) and manual uploads (which upload all fights at once). We recommend having
    two cache policies to handle this:
       ◦ If a report has recent fights (less than a couple of hours old): cache for a short time
          period (5-10 minutes)

```
◦ If a report does not have recent fights: cache indefinitely. Old reports almost never have
new fights added.
```
- Report data (events, tables, graphs): if a fight does not have the inProgress flag set to
    true, cache indefinitely. These values will almost never change.
- Rankings, characters, guild data: cache for hours or longer, depending on how fresh you
    want your data.

### Queuing Requests

Rate-limiting is done on 1-hour cycles, meaning your points are fully reset every hour. To take
advantage of this, use a queue to avoid hitting the limit, and to spread out your usage over a
long period.

If you hit the limit, add all your requests to a queue and wait until your points reset before re-
sending them.

Rank your requests in terms of priority. If you're running low on points, pause your background
tasks until your points reset. You could run certain tasks only during off-peak hours.

### Monitoring Your Quota

Use the rateLimitData query to monitor your usage. You can append this to any of your
queries.

```
query {
rateLimitData {
limitPerHour
pointsSpentThisHour
pointsResetIn
}
}
```
### Example strategy

```
function trySendRequest() {
cachedResponse = cache.get(request.key)
if (cachedResponse) return cachedResponse
```
```
if (request.isLowPriority && pointsSpentThisHour / limitPerHour > 0.8) {
enqueueRequest(request)
return null
}
```

```
response = sendRequest(request)
cache.set(request.key, response)
return response
}
```

### Commercial Applications

Remember that if you're building a commercial application (earning revenue through ads,
subscriptions, or selling data), you must obtain prior approval.

See our API Terms and Conditions for more information

As always, we love to hear your feedback. Please join us on Discord to share any feedback and
suggestions, or to ask any questions.

Follow our Twitter for updates!

## Contact Us

If you have any support questions, please reach out to our support team at
support@warcraftlogs.com.
