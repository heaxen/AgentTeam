import { useState } from 'react';
import { createStore, StoreProvider, useEventStream, useStore } from './store.jsx';
import Pipeline from './pipeline/Pipeline.jsx';
import Transcript from './transcript/Transcript.jsx';
import Composer from './composer/Composer.jsx';
import RolePanel from './role-panel/RolePanel.jsx';
import Settings from './settings/Settings.jsx';
import './pipeline/pipeline.css';
import './transcript/transcript.css';
import './role-panel/role-panel.css';
import './composer/composer.css';
import './settings/settings.css';

// 模块级单例在测试里会跨用例串状态：App 每次渲染都用传入的 store（测试总是传），
// 只有生产环境才用到这个单例。
const defaultStore = createStore();
const CONNECT_TEXT = { connecting: '连接中', live: '已连接', error: '连接中断，正在重连…' };

function Shell({ store }) {
  useEventStream(store);
  const { status } = useStore();
  const [selected, setSelected] = useState('req-analyst');

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">AgentTeam 指挥台</span>
        <span className="app-conn" data-status={status}>{CONNECT_TEXT[status]}</span>
      </header>
      <div className="app-body">
        <main className="app-main">
          <Transcript />
          <RolePanel role={selected} />
          <Composer />
        </main>
        <aside className="app-side">
          <Pipeline selected={selected} onSelect={setSelected} />
          <Settings />
        </aside>
      </div>
    </div>
  );
}

export default function App({ store = defaultStore }) {
  return (
    <StoreProvider store={store}>
      <Shell store={store} />
    </StoreProvider>
  );
}
