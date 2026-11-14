// Admin command: read the "This flag is wrong" reports people sent.
//
//   npm run reports            the 20 newest
//   npm run reports -- 50      the 50 newest
//   npm run reports -- all     every report

import { closeDb, query } from "../src/db.js";

interface Row {
  created_at: Date;
  from_user: string;
  flag: string;
  quote: string;
  note: string | null;
  page: string | null;
}

const arg = process.argv[2];
const limit = arg === "all" ? null : Math.max(1, Number(arg) || 20);

const total = await query<{ n: number }>("SELECT count(*)::int AS n FROM reports");
const r = await query<Row>(
  `SELECT r.created_at, u.name AS from_user, r.flag->>'name' AS flag, r.flag->>'quote' AS quote, r.note, d.url AS page
     FROM reports r
     JOIN users u ON u.id = r.user_id
     LEFT JOIN analyses a ON a.id = r.analysis_id
     LEFT JOIN documents d ON d.id = a.document_id
    ORDER BY r.created_at DESC
    ${limit ? "LIMIT $1" : ""}`,
  limit ? [limit] : []
);

const n = total.rows[0]?.n ?? 0;
if (!n) {
  console.log("No reports yet.");
} else {
  console.log(`\n${n} report${n === 1 ? "" : "s"} in total${limit && n > limit ? `, showing the newest ${limit}` : ""}.\n`);
  const short = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
  for (const x of r.rows) {
    const when = x.created_at.toISOString().slice(0, 16).replace("T", " ");
    console.log(`${when} UTC · ${x.from_user}`);
    console.log(`  Flag:  ${x.flag}`);
    console.log(`  Quote: "${short(x.quote, 220)}"`);
    console.log(`  Note:  ${x.note ?? "(none)"}`);
    console.log(`  Page:  ${x.page ?? "(unknown)"}\n`);
  }
}
await closeDb();
