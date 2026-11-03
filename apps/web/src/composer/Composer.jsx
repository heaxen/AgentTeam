import { useState } from 'react';
import { useStore } from '../store.jsx';
import { postMessage, postPause, postCancel } from '../api.js';
import { STAGE_TEXT } from '../text.js';

const CAN_SEND = new Set(['idle', 'arch_review', 'failed', 'paused', 'delivered', 'closed']);

export default function Composer() {
  const { state } = useStore();
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const { stage, running } = state;

  async function send(value) {
    const trimmed = value.trim();
    if (!trimmed) return;
    const result = await postMessage(trimmed);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setText('');
  }

  async function pause() {
    const result = await postPause();
    setError(result.ok ? null : result.error);
  }

  async function cancel() {
    const result = await postCancel();
    setError(result.ok ? null : result.error);
  }

  const placeholder =
    stage === 'failed'
      ? '修正后回复"重试"'
      : stage === 'paused'
        ? '回复"继续"接着做'
        : stage === 'arch_review'
          ? '输入方案字母，或写讨论意见'
          : stage === 'delivered' || stage === 'closed'
            ? '先发送"新需求"，再写下一条需求'
            : '输入需求';

  return (
    <section className="composer" aria-label="输入区">
      <p className="composer-stage">{STAGE_TEXT[stage] ?? stage}</p>
      {error && <p className="composer-error" role="alert">{error}</p>}
      <div className="composer-row">
        <textarea
          aria-label="需求或意见输入"
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter 发送，Shift+Enter 换行；运行中不发送。
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (!running && CAN_SEND.has(stage)) send(text);
            }
          }}
        />
        <div className="composer-actions">
          {!running && CAN_SEND.has(stage) && (
            <button type="button" className="primary" onClick={() => send(text)} disabled={!text.trim()}>
              发送
            </button>
          )}
          {!running && stage === 'failed' && (
            <button type="button" onClick={() => send('重试')}>重试</button>
          )}
          {!running && stage === 'paused' && (
            <button type="button" onClick={() => send('继续')}>继续</button>
          )}
          {running && (
            <>
              <button type="button" onClick={pause}>暂停</button>
              <button type="button" onClick={cancel}>取消</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
