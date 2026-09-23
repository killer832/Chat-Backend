# Chat Backend API

## Base URL

```text
http://localhost:3000
```

The port can be changed with the `PORT` environment variable.

## HTTP API

### Register a user

```http
POST /register
Content-Type: application/json
```

Request body:

```json
{
  "username": "user1",
  "email": "user1@example.com",
  "password": "secret123"
}
```

Successful response (`200 OK`):

```json
{
  "message": "user register successfully",
  "username": "user1",
  "email": "user1@example.com",
  "Token": "Bearer <jwt-token>"
}
```

Validation errors return `400 Bad Request`. If the email or username is already registered, the server returns `409 Conflict`.

### Log in

```http
POST /login
Content-Type: application/json
```

Request body:

```json
{
  "email": "user1@example.com",
  "password": "secret123"
}
```

Successful response (`200 OK`):

```json
{
  "message": "Login successful",
  "username": "user1",
  "email": "user1@example.com",
  "Token": "Bearer <jwt-token>"
}
```

Example request:

```js
const response = await fetch("http://localhost:3000/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    email: "user1@example.com",
    password: "secret123"
  })
});

const { Token } = await response.json();
```

Invalid credentials return `404` or `401` with:

```json
{
  "message": "Invalid email or password"
}
```

## Socket.IO API

Connect to Socket.IO using the token returned by `/register` or `/login`. The token must be sent in the handshake `Authorization` header:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  extraHeaders: {
    authorization: "Bearer <jwt-token>"
  }
});
```

The server identifies the user from the JWT and automatically marks the socket as online. There is no client-side `register` event.

### `message`

Sends a direct message to another user by username.

Client emits:

```js
socket.emit("message", {
  to: "user2",
  data: "Hello"
});
```

Payload:

| Field | Type | Required | Description |
|---|---|---:|---|
| `to` | string | Yes | The recipient's username. |
| `data` | string | Yes | The message content. |

The recipient receives:

```js
socket.on("message", (payload) => {
  console.log(payload);
});
```

Message payload:

```json
{
  "id": "message-id",
  "from": "user1",
  "message": "Hello",
  "deliveredAt": "2026-09-23T12:00:00.000Z"
}
```

Messages are saved even when the recipient is offline. Offline messages are delivered automatically when the recipient reconnects.

### `message-expired`

Marks a delivered message as inactive after at least ten minutes have elapsed since delivery.

Client emits:

```js
socket.emit("message-expired", {
  messageId: "message-id"
});
```

Payload:

| Field | Type | Required | Description |
|---|---|---:|---|
| `messageId` | string | Yes | The ID of the received message. |

The server only expires messages belonging to the connected user that are still active and have a delivery timestamp.

### `disconnect`

Socket.IO emits this event when the client disconnects. The server removes the user's username from the online-user map.

## Socket connection errors

Missing authorization header:

```text
Auth header is missing
```

Invalid or expired JWT:

```text
Authentication error: Invalid token
```

## Complete client example

```js
import { io } from "socket.io-client";

const loginResponse = await fetch("http://localhost:3000/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    email: "user1@example.com",
    password: "secret123"
  })
});

const { Token } = await loginResponse.json();

const socket = io("http://localhost:3000", {
  extraHeaders: {
    authorization: Token
  }
});

socket.on("connect", () => {
  socket.emit("message", {
    to: "user2",
    data: "Hello from user1"
  });
});

socket.on("message", ({ id, from, message, deliveredAt }) => {
  console.log({ id, from, message, deliveredAt });
});
```

## Implementation notes

- The response currently uses `Token` and the registration message contains the spelling `sucessfully`; clients should use these exact fields and values until the API is versioned.
- The JWT secret must be configured with the `JWT_SECRET` environment variable.
- Passwords are hashed with bcrypt before they are stored.

The port can be changed with the `PORT` environment variable.

## Authentication

The server uses JSON Web Tokens (JWTs) for Socket.IO connections.

### Register a user

```http
POST /register
Content-Type: application/json
```

Request body:

```json
{
  "username": "user1"
}
```

Successful response:

```json
{
  "message": "user register sucessfully",
  "Token": "Bearer <jwt-token>"
}
```

The returned token must be sent when connecting to Socket.IO:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  extraHeaders: {
    authorization: "Bearer <jwt-token>"
  }
});
```

### Log in

```http
POST /login
Content-Type: application/json
```

Request body:

```json
{
  "email": "user1@example.com",
  "password": "secret123"
}
```

Successful response:

```json
{
  "message": "Login successful",
  "username": "user1",
  "email": "user1@example.com",
  "Token": "Bearer <jwt-token>"
}
```

Example request:

```js
const response = await fetch(
  "http://localhost:3000/login",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: "user1@example.com",
      password: "secret123"
    })
  }
);

const { Token } = await response.json();
```

## Socket.IO API

Connect to the server using Socket.IO. The server checks the `Authorization` header during the handshake.

```text
Authorization: Bearer <jwt-token>
```

### `register`

Registers the connected socket for direct messages.

Client emits:

```js
socket.emit("register", {
  userId: "user-2"
});
```

Payload:

| Field | Type | Required | Description |
|---|---|---:|---|
| `userId` | string | Yes | The identifier other users use to send messages to this user. |

### `message`

Sends a direct message to an online user.

Client emits:

```js
socket.emit("message", {
  to: "user-2",
  data: "Hello"
});
```

Payload:

| Field | Type | Required | Description |
|---|---|---:|---|
| `to` | string | Yes | The recipient's registered user ID. |
| `data` | string | Yes | The message content. |

The recipient receives:

```js
socket.on("message", (payload) => {
  console.log(payload);
});
```

Payload received by the recipient:

```json
{
  "from": "user1",
  "message": "Hello"
}
```

If the recipient is offline or has not registered a socket, the message is ignored.

### `disconnect`

Socket.IO emits this event when the client disconnects. The server removes the user's socket registration.

## Error responses

### Missing username

```json
{
  "message": "Username is requierd"
}
```

### Missing authorization header

The Socket.IO connection is rejected with:

```text
Auth header is missing
```

### Invalid JWT

The Socket.IO connection is rejected with:

```text
Authentication error: Invalid token
```

## Example client flow

```js
import { io } from "socket.io-client";

const registration = await fetch("http://localhost:3000/register", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ username: "user1" })
});

const { Token } = await registration.json();

const socket = io("http://localhost:3000", {
  extraHeaders: {
    authorization: Token
  }
});

socket.on("connect", () => {
  socket.emit("register", { userId: "user-1" });
  socket.emit("message", {
    to: "user-2",
    data: "Hello from user1"
  });
});

socket.on("message", ({ from, message }) => {
  console.log(`${from}: ${message}`);
});
```

## Current implementation notes

- `server.js` should enable JSON request parsing with `app.use(express.json())` before reading `req.body` in `/register`.
- The Socket.IO middleware should extract the JWT with `authHeader.split(" ")[1]` when the header uses the `Bearer <token>` format.
- The `message` handler currently references `from`, which is undefined. The sender should come from `socket.user.username`.
- The `disconnect` handler currently references `userId`, which is out of scope. Store the registered user ID on the socket before deleting it from `onlineUsers`.
- The JWT secret is hard-coded. Production deployments should load it from an environment variable.
- The response property `Token` and the message spelling `sucessfully` are kept here as implemented, but should be renamed in a future API cleanup to `token` and `successfully`.
