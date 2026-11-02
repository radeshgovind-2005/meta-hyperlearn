// Demo course material, written for HyperLearn and released under CC BY 4.0.
// Two lecture decks, one past exam, and a narration script for a synthetic lecture recording.

export const COURSE = "MAT201 Linear Algebra";

export const L06 = {
  file: "L06_determinants_slides.pdf",
  title: "Lecture 6 · Determinants",
  slides: [
    { h: "Lecture 6: Determinants", b: ["MAT201 Linear Algebra", "What a single number tells you about a matrix"] },
    { h: "The determinant of a 2×2 matrix", b: ["For A = [[a, b], [c, d]], det(A) = ad − bc.", "Multiply the diagonal, then subtract the product of the off-diagonal entries.", "Example: det([[3, 2], [1, 4]]) = 3·4 − 2·1 = 10."] },
    { h: "What the determinant measures", b: ["A 2×2 matrix maps the unit square to a parallelogram.", "The area of that parallelogram is |det(A)|.", "A negative determinant means the map also flips orientation."] },
    { h: "Determinant zero", b: ["det(A) = 0 exactly when A squashes the plane onto a line or a point.", "Then the columns of A are linearly dependent.", "A matrix is invertible if and only if det(A) ≠ 0."] },
    { h: "A common sign mistake", b: ["det([[a, b], [c, d]]) = ad − bc, not ad + bc.", "The product of the off-diagonal entries is always subtracted.", "Check: det([[4, 1], [2, 3]]) = 12 − 2 = 10."] },
    { h: "Determinants with a variable", b: ["We will often need det(A − λI), where λ is unknown.", "Subtract λ only from the diagonal entries: A − λI = [[a − λ, b], [c, d − λ]].", "Then det(A − λI) = (a − λ)(d − λ) − bc, a polynomial in λ."] },
    { h: "Summary", b: ["det([[a, b], [c, d]]) = ad − bc.", "|det(A)| is the area scaling factor of the map.", "det(A) = 0 means A is not invertible.", "Next lecture: det(A − λI) = 0 gives the eigenvalues."] },
  ],
};

export const L07 = {
  file: "L07_eigenvectors_slides.pdf",
  title: "Lecture 7 · Eigenvectors and eigenvalues",
  slides: [
    { h: "Lecture 7: Eigenvectors and eigenvalues", b: ["MAT201 Linear Algebra", "The directions a matrix does not turn"] },
    { h: "Recap: matrices move vectors", b: ["A 2×2 matrix A sends each vector v in the plane to a new vector Av.", "In general A can stretch, flip and turn a vector at the same time."] },
    { h: "Most vectors change direction", b: ["Take A = [[2, 1], [1, 2]] and v = (1, 0).", "Then Av = (2, 1), which points in a different direction from v.", "So multiplying by A turned this vector."] },
    { h: "Definition", b: ["A nonzero vector v is an eigenvector of A if Av = λv for some scalar λ.", "The scalar λ is the eigenvalue that belongs to v.", "Eigenvectors are never the zero vector."] },
    { h: "What Av = λv means geometrically", b: ["Av lies on the same line through the origin as v: A does not turn v.", "If λ > 1 the eigenvector is stretched; if 0 < λ < 1 it is shrunk.", "If λ < 0 it is flipped to point the other way; if λ = 0 it is sent to the zero vector."] },
    { h: "Example: a symmetric matrix", b: ["Let A = [[2, 1], [1, 2]].", "A(1, 1) = (3, 3) = 3·(1, 1), so (1, 1) is an eigenvector with eigenvalue 3.", "A(1, −1) = (1, −1) = 1·(1, −1), so (1, −1) is an eigenvector with eigenvalue 1."] },
    { h: "Example: a diagonal matrix", b: ["For A = [[2, 0], [0, 3]], Ae₁ = 2e₁ and Ae₂ = 3e₂.", "So e₁ and e₂ are eigenvectors, with eigenvalues 2 and 3.", "The eigenvalues of a diagonal matrix are its diagonal entries."] },
    { h: "Any multiple works too", b: ["If v is an eigenvector with eigenvalue λ, so is cv for every scalar c ≠ 0.", "A(cv) = c(Av) = c(λv) = λ(cv).", "So we usually give one simple eigenvector for each eigenvalue."] },
    { h: "Finding eigenvalues", b: ["Av = λv is the same as (A − λI)v = 0.", "This has a nonzero solution v exactly when A − λI is not invertible.", "So the eigenvalues are the solutions of det(A − λI) = 0, the characteristic equation."] },
    { h: "The characteristic polynomial of a 2×2 matrix", b: ["For A = [[a, b], [c, d]]: det(A − λI) = (a − λ)(d − λ) − bc.", "Expanded: λ² − (a + d)λ + (ad − bc) = λ² − tr(A)λ + det(A).", "Its roots are the eigenvalues of A."] },
    { h: "Worked example: eigenvalues", b: ["A = [[4, 1], [2, 3]].", "det(A − λI) = (4 − λ)(3 − λ) − 2 = λ² − 7λ + 10.", "λ² − 7λ + 10 = (λ − 2)(λ − 5), so the eigenvalues are λ = 2 and λ = 5."] },
    { h: "Worked example: eigenvectors", b: ["For each eigenvalue, solve (A − λI)v = 0.", "λ = 5: A − 5I = [[−1, 1], [2, −2]], so −x + y = 0 and v = (1, 1).", "λ = 2: A − 2I = [[2, 1], [2, 1]], so 2x + y = 0 and v = (1, −2)."] },
    { h: "Check with trace and determinant", b: ["The eigenvalues add up to the trace: 2 + 5 = 7 = 4 + 3.", "The eigenvalues multiply to the determinant: 2 · 5 = 10 = 4·3 − 1·2.", "Use this check on every exam answer."] },
    { h: "Common mistakes", b: ["Subtract λ only on the diagonal of A.", "In (a − λ)(d − λ) − bc the product bc is subtracted, not added.", "An eigenvector must be nonzero; v = 0 always satisfies Av = λv and does not count."] },
    { h: "No real eigenvectors: rotations", b: ["R = [[0, −1], [1, 0]] turns every vector by 90 degrees.", "det(R − λI) = λ² + 1, which has no real roots.", "So a rotation by 90 degrees has no real eigenvalues and no real eigenvectors."] },
    { h: "Why eigenvectors matter", b: ["Next lecture: diagonalization writes A using its eigenvectors.", "In a Markov chain, the long-run state is an eigenvector with eigenvalue 1.", "In PCA, the eigenvectors of the covariance matrix are the directions of largest variance."] },
    { h: "Summary", b: ["v ≠ 0 is an eigenvector of A if Av = λv; λ is its eigenvalue.", "Eigenvalues solve det(A − λI) = 0.", "For each λ, solve (A − λI)v = 0 to get its eigenvectors.", "Check: sum of eigenvalues = trace, product = determinant."] },
  ],
};

export const EXAM = {
  file: "Midterm_2025.pdf",
  title: "MAT201 Linear Algebra · Midterm 2025",
  instructions: [
    "Time: 90 minutes. Total: 44 points.",
    "Show all work. Answers without justification receive no credit.",
    "Write vectors as column vectors and give each eigenvector together with its eigenvalue.",
  ],
  questions: [
    { pts: 6, q: "Compute the determinant of A = [[3, 2], [1, 4]]. Is A invertible? Justify your answer." },
    { pts: 10, q: "Let A = [[4, 1], [2, 3]]. (a) Find the characteristic polynomial of A. (b) Find the eigenvalues of A. (c) Find one eigenvector for each eigenvalue." },
    { pts: 6, q: "Is v = (1, 1) an eigenvector of B = [[2, 1], [1, 2]]? If so, give its eigenvalue. Show the multiplication." },
    { pts: 8, q: "Let C = [[1, 2], [2, 1]]. Find the eigenvalues of C and check your answer using the trace and the determinant of C." },
    { pts: 6, q: "Explain geometrically what it means for a 2×2 matrix to have an eigenvalue equal to 0. What does this say about its determinant?" },
    { pts: 8, q: "Show that the rotation matrix R = [[0, −1], [1, 0]] has no real eigenvalues. Interpret your answer geometrically." },
  ],
};

/** Narration for the synthetic lecture recording (read by macOS `say`). */
export const NARRATION = [
  "Welcome to lecture seven. Today is about eigenvectors and eigenvalues.",
  "Last time we saw that a two by two matrix moves vectors in the plane. It can stretch them, flip them, and turn them, all at once.",
  "Take the matrix two, one, one, two, and the vector one, zero. Multiplying gives two, one. That points in a different direction, so the matrix turned this vector.",
  "Here is the key idea. Some special vectors are not turned at all. If you only remember one thing from today, remember this: A times v lands on the same line as v.",
  "Formally, a nonzero vector v is an eigenvector of A if A v equals lambda times v, for some number lambda. That number lambda is the eigenvalue.",
  "If lambda is bigger than one, the eigenvector gets stretched. If lambda is between zero and one, it shrinks. If lambda is negative, it flips around. And if lambda is zero, it gets sent to the zero vector.",
  "For the matrix two, one, one, two, the vector one, one goes to three, three. That is three times the original vector, so the eigenvalue is three. The vector one, minus one, goes to itself, so its eigenvalue is one.",
  "How do we find eigenvalues in general? A v equals lambda v is the same as A minus lambda I, times v, equals zero. That has a nonzero solution exactly when the determinant of A minus lambda I is zero.",
  "So we solve the characteristic equation: determinant of A minus lambda I equals zero. For a two by two matrix that is a quadratic in lambda.",
  "Let us do the exam favourite: the matrix four, one, two, three. Subtract lambda on the diagonal only. Four minus lambda, times three minus lambda, minus two. That is lambda squared, minus seven lambda, plus ten.",
  "Careful here. Students often add the off-diagonal product instead of subtracting it. It is always minus b times c.",
  "Lambda squared minus seven lambda plus ten factors as lambda minus two, times lambda minus five. So the eigenvalues are two and five.",
  "For each eigenvalue, solve A minus lambda I times v equals zero. For five, we get v equals one, one. For two, we get v equals one, minus two.",
  "Always check: the eigenvalues add up to the trace, seven, and multiply to the determinant, ten. Two plus five is seven, and two times five is ten. Good.",
  "One last example. A rotation by ninety degrees turns every vector, so it has no real eigenvectors. Its characteristic polynomial is lambda squared plus one, which has no real roots.",
  "Next lecture we use eigenvectors to diagonalize a matrix. See you then.",
];
