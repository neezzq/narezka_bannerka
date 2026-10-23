/** iOS-style spinner (12 fading bars). */
export function ActivityIndicator({ size = 20, className = "", label }: { size?: number; className?: string; label?: string }) {
  const bars = Array.from({ length: 12 });
  return (
    <span
      role="progressbar"
      aria-label={label ?? "Загрузка"}
      className={`inline-block text-label-2 ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        {bars.map((_, i) => (
          <rect
            key={i}
            x="46"
            y="6"
            width="8"
            height="26"
            rx="4"
            fill="currentColor"
            transform={`rotate(${i * 30} 50 50)`}
            style={{ animation: `bk-spin-fade 1s linear infinite`, animationDelay: `${(i - 12) / 12}s` }}
          />
        ))}
      </svg>
    </span>
  );
}
