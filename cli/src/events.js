// 事件输出：CLI 的每个动作都可以以 JSON 行的形式输出（--json）。
// 这是给未来 Web 界面、移动端和小程序预留的开放接口：它们只需读取这些事件，
// 不需要了解 CLI 内部实现。字段只增不减，变更时升级 SCHEMA_VERSION。
export const SCHEMA_VERSION = 1;

export function createEmitter({ json }) {
  return function emit(type, data = {}) {
    if (json) {
      process.stdout.write(
        JSON.stringify({ v: SCHEMA_VERSION, type, time: new Date().toISOString(), ...data }) + '\n',
      );
    }
  };
}
