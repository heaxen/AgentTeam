import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest 没有开 globals，@testing-library/react 的自动 cleanup 不会注册。
// 不手动清理的话，同一个文件里后一个用例会看到前一个用例留下的 DOM。
afterEach(() => {
  cleanup();
});
