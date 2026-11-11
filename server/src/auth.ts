// Invite-code check. The extension sends the person's code with every request
// in the "x-invite-code" header. Unknown or disabled codes are turned away.

import type { FastifyReply, FastifyRequest } from "fastify";
import { query } from "./db.js";
import { normalizeInviteCode } from "./invite-codes.js";

export interface User {
  id: number;
  name: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

export async function findActiveUser(code: string): Promise<User | null> {
  const r = await query<User>("SELECT id, name FROM users WHERE invite_code = $1 AND active = TRUE", [
    normalizeInviteCode(code),
  ]);
  return r.rows[0] ?? null;
}

// Add to a route as `preHandler: requireInvite`. On success, request.user is set.
export async function requireInvite(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers["x-invite-code"];
  const code = Array.isArray(header) ? header[0] : header;
  const user = code ? await findActiveUser(code) : null;
  if (!user) {
    return reply.code(401).send({
      error: "invalid_code",
      message: "This invite code isn't valid. Check it and try again.",
    });
  }
  request.user = user;
}
