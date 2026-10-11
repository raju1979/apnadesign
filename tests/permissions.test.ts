import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("database enforces private projects, owner-only deletion, sharing and revocation", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid $$; create function auth.jwt() returns jsonb language sql stable as $$ select current_setting('request.jwt.claims',true)::jsonb $$; grant usage on schema auth to authenticated; grant execute on all functions in schema auth to authenticated;`,
    );
    await db.exec(
      (await readFile(
        "supabase/migrations/20261010144239_20261010_accounts_permissions.sql",
        "utf8",
      )) +
        "\n" +
        (await readFile(
          "supabase/migrations/20261010150529_anonymous_project_shares.sql",
          "utf8",
        )) +
        "\n" +
        (await readFile(
          "supabase/migrations/20261010150704_harden_project_share_rpcs.sql",
          "utf8",
        )),
    );
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
    ];
    for (const id of ids)
      await db.query("insert into auth.users values($1)", [id]);
    async function as(index: number) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({
          sub: ids[index],
          email: [
            "owner@example.test",
            "editor@example.test",
            "viewer@example.test",
            "outsider@example.test",
            null,
            null,
          ][index],
        }),
      ]);
      await db.exec("set role authenticated");
    }
    await as(0);
    await db.exec(
      `insert into public.formwork_projects(id,title,document) values('secure','Private','{"title":"Private","shapes":[]}'); insert into public.formwork_members values('secure','editor@example.test','editor'),('secure','viewer@example.test','viewer');`,
    );
    await as(1);
    assert.equal(
      (
        await db.query<{ r: string }>(
          "select formwork_private.project_role('secure') r",
        )
      ).rows[0].r,
      "editor",
    );
    await db.exec(
      `update public.formwork_projects set title='Edited' where id='secure'`,
    );
    await assert.rejects(() =>
      db.exec(
        `insert into public.formwork_members values('secure','outsider@example.test','editor')`,
      ),
    );
    await assert.rejects(() =>
      db.exec(
        `update public.formwork_projects set owner_id='${ids[1]}' where id='secure'`,
      ),
    );
    await as(2);
    assert.equal(
      (await db.query("select * from public.formwork_projects")).rows.length,
      1,
    );
    await db.exec(
      `update public.formwork_projects set title='Hacked' where id='secure'`,
    );
    assert.equal(
      (
        await db.query<{ title: string }>(
          "select title from public.formwork_projects",
        )
      ).rows[0].title,
      "Edited",
    );
    await assert.rejects(() =>
      db.exec(
        `insert into public.formwork_members values('secure','outsider@example.test','viewer')`,
      ),
    );
    await as(3);
    assert.equal(
      (await db.query("select * from public.formwork_projects")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.formwork_members")).rows.length,
      0,
    );
    await as(0);
    await db.exec(
      `delete from public.formwork_members where email='viewer@example.test'`,
    );
    await as(2);
    assert.equal(
      (await db.query("select * from public.formwork_projects")).rows.length,
      0,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(() =>
      db.exec("select * from public.formwork_projects"),
    );
    await as(0);
    const firstLinkHash = "a".repeat(64);
    await db.query("select public.create_project_share('secure',$1)", [
      firstLinkHash,
    ]);
    await as(4);
    assert.equal(
      (
        await db.query<{ claim_project_share: boolean }>(
          "select public.claim_project_share('secure',$1)",
          ["b".repeat(64)],
        )
      ).rows[0].claim_project_share,
      false,
      "a bad link token must not grant access",
    );
    assert.equal(
      (
        await db.query<{ claim_project_share: boolean }>(
          "select public.claim_project_share('secure',$1)",
          [firstLinkHash],
        )
      ).rows[0].claim_project_share,
      true,
    );
    assert.equal(
      (
        await db.query<{ get_project_role: string }>(
          "select public.get_project_role('secure')",
        )
      ).rows[0].get_project_role,
      "viewer",
    );
    assert.equal(
      (await db.query("select * from public.formwork_projects")).rows.length,
      1,
    );
    await db.exec(
      `update public.formwork_projects set title='Guest edit' where id='secure'`,
    );
    assert.equal(
      (
        await db.query<{ title: string }>(
          "select title from public.formwork_projects where id='secure'",
        )
      ).rows[0].title,
      "Edited",
      "guest share links must remain view-only",
    );
    await as(3);
    assert.equal(
      (await db.query("select * from public.formwork_projects")).rows.length,
      0,
      "unclaimed links must not grant access to other sessions",
    );
    await as(0);
    const secondLinkHash = "c".repeat(64);
    await db.query("select public.create_project_share('secure',$1)", [
      secondLinkHash,
    ]);
    await as(4);
    assert.equal(
      (
        await db.query<{ get_project_role: string | null }>(
          "select public.get_project_role('secure')",
        )
      ).rows[0].get_project_role,
      null,
      "rotating a link must invalidate access claimed through the old link",
    );
    await as(5);
    assert.equal(
      (
        await db.query<{ claim_project_share: boolean }>(
          "select public.claim_project_share('secure',$1)",
          [secondLinkHash],
        )
      ).rows[0].claim_project_share,
      true,
    );
    await as(0);
    assert.equal(
      (
        await db.query<{ revoke_project_share: boolean }>(
          "select public.revoke_project_share('secure')",
        )
      ).rows[0].revoke_project_share,
      true,
    );
    await as(5);
    assert.equal(
      (await db.query("select * from public.formwork_projects")).rows.length,
      0,
      "revoking a link must remove access for visitors who claimed it",
    );
    await as(0);
    await db.exec(
      `insert into public.formwork_projects(id,title,document) values('keep','Keep this project','{"title":"Keep","shapes":[]}');
       insert into public.formwork_members values('secure','viewer@example.test','viewer');`,
    );
    const deleteLinkHash = "d".repeat(64);
    await db.query("select public.create_project_share('secure',$1)", [
      deleteLinkHash,
    ]);
    await as(4);
    await db.query("select public.claim_project_share('secure',$1)", [
      deleteLinkHash,
    ]);
    for (const index of [1, 2, 3, 4]) {
      await as(index);
      assert.deepEqual(
        (
          await db.query(
            "delete from public.formwork_projects where id='secure' returning id",
          )
        ).rows,
        [],
        "editors, viewers, outsiders and guest viewers cannot delete a project",
      );
    }
    await as(0);
    assert.deepEqual(
      (
        await db.query(
          "delete from public.formwork_projects where id='secure' returning id",
        )
      ).rows,
      [{ id: "secure" }],
      "the owner can delete the selected project",
    );
    assert.deepEqual(
      (await db.query("select id from public.formwork_projects")).rows,
      [{ id: "keep" }],
      "deleting a project must not delete any other project",
    );
    await db.exec("reset role");
    for (const table of ["formwork_members", "formwork_share_links"])
      assert.equal(
        (
          await db.query(
            `select * from public.${table} where project_id='secure'`,
          )
        ).rows.length,
        0,
        "project deletion must remove membership and guest sharing records",
      );
    assert.equal(
      (await db.query("select * from formwork_private.project_share_guests"))
        .rows.length,
      0,
      "project deletion must also cascade through links to guest claims",
    );
    await as(1);
    assert.equal(
      (
        await db.query<{ get_project_role: string | null }>(
          "select public.get_project_role('secure')",
        )
      ).rows[0].get_project_role,
      null,
      "collaborators lose access to deleted projects",
    );
  } finally {
    await db.close();
  }
});
