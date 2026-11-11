// Admin command for invite codes.
//
//   npm run invite -- create "Ada Obi"     make a code for one person
//   npm run invite -- list                 show everyone and their codes
//   npm run invite -- disable CM-XXXX-XXXX stop a code from working
//   npm run invite -- enable  CM-XXXX-XXXX turn it back on

import { closeDb, query } from "../src/db.js";
import { generateInviteCode, normalizeInviteCode } from "../src/invite-codes.js";

async function create(name: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    const r = await query<{ id: number }>(
      "INSERT INTO users (name, invite_code) VALUES ($1, $2) ON CONFLICT (invite_code) DO NOTHING RETURNING id",
      [name, code]
    );
    if (r.rowCount === 1) {
      console.log(`Created invite for ${name}: ${code}`);
      return;
    }
  }
  throw new Error("Could not make a unique code. Try again.");
}

async function list() {
  const r = await query<{ name: string; invite_code: string; active: boolean; created_at: Date }>(
    "SELECT name, invite_code, active, created_at FROM users ORDER BY created_at"
  );
  if (r.rowCount === 0) {
    console.log("No invites yet.");
    return;
  }
  for (const u of r.rows) {
    const date = u.created_at.toISOString().slice(0, 10);
    console.log(`${u.invite_code}  ${u.active ? "active  " : "disabled"}  ${date}  ${u.name}`);
  }
}

async function setActive(code: string, active: boolean) {
  const r = await query<{ name: string }>("UPDATE users SET active = $1 WHERE invite_code = $2 RETURNING name", [
    active,
    normalizeInviteCode(code),
  ]);
  if (r.rowCount === 0) console.log(`No invite found with code ${code}.`);
  else console.log(`${active ? "Enabled" : "Disabled"} ${normalizeInviteCode(code)} (${r.rows[0]!.name}).`);
}

const [command, arg] = process.argv.slice(2);
try {
  if (command === "create" && arg?.trim()) await create(arg.trim());
  else if (command === "list") await list();
  else if (command === "disable" && arg) await setActive(arg, false);
  else if (command === "enable" && arg) await setActive(arg, true);
  else {
    console.log('Usage: npm run invite -- create "Name" | list | disable CODE | enable CODE');
    process.exitCode = 1;
  }
} finally {
  await closeDb();
}
