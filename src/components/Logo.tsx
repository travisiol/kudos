/** The KUDOS mark: a K folded from one ribbon, with a citron light streak. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <path d="M14 8h12v18l16-18h15L38 29l20 27H43L29 37l-3 3v16H14z" fill="#fff" />
      <path d="M26 26 42 8h15L38 29z" fill="#e7deff" />
      <path d="M20 50 47 20" stroke="#b6ff5c" strokeWidth="3" strokeLinecap="round" opacity=".9" />
    </svg>
  );
}
