import { test, expect } from '@playwright/test';

test('主线：从提需求到交付', async ({ page }) => {
  await page.goto('/');

  // 空态：阶段"等待需求"，五个角色都在
  await expect(page.getByRole('heading', { name: '等待需求' })).toBeVisible();
  for (const name of ['需求与原型', '架构师', '前端开发', '后端开发', '测试']) {
    await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  }

  // 提需求
  const input = page.getByRole('textbox', { name: '需求或意见输入' });
  await input.fill('做一个登录页面');
  await page.getByRole('button', { name: '发送' }).click();

  // 断言持久的东西：输出会留在角色面板里，不会因为状态翻页而消失。
  // "运行中"只是几百毫秒的中间态，拿它做断言会抖动——那种瞬时状态由组件测试覆盖。
  await expect(page.getByText('req-analyst 工作中')).toBeVisible();

  // 方案阶段：对话记录里出现两个方案
  await expect(page.getByRole('heading', { name: '等待选择方案' })).toBeVisible();
  await expect(page.getByText(/A\. Node \+ React/)).toBeVisible();
  await expect(page.getByText(/B\. Go \+ Vue/)).toBeVisible();

  // 选方案 A：等"发送"重新出现（收尾后 running 要延迟 200ms 才置回 false）
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible();
  await input.fill('A');
  await page.getByRole('button', { name: '发送' }).click();

  // 交付：阶段变成"已交付"，三个实现角色都显示"完成"，对话里有交付报告路径。
  // 不在这里断言"运行中"——它只存在几百毫秒，断言必然抖动。
  await expect(page.getByRole('heading', { name: '已交付' })).toBeVisible({ timeout: 30000 });
  for (const name of ['后端开发', '前端开发', '测试']) {
    await expect(page.getByRole('button', { name: new RegExp(`${name}\\s*完成`) })).toBeVisible();
  }
  await expect(page.getByText(/DELIVERY-001\.md/)).toBeVisible();
});
