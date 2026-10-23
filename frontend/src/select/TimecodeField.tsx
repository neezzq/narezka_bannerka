import { useEffect, useState } from "react";
import { formatTimecode, parseRange, parseTimecode, TimecodeError } from "@/lib/timecode";

/**
 * Timecode input (мм:сс / чч:мм:сс). Pasting a range like "1:23-2:10" into
 * either field calls onRange with both values.
 */
export function TimecodeField({
  label,
  value,
  onCommit,
  onRange,
  onError,
  invalid,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
  onRange: (start: number, end: number) => void;
  onError: (msg: string | null) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(formatTimecode(value, true));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setText(formatTimecode(value, true));
  }, [value, focused]);

  const commit = (raw: string) => {
    try {
      const range = parseRange(raw);
      if (range) {
        onRange(range[0], range[1]);
        onError(null);
        return;
      }
      onCommit(parseTimecode(raw));
      onError(null);
    } catch (e) {
      onError(e instanceof TimecodeError ? e.message : String(e));
      setText(formatTimecode(value, true));
    }
  };

  return (
    <label className={`flex min-w-0 flex-1 flex-col rounded-[12px] bg-fill-2 px-3 py-2 ${invalid ? "ring-2 ring-danger/70" : "focus-within:ring-2 focus-within:ring-accent/60"}`}>
      <span className="text-caption-1 text-label-2">{label}</span>
      <input
        value={text}
        inputMode="decimal"
        enterKeyHint="done"
        autoComplete="off"
        aria-label={label}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(e.currentTarget.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (/[-–—]|\.\./.test(pasted.trim().slice(1))) {
            e.preventDefault();
            commit(pasted);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-full min-w-0 bg-transparent text-title-3 font-semibold tabular-nums outline-none"
      />
    </label>
  );
}
