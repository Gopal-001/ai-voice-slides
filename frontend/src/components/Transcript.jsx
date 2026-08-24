import { useEffect, useRef } from "react";

export default function Transcript({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <aside className="transcript">
      <h3>Conversation</h3>
      <div className="transcript-body">
        {messages.length === 0 && (
          <p className="transcript-empty">
            Turn on the mic and ask a question — the agent will answer out loud
            and jump to the matching slide.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <span className="msg-who">
              {m.role === "user" ? "You" : m.role === "ai" ? "AI" : ""}
            </span>
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </aside>
  );
}
