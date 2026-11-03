import { useStore } from '../store.jsx';
import { ROLE_ORDER, ROLE_NAMES, STAGE_TEXT, STATUS_TEXT, roleStatus } from '../text.js';

export default function Pipeline({ selected, onSelect }) {
  const view = useStore();
  const { stage, running } = view.state;

  return (
    <section className="pipeline" aria-label="流程状态">
      <h2 className="pipeline-stage">{STAGE_TEXT[stage] ?? stage}</h2>
      <ul className="pipeline-list">
        {ROLE_ORDER.map((role) => {
          const status = roleStatus({ running, role, roleState: view.roleState });
          return (
            <li key={role}>
              <button
                type="button"
                className="pipeline-item"
                aria-pressed={selected === role}
                data-status={status}
                onClick={() => onSelect?.(role)}
              >
                <span className="pipeline-dot" aria-hidden="true" />
                <span className="pipeline-name">{ROLE_NAMES[role]}</span>
                <span className="pipeline-status">{STATUS_TEXT[status]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
