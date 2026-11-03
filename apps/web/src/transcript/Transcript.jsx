import { useEffect, useRef } from 'react';
import { useStore } from '../store.jsx';

const SPEAKER = { user: '你', team: '团队' };

export default function Transcript() {
  const { messages } = useStore();
  const boxRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const box = boxRef.current;
    if (box && stickRef.current) box.scrollTop = box.scrollHeight;
  }, [messages]);

  return (
    <section className="transcript" aria-label="对话记录">
      <div
        className="transcript-body"
        ref={boxRef}
        onScroll={() => {
          const box = boxRef.current;
          stickRef.current = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
        }}
      >
        {messages.length === 0 ? (
          <p className="transcript-empty">还没有对话，在下面输入需求开始。</p>
        ) : (
          messages.map((message) => (
            <div key={message.seq} className={`transcript-line from-${message.from}`}>
              <span className="transcript-speaker">{SPEAKER[message.from] ?? message.from}</span>
              <span className="transcript-text">{message.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
