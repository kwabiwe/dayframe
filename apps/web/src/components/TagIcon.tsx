export function TagIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 24 24" width={size}>
      <path
        clipRule="evenodd"
        d="M3 5.25A2.25 2.25 0 0 1 5.25 3h4.42c.6 0 1.17.24 1.59.66l9.08 9.08a2.25 2.25 0 0 1 0 3.18l-4.42 4.42a2.25 2.25 0 0 1-3.18 0l-9.08-9.08A2.25 2.25 0 0 1 3 9.67V5.25Zm4 3.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}
