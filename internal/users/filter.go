// ==========================================
// ALFYCHAT - FILTRE DE PSEUDOS
// Bloque les pseudos injurieux, haineux ou usurpant l'identité du staff.
// ==========================================

package users

import (
	"regexp"
	"strings"
	"sync"

	"golang.org/x/text/unicode/norm"
)

type termMatch string

const (
	matchSubstring termMatch = "substring"
	matchWord      termMatch = "word"
	matchExact     termMatch = "exact"
)

type filterResult struct {
	ok     bool
	reason string
	term   string
}

var leetMap = map[rune]rune{
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
}

var nonAlnumRe = regexp.MustCompile(`[^a-z0-9]`)

// canonicalize : minuscules, sans accents, leetspeak résolu, sans séparateurs.
func canonicalize(input string) string {
	decomposed := norm.NFD.String(strings.ToLower(input))
	var b strings.Builder
	for _, r := range decomposed {
		if r >= 0x300 && r <= 0x36F {
			continue
		}
		if m, ok := leetMap[r]; ok {
			r = m
		}
		b.WriteRune(r)
	}
	return nonAlnumRe.ReplaceAllString(b.String(), "")
}

// squeeze : "puuuute" → "pute" (l'entrée est déjà [a-z0-9]).
func squeeze(s string) string {
	var b strings.Builder
	var prev rune = -1
	for _, r := range s {
		if r != prev {
			b.WriteRune(r)
		}
		prev = r
	}
	return b.String()
}

var (
	camelRe  = regexp.MustCompile(`([a-z])([A-Z])`)
	letDigRe = regexp.MustCompile(`([a-zA-Z])([0-9])`)
	digLetRe = regexp.MustCompile(`([0-9])([a-zA-Z])`)
	tokenSep = regexp.MustCompile("[^a-zA-Z0-9À-ÿ]+")
)

func tokenize(input string) []string {
	s := camelRe.ReplaceAllString(input, "${1} ${2}")
	s = letDigRe.ReplaceAllString(s, "${1} ${2}")
	s = digLetRe.ReplaceAllString(s, "${1} ${2}")
	var out []string
	for _, tok := range tokenSep.Split(s, -1) {
		if c := canonicalize(tok); c != "" {
			out = append(out, c)
		}
	}
	return out
}

type customTerm struct {
	term      string
	matchType termMatch
}

var (
	customMu    sync.RWMutex
	customTerms []customTerm
)

// setCustomTerms remplace la liste personnalisée en mémoire.
func setCustomTerms(terms []customTerm) {
	list := make([]customTerm, 0, len(terms))
	for _, t := range terms {
		if c := canonicalize(t.term); c != "" {
			list = append(list, customTerm{c, t.matchType})
		}
	}
	customMu.Lock()
	customTerms = list
	customMu.Unlock()
}

const minSqueezedLength = 4

func containsStr(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func termMatches(term string, mt termMatch, canonical, squeezed string, tokens []string) bool {
	st := squeeze(term)
	useSqueezed := len(st) >= minSqueezedLength
	switch mt {
	case matchSubstring:
		return strings.Contains(canonical, term) || (useSqueezed && strings.Contains(squeezed, st))
	case matchWord:
		return containsStr(tokens, term) || canonical == term || (useSqueezed && squeezed == st)
	case matchExact:
		return canonical == term
	}
	return false
}

// jsTrim : String.prototype.trim.
func jsTrim(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		switch r {
		case ' ', '\t', '\n', '\v', '\f', '\r', 0xA0, 0xFEFF, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000:
			return true
		}
		return r >= 0x2000 && r <= 0x200A
	})
}

const termForbidden = "Ce pseudo contient un terme interdit. Choisis-en un autre."

// checkUsername vérifie qu'un pseudo (ou nom affiché) est acceptable.
func checkUsername(raw string, allowReserved bool) filterResult {
	value := jsTrim(raw)
	if value == "" {
		return filterResult{reason: "Le pseudo ne peut pas être vide."}
	}
	canonical := canonicalize(value)
	if len(canonical) < 2 {
		return filterResult{reason: "Le pseudo doit contenir au moins 2 caractères alphanumériques."}
	}
	squeezed := squeeze(canonical)
	tokens := tokenize(value)

	for _, term := range substringTerms {
		if clean := canonicalize(term); clean != "" && termMatches(clean, matchSubstring, canonical, squeezed, tokens) {
			return filterResult{term: clean, reason: termForbidden}
		}
	}
	for _, term := range wordTerms {
		if clean := canonicalize(term); clean != "" && termMatches(clean, matchWord, canonical, squeezed, tokens) {
			return filterResult{term: clean, reason: termForbidden}
		}
	}
	if !allowReserved {
		for _, term := range reservedTerms {
			var hit bool
			if len(term) >= 5 {
				hit = canonical == term || strings.HasPrefix(canonical, term)
			} else {
				hit = canonical == term
			}
			if hit {
				return filterResult{term: term, reason: "Ce pseudo est réservé à la plateforme et ne peut pas être utilisé."}
			}
		}
	}
	customMu.RLock()
	defer customMu.RUnlock()
	for _, t := range customTerms {
		if termMatches(t.term, t.matchType, canonical, squeezed, tokens) {
			return filterResult{term: t.term, reason: termForbidden}
		}
	}
	return filterResult{ok: true}
}
