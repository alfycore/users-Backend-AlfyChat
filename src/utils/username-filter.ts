// ==========================================
// ALFYCHAT - FILTRE DE PSEUDOS
// Bloque les pseudos injurieux, haineux ou usurpant l'identité du staff.
// ==========================================

export type TermMatch = 'substring' | 'word' | 'exact';

export interface FilterResult {
  ok: boolean;
  /** Message affichable à l'utilisateur */
  reason?: string;
  /** Terme qui a déclenché le blocage (usage interne / logs) */
  term?: string;
}

/**
 * Termes bloqués dès qu'ils apparaissent n'importe où dans le pseudo normalisé.
 * Réservé aux insultes et injures sans usage légitime possible.
 */
const SUBSTRING_TERMS = [
  // Injures racistes / haineuses
  'nigger', 'niggr', 'negresse', 'bougnoule', 'bicot', 'youpin', 'chinetoque',
  'ratonnade', 'sale arabe', 'salejuif', 'salenoir', 'salearabe',
  'kike', 'chink', 'wetback', 'gook',
  // Homophobie / transphobie
  'faggot', 'fagot', 'tarlouze', 'tapette', 'tranny', 'enculedesa',
  // Apologie / nazisme
  'hitler', 'adolfhitler', 'heilhitler', 'nazi', 'nsdap', 'thirdreich',
  'kkk', 'whitepower', 'gaschamber', 'holocauste',
  // Pédocriminalité
  'pedophile', 'pedophil', 'pedocriminel', 'childporn', 'cp4sale', 'loli con',
  // Injures sexuelles explicites
  'enculer', 'encule', 'niquetamere', 'niquetamer', 'ntm', 'tamere', 'tamer',
  'filsdepute', 'fdp', 'ptn de', 'suceur', 'suceuse', 'branleur',
  'motherfucker', 'cocksucker', 'cumslut', 'whore',
  // Incitation au suicide / violence
  'killyourself', 'kys', 'suicidetoi', 'creve',
];

/**
 * Termes bloqués uniquement s'ils forment un mot entier du pseudo.
 * Évite les faux positifs ("con" dans "Connor", "ass" dans "Assassin").
 */
const WORD_TERMS = [
  // Français
  'con', 'conne', 'connard', 'connasse', 'salope', 'salaud', 'pute', 'putain',
  'batard', 'batarde', 'enfoire', 'merde', 'merdeux', 'chier', 'couille',
  'bite', 'zizi', 'nichon', 'chatte', 'cul', 'anus', 'penis', 'vagin',
  'pd', 'pede', 'gouine', 'travelo', 'negro', 'negre', 'bamboula',
  'tocard', 'debile', 'attarde', 'mongol', 'trisomique', 'handicape',
  'viol', 'violeur', 'pedo', 'inceste', 'zoophile',
  // Anglais
  'fuck', 'fucker', 'fucking', 'shit', 'bitch', 'cunt', 'slut', 'dick',
  'cock', 'pussy', 'asshole', 'bastard', 'retard', 'retarded', 'rape',
  'rapist', 'jihad', 'terrorist', 'isis', 'daesh',
];

/**
 * Noms réservés : usurpation d'identité du staff ou de la plateforme.
 * Bloqués si le pseudo normalisé est exactement ce terme ou commence par lui.
 */
const RESERVED_TERMS = [
  'admin', 'administrateur', 'administrator', 'moderateur', 'moderator', 'mod',
  'staff', 'support', 'helpdesk', 'systeme', 'system', 'root', 'superuser',
  'alfychat', 'alfy', 'alfybot', 'alfysupport', 'officiel', 'official',
  'securite', 'security', 'billing', 'facturation', 'noreply', 'webmaster',
  'everyone', 'here', 'null', 'undefined', 'deleted', 'anonymous',
];

/** Substitutions leetspeak courantes → lettre d'origine */
const LEET_MAP: Record<string, string> = {
  '4': 'a', '@': 'a', '^': 'a',
  '8': 'b',
  '(': 'c', '<': 'c', '{': 'c',
  '3': 'e', '€': 'e',
  '6': 'g', '9': 'g',
  '1': 'i', '!': 'i', '|': 'i',
  '0': 'o',
  '5': 's', '$': 's',
  '7': 't', '+': 't',
  '2': 'z',
};

/**
 * Réduit un texte à sa forme canonique : minuscules, sans accents,
 * leetspeak résolu, sans séparateurs. "N1_g-g3r" → "nigger".
 */
export function canonicalize(input: string): string {
  const noAccents = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  let out = '';
  for (const char of noAccents) {
    out += LEET_MAP[char] ?? char;
  }

  return out.replace(/[^a-z0-9]/g, '');
}

/** Effondre les répétitions de caractères : "puuuute" → "pute" */
function squeeze(input: string): string {
  return input.replace(/(.)\1+/g, '$1');
}

/**
 * Découpe le pseudo en mots : séparateurs, transitions casse et lettre/chiffre.
 * "SuperConnard_92" → ["super", "connard", "92"]
 */
function tokenize(input: string): string[] {
  return input
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-zA-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9À-ÿ]+/)
    .map(token => canonicalize(token))
    .filter(Boolean);
}

/** Termes personnalisés ajoutés par le staff, injectés depuis la DB */
let customTerms: { term: string; matchType: TermMatch }[] = [];

/** Remplace la liste personnalisée en mémoire (appelé par le service modération) */
export function setCustomTerms(terms: { term: string; matchType: TermMatch }[]): void {
  customTerms = terms
    .map(t => ({ term: canonicalize(t.term), matchType: t.matchType }))
    .filter(t => t.term.length > 0);
}

/**
 * La comparaison sur forme effondrée n'est fiable que si le terme reste
 * assez long une fois ses répétitions retirées : squeeze("kkk") vaut "k"
 * et matcherait alors n'importe quel mot contenant un k.
 */
const MIN_SQUEEZED_LENGTH = 4;

function matches(
  term: string,
  matchType: TermMatch,
  canonical: string,
  squeezed: string,
  tokens: string[]
): boolean {
  const squeezedTerm = squeeze(term);
  const useSqueezed = squeezedTerm.length >= MIN_SQUEEZED_LENGTH;

  switch (matchType) {
    case 'substring':
      return canonical.includes(term) || (useSqueezed && squeezed.includes(squeezedTerm));
    case 'word':
      return (
        tokens.includes(term) ||
        canonical === term ||
        (useSqueezed && squeezed === squeezedTerm)
      );
    case 'exact':
      return canonical === term;
  }
}

/**
 * Vérifie qu'un pseudo (ou nom affiché) est acceptable.
 * `allowReserved` autorise les noms réservés — utilisé pour les comptes staff.
 */
export function checkUsername(
  raw: string,
  options: { allowReserved?: boolean } = {}
): FilterResult {
  const value = (raw ?? '').trim();

  if (!value) {
    return { ok: false, reason: 'Le pseudo ne peut pas être vide.' };
  }

  const canonical = canonicalize(value);

  if (canonical.length < 2) {
    return {
      ok: false,
      reason: 'Le pseudo doit contenir au moins 2 caractères alphanumériques.',
    };
  }

  const squeezed = squeeze(canonical);
  const tokens = tokenize(value);

  for (const term of SUBSTRING_TERMS) {
    const clean = canonicalize(term);
    if (clean && matches(clean, 'substring', canonical, squeezed, tokens)) {
      return {
        ok: false,
        term: clean,
        reason: 'Ce pseudo contient un terme interdit. Choisis-en un autre.',
      };
    }
  }

  for (const term of WORD_TERMS) {
    const clean = canonicalize(term);
    if (clean && matches(clean, 'word', canonical, squeezed, tokens)) {
      return {
        ok: false,
        term: clean,
        reason: 'Ce pseudo contient un terme interdit. Choisis-en un autre.',
      };
    }
  }

  if (!options.allowReserved) {
    for (const term of RESERVED_TERMS) {
      // Les termes courts ne matchent qu'en exact — "mod" ne doit pas bloquer "moderne"
      const hit = term.length >= 5
        ? canonical === term || canonical.startsWith(term)
        : canonical === term;
      if (hit) {
        return {
          ok: false,
          term,
          reason: 'Ce pseudo est réservé à la plateforme et ne peut pas être utilisé.',
        };
      }
    }
  }

  for (const { term, matchType } of customTerms) {
    if (matches(term, matchType, canonical, squeezed, tokens)) {
      return {
        ok: false,
        term,
        reason: 'Ce pseudo contient un terme interdit. Choisis-en un autre.',
      };
    }
  }

  return { ok: true };
}
