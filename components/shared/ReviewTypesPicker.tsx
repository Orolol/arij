"use client";

const REVIEW_TYPES = [
  {
    value: "feature_review",
    label: "Feature Review",
    description:
      "Verifies feature completeness against acceptance criteria using all available tools",
  },
  {
    value: "security",
    label: "Security",
    description: "OWASP top 10, input validation, auth/authz, secrets exposure",
  },
  {
    value: "code_review",
    label: "Code Review",
    description: "Readability, DRY, error handling, performance, naming",
  },
  {
    value: "compliance",
    label: "Compliance / Accessibility",
    description: "WCAG accessibility, i18n readiness, license compliance",
  },
];

interface ReviewTypesPickerProps {
  selected: Set<string>;
  onToggle: (type: string) => void;
}

/** Checkbox cards for choosing which agent review types to dispatch. */
export function ReviewTypesPicker({ selected, onToggle }: ReviewTypesPickerProps) {
  return (
    <div className="space-y-3">
      {REVIEW_TYPES.map((type) => (
        <label
          key={type.value}
          className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-accent/50 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selected.has(type.value)}
            onChange={() => onToggle(type.value)}
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <div>
            <p className="text-sm font-medium">{type.label}</p>
            <p className="text-xs text-muted-foreground">{type.description}</p>
          </div>
        </label>
      ))}
    </div>
  );
}
