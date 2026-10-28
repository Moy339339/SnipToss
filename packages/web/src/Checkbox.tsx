/**
 * The checkbox graphic (visual only; clicks go to the button wrapping it: a small button on a card, the whole "Select all" row at the bottom
 * of the notes panel). 16 × 16, radius 4; unchecked is a gray outline, checked is a white tick on blue, partly checked is a white dash on blue
 * (docs/design-rules.md S4)
 */
export function CheckBox(props: { checked: boolean; mixed?: boolean }) {
  const on = props.checked || props.mixed;
  return (
    <span className={`checkbox${on ? " is-on" : ""}`} aria-hidden>
      {on && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={props.mixed ? "M4.75 8h6.5" : "M4.5 8.2l2.3 2.3 4.7-4.9"} />
        </svg>
      )}
    </span>
  );
}
