import type { Page } from '@playwright/test';
import type { Pool } from 'pg';
import { test, expect, login } from './fixtures';

/**
 * BOW-841 /work on the real reads: the workbench (BOW-838) for three roles and the
 * reassignment flow (BOW-899) end to end, on the seeded demo database. Handover work is
 * set up the way BOW-899 records it: an item bound to an evaluator whose relation is
 * revoked, with another current evaluator on the same node and person.
 */

type Handover = {
  node: string;
  person: string;
  personName: string;
  oldRelation: string;
  oldEvaluator: string;
  oldName: string;
  newEvaluator: string;
  newName: string;
};

/** A seeded relation HR can manage, and a second evaluator on the same node. */
async function pickHandover(pool: Pool): Promise<Handover> {
  const { rows } = await pool.query<Handover>(`
    with hr as (
      select b.person_id, g.cohort_id
      from auth_user u
      join directory_account_bindings b on b.account_id = u.id
      join directory_grants g on g.account_id = b.account_id and g.role = 'hr'
      where u.email = 'hrbp@qtalent.test'
    )
    select r.evaluation_node_id as node, r.person_id as person,
      subject.name as "personName", r.id as "oldRelation",
      r.evaluator_id as "oldEvaluator", old.name as "oldName",
      other.evaluator_id as "newEvaluator", fresh.name as "newName"
    from programs_evaluation_relations r
    join programs_evaluation_nodes n on n.id = r.evaluation_node_id
    join hr on hr.cohort_id = n.cohort_id
    join lateral (
      select r2.evaluator_id from programs_evaluation_relations r2
      where r2.evaluation_node_id = r.evaluation_node_id
        and r2.evaluator_id not in (r.evaluator_id, r.person_id, hr.person_id)
        and r2.revoked_at is null
      order by r2.id limit 1
    ) other on true
    join directory_people subject on subject.id = r.person_id
    join directory_people old on old.id = r.evaluator_id
    join directory_people fresh on fresh.id = other.evaluator_id
    where r.revoked_at is null and r.evaluator_id <> hr.person_id
    order by r.id limit 1`);
  expect(rows, 'seed has a relation HR manages').toHaveLength(1);
  return rows[0];
}

/** Items bound to the old relation, which then ends; the new evaluator joins the node. */
async function leaveWork(pool: Pool, handover: Handover, items: string[]) {
  await pool.query(
    `insert into programs_evaluation_relations
       (id, evaluation_node_id, person_id, evaluator_id, kind, valid_from)
     values ('e2e-rel-new', $1, $2, $3, 'mentor', '2026-09-01T00:00:00Z')`,
    [handover.node, handover.person, handover.newEvaluator],
  );
  for (const id of items)
    await pool.query(
      `insert into programs_evaluation_work_items
         (id, evaluation_node_id, person_id, assigned_relation_id,
          assigned_evaluator_id, kind, resource_id, state, updated_at)
       values ($1, $2, $3, $4, $5, 'confirmation', $1, 'pending',
         '2026-09-02T00:00:00Z')`,
      [
        id,
        handover.node,
        handover.person,
        handover.oldRelation,
        handover.oldEvaluator,
      ],
    );
  // The business clock in tests is 2026-09-04T00:00Z.
  await pool.query(
    `update programs_evaluation_relations set revoked_at = '2026-09-03T00:00:00Z'
     where id = $1`,
    [handover.oldRelation],
  );
}

const assignee = async (pool: Pool, id: string) =>
  (
    await pool.query<{ assigned_evaluator_id: string; revision: number }>(
      'select assigned_evaluator_id, revision from programs_evaluation_work_items where id = $1',
      [id],
    )
  ).rows[0];

async function openReassign(page: Page, handover: Handover, count: number) {
  await page.goto('/work');
  const row = page.getByRole('link', {
    name: new RegExp(
      `${handover.oldName}的评价关系已结束：${count} 件事待接手`,
    ),
  });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/work\/reassign$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('重新分派');
}

test('managers, HR and mentors get their own /work from the real read', async ({
  context,
  page,
  referenceApp,
}) => {
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto('/work');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('，');
  await expect(page.locator('.nt-head p')).toHaveText(
    '9 月 4 日 · 周五 · 全部人才项目',
  );
  await expect(page.getByRole('region', { name: '找人' })).toBeVisible();
  // Not connected blocks: none rendered, no counts.
  await expect(page.locator('.nt-ceo, #todo, #btn-export, #jsig')).toHaveCount(
    0,
  );

  await context.clearCookies();
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/work');
  await expect(page.locator('.nt-head p')).toHaveText('9 月 4 日 · 周五');
  await expect(
    page.getByRole('textbox', { name: '描述你要做的事' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: '找人' })).toHaveCount(0);
  // Nothing to hand over in the seed, and the other groups are not connected.
  await expect(page.locator('#todo, .nt-cols, #btn-export')).toHaveCount(0);

  await context.clearCookies();
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto('/work');
  await expect(page.getByRole('region', { name: '找人' })).toHaveCount(0);
  const students = page.locator('#students');
  await expect(students.locator('h3')).toHaveText(/^我带的学员\d+ 人$/);
  const names = await students.locator('.n-students__list b').allTextContents();
  expect(names.length).toBeGreaterThan(0);
  // Activity is unknown in the read: the second line never says 本周待记 or 0.
  await expect(students).not.toContainText('本周待记');
  await expect(page.locator('#todo, #recos, details#fold')).toHaveCount(0);

  await context.clearCookies();
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/work');
  await expect(page.getByText('这一页属于业务视角').first()).toBeVisible();
});

test('HR hands work over from /work by keyboard, and it moves in the database', async ({
  context,
  page,
  referenceApp,
}) => {
  const handover = await pickHandover(referenceApp.pool);
  await leaveWork(referenceApp.pool, handover, ['e2e-work-1']);
  await login(context, 'hrbp', referenceApp.baseURL);
  await openReassign(page, handover, 1);

  const card = page.locator('article', { hasText: handover.oldName }).first();
  await expect(card).toContainText('评价关系已结束');
  await expect(
    page.getByRole('checkbox', { name: new RegExp(handover.personName) }),
  ).toBeChecked();
  const pick = page.getByRole('radio', { name: new RegExp(handover.newName) });
  await pick.focus();
  await page.keyboard.press('Enter');
  await expect(pick).toHaveAttribute('aria-checked', 'true');
  const go = page.locator('#ra-go');
  await expect(go).toHaveText(`交给${handover.newName} · 1 件`);
  await go.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {
    name: `交给${handover.newName}？`,
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: `交给${handover.newName}` })
    .press('Enter');
  await expect(page.getByText(`已交给${handover.newName} 1 件`)).toBeVisible();
  await expect(page.getByText('需要重新分派的事都处理完了')).toBeVisible();
  expect(await assignee(referenceApp.pool, 'e2e-work-1')).toEqual({
    assigned_evaluator_id: handover.newEvaluator,
    revision: 2,
  });
  await page.goto('/work');
  await expect(page.locator('#todo')).toHaveCount(0);
});

test('an item that changed meanwhile is reported, and an unanswered one is retried', async ({
  context,
  page,
  referenceApp,
}) => {
  const handover = await pickHandover(referenceApp.pool);
  await leaveWork(referenceApp.pool, handover, ['e2e-work-1', 'e2e-work-2']);
  await login(context, 'hrbp', referenceApp.baseURL);
  await openReassign(page, handover, 2);
  // Someone else handled e2e-work-2 after the page loaded.
  await referenceApp.pool.query(
    `update programs_evaluation_work_items set revision = revision + 1
     where id = 'e2e-work-2'`,
  );

  // The first request never reaches the server.
  let dropped = 0;
  await page.route('**/work/reassign', async (route) => {
    if (route.request().method() === 'POST' && dropped === 0) {
      dropped++;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('radio', { name: new RegExp(handover.newName) }).click();
  await page.locator('#ra-go').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: `交给${handover.newName}` })
    .click();
  const failed = page.locator('#ra-failed');
  await expect(failed).toContainText('提交中断：1 件待重新提交。');
  await expect(
    page.getByRole('alert').filter({ hasText: '已有变化' }),
  ).toContainText(`${handover.personName} · 确认建议分：分派状态已更新`);
  expect((await assignee(referenceApp.pool, 'e2e-work-1')).revision).toBe(1);

  await failed.getByRole('button', { name: '重试' }).click();
  await expect(failed).toHaveCount(0);
  await expect(page.getByText(`已交给${handover.newName} 1 件`)).toBeVisible();
  expect(await assignee(referenceApp.pool, 'e2e-work-1')).toEqual({
    assigned_evaluator_id: handover.newEvaluator,
    revision: 2,
  });
  // The changed item stays with its original owner and is still listed.
  expect(await assignee(referenceApp.pool, 'e2e-work-2')).toEqual({
    assigned_evaluator_id: handover.oldEvaluator,
    revision: 2,
  });
  await expect(
    page.getByRole('checkbox', { name: new RegExp(handover.personName) }),
  ).toHaveCount(1);
});

test('only HR reaches the reassignment page', async ({
  context,
  page,
  referenceApp,
}) => {
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto('/work/reassign');
  await expect(page.getByText('重新分派由 HR 处理')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('link', { name: '回到工作台' }).click();
  await expect(page).toHaveURL(/\/work$/);
});
