export default function SlideDeck({ slides, current, onNavigate, onPresent }) {
  const slide = slides[current];

  if (!slide) {
    return <div className="slide slide-empty">Loading slides…</div>;
  }

  return (
    <div className="deck">
      <div className="slide" key={slide.id}>
        <div className="slide-number">
          {current + 1} / {slides.length}
        </div>
        <h2>{slide.title}</h2>
        {slide.subtitle && <p className="subtitle">{slide.subtitle}</p>}
        <ul>
          {slide.bullets.map((b, i) => (
            <li key={i} style={{ animationDelay: `${i * 120}ms` }}>
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div className="deck-controls">
        <button onClick={() => onNavigate(current - 1)} disabled={current === 0}>
          ← Prev
        </button>
        <div className="dots">
          {slides.map((s, i) => (
            <button
              key={s.id}
              className={`dot ${i === current ? "dot-active" : ""}`}
              onClick={() => onNavigate(i)}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
        <button onClick={() => onNavigate(current + 1)} disabled={current === slides.length - 1}>
          Next →
        </button>
        <button className="present-button" onClick={onPresent}>
          🗣 Present this slide
        </button>
      </div>
    </div>
  );
}
