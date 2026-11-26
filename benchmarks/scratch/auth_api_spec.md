# User Authentication API Specification

## Overview
REST API providing secure user authentication endpoints for web and mobile clients.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | /api/auth/register | Create a new user account |
| POST | /api/auth/login | Authenticate and obtain tokens |
| POST | /api/auth/logout | Invalidate the current session |
| POST | /api/auth/refresh | Refresh an access token |
| POST | /api/auth/password/reset | Initiate password reset |
| PUT | /api/auth/password/reset/:token | Complete password reset |

## Endpoint Details

### POST /api/auth/register

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "Jane Doe"
}
```

**Response (201 Created):**
```json
{
  "ok": true,
  "user": { "id": "uuid", "email": "user@example.com", "name": "Jane Doe", "createdAt": "ISO8601" }
}
```

### POST /api/auth/login

**Request:**
```json
{ "email": "user@example.com", "password": "securepassword123" }
```

**Response (200 OK):**
```json
{
  "ok": true,
  "accessToken": "JWT",
  "refreshToken": "UUID",
  "expiresIn": 3600
}
```

### POST /api/auth/refresh

**Request:** Bearer token in Authorization header.

**Response (200 OK):**
```json
{ "ok": true, "accessToken": "new_JWT", "expiresIn": 3600 }
```

## Error Codes

| Code | Meaning |
|---|---|
| 400 | Validation error — missing or malformed field |
| 401 | Invalid credentials |
| 403 | Access denied |
| 409 | Email already registered |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

## Security Notes
- Passwords hashed with bcrypt (cost 12).
- Access tokens expire in 1 hour. Refresh tokens expire in 30 days.
- Password reset tokens expire in 15 minutes and are single-use.
- All endpoints enforce HTTPS in production.
