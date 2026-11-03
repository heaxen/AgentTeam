import { useEffect, useRef } from 'react';
import { useStore } from '../store.jsx';
import { ROLE_NAMES, STATUS_TEXT, roleStatus } from '../text.js';

export default function RolePanel({ role }) {
  const view = useStore();
  const { running } = view.state;
  const status = roleStatus({ running, role, roleState: view.roleState });
  const outputs = view.outputs[role] ?? [];
  const files = view.files[role] ?? [];
  const boxRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [outputs]);

  return (
    <section className="role-panel" aria-label={`${ROLE_NAMES[role]} 的输出`}>
      <header className="role-panel-head">
        <h2>{ROLE_NAMES[role] ?? role}</h2>
        <span className="role-panel-status" data-status={status}>{STATUS_TEXT[status]}</span>
      </header>
      <div className="role-files">
        {files.length === 0 ? (
          <span className="role-empty">尚无产物</span>
        ) : (
          files.map((file, index) => <div key={`${file}-${index}`}>{file}</div>)
        )}
      </div>
      <div
        className="role-output"
        ref={boxRef}
        onScroll={() => {
          const box = boxRef.current;
          stickRef.current = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
        }}
      >
        {outputs.length === 0 ? (
          <span className="role-empty">等待输出…</span>
        ) : (
          outputs.map((chunk, index) => <span key={index}>{chunk}</span>)
        )}
      </div>
    </section>
  );
}
