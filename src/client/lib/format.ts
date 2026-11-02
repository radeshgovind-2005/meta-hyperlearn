/** "Midterm_2025.pdf" → "Midterm 2025" */
export function examLabel(filename: string | null | undefined): string {
  return (filename ?? "").replace(/\.\w+$/, "").replace(/[_-]+/g, " ").trim();
}

/** Drops a leading question number the model sometimes copies from the exam ("3. ", "Question 2:"). */
export function stripQuestionNumber(text: string): string {
  return text.replace(/^\s*(question\s*)?\d+\s*[.):]\s+/i, "");
}
