import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { fetchRoles, putRoles, fetchAgents, postAuth } from '../api.js';
import { ROLE_ORDER, ROLE_NAMES } from '../text.js';

const OTHER_MODEL = '__other';

export default function Settings() {
  const { state } = useStore();
  const locked = state.running;
  const [roles, setRoles] = useState(null);
  const [agents, setAgents] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({ agent: 'claude', model: '', effort: '' });
  const [customModel, setCustomModel] = useState(false);
  const [keyFor, setKeyFor] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function load() {
    const [rolesResult, agentsResult] = await Promise.all([fetchRoles(), fetchAgents()]);
    if (rolesResult.ok) setRoles(rolesResult.data);
    else setError(rolesResult.error);
    if (agentsResult.ok) setAgents(agentsResult.data);
    else setError(agentsResult.error);
  }

  useEffect(() => {
    load();
  }, []);

  const agentInfo = agents?.find((agent) => agent.id === draft.agent);

  function startEdit(role) {
    const current = roles?.[role] ?? { agent: 'claude', model: null, effort: null };
    const models = agents?.find((agent) => agent.id === current.agent)?.models ?? [];
    setEditing(role);
    setDraft({ agent: current.agent, model: current.model ?? '', effort: current.effort ?? '' });
    setCustomModel(Boolean(current.model) && !models.includes(current.model));
    setError(null);
    setNotice(null);
  }

  async function saveRole() {
    const result = await putRoles({
      [editing]: {
        agent: draft.agent,
        model: draft.model.trim() ? draft.model.trim() : null,
        effort: draft.effort || null,
      },
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditing(null);
    setNotice('已保存角色分配');
    await load();
  }

  async function saveKey(agentId) {
    const result = await postAuth(agentId, { method: 'api', apiKey });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // key 只提交一次，成功后立刻清空，不再留在页面状态里。
    setApiKey('');
    setKeyFor(null);
    setNotice(`${agentId} 已保存 API key`);
    await load();
  }

  async function confirmLogin(agentId) {
    const result = await postAuth(agentId, { method: 'confirm' });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`${agentId} 已标记为已登录`);
    await load();
  }

  if (!roles || !agents) {
    return (
      <section className="settings" aria-label="角色分配与认证">
        <p className="settings-empty">{error ?? '正在读取角色分配…'}</p>
      </section>
    );
  }

  return (
    <section className="settings" aria-label="角色分配与认证">
      <h2>角色分配</h2>
      {locked && <p className="settings-note">流程运行中，不能修改角色分配。</p>}
      {error && <p className="settings-error" role="alert">{error}</p>}
      {notice && <p className="settings-notice">{notice}</p>}
      <ul className="settings-roles">
        {ROLE_ORDER.map((role) => {
          const assigned = roles[role];
          return (
            <li key={role} className="settings-role">
              <div className="settings-role-line">
                <span className="settings-role-name">{ROLE_NAMES[role]}</span>
                <span className="settings-role-value">
                  {assigned.agent}
                  {assigned.model ? ` / ${assigned.model}` : ''}
                  {assigned.effort ? ` / ${assigned.effort}` : ''}
                </span>
                <button type="button" onClick={() => startEdit(role)} disabled={locked}>修改</button>
              </div>
              {editing === role && (
                <div className="settings-editor">
                  <label>
                    agent
                    <select
                      aria-label="agent"
                      value={draft.agent}
                      onChange={(event) => {
                        setDraft({ agent: event.target.value, model: '', effort: '' });
                        setCustomModel(false);
                      }}
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    模型
                    {customModel ? (
                      <input
                        aria-label="模型"
                        value={draft.model}
                        onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                        placeholder="模型名"
                      />
                    ) : (
                      <select
                        aria-label="模型"
                        value={draft.model}
                        onChange={(event) => {
                          if (event.target.value === OTHER_MODEL) {
                            setCustomModel(true);
                            setDraft({ ...draft, model: '' });
                          } else {
                            setDraft({ ...draft, model: event.target.value });
                          }
                        }}
                      >
                        <option value="">agent 默认</option>
                        {(agentInfo?.models ?? []).map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                        <option value={OTHER_MODEL}>其他…</option>
                      </select>
                    )}
                  </label>
                  {(agentInfo?.efforts ?? []).length > 0 && (
                    <label>
                      强度
                      <select
                        aria-label="强度"
                        value={draft.effort}
                        onChange={(event) => setDraft({ ...draft, effort: event.target.value })}
                      >
                        <option value="">agent 默认</option>
                        {agentInfo.efforts.map((effort) => (
                          <option key={effort} value={effort}>{effort}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="settings-editor-actions">
                    <button type="button" className="primary" onClick={saveRole}>保存</button>
                    <button type="button" onClick={() => setEditing(null)}>取消</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h2>认证</h2>
      <ul className="settings-agents">
        {agents.map((agent) => (
          <li key={agent.id} className="settings-agent">
            <div className="settings-agent-line">
              <span>{agent.name}</span>
              <span className={agent.authenticated ? 'auth-ok' : 'auth-no'}>
                {agent.authenticated ? '已认证' : '未认证'}
              </span>
              {agent.kind === 'api'
                ? keyFor !== agent.id && (
                  <button type="button" onClick={() => { setKeyFor(agent.id); setApiKey(''); setError(null); }}>
                    填写 API key
                  </button>
                )
                : (
                  <button type="button" onClick={() => confirmLogin(agent.id)}>确认已登录</button>
                )}
            </div>
            {agent.kind === 'api' && keyFor === agent.id && (
              <div className="settings-key">
                <input
                  type="password"
                  aria-label={`${agent.name} 的 API key`}
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
                <button type="button" className="primary" onClick={() => saveKey(agent.id)}>保存 key</button>
                <button type="button" onClick={() => { setKeyFor(null); setApiKey(''); }}>取消</button>
              </div>
            )}
            {agent.kind !== 'api' && (
              <p className="settings-hint">先在终端完成该 agent 的登录，再点"确认已登录"。</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
