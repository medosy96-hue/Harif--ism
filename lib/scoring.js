export function normFirstChar(word, letter) {
  const w = (word || '').trim().replace(/[\u064B-\u0652\u0670]/g, '');
  if (!w) return null;
  let c = w[0];
  if (letter === 'ا' && ['أ', 'إ', 'آ', 'ا'].includes(c)) return 'ا';
  return c;
}

export function isCorrect(word, letter) {
  if (!word || !word.trim()) return false;
  return normFirstChar(word, letter) === letter;
}
