// ==========================================
// ALFYCHAT — Hachage de mot de passe (bcrypt, format $2a$/$2b$ compatible bcryptjs)
// ==========================================

package users

import (
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const passwordRounds = 12

// bcryptjs ignore silencieusement les octets au-delà du 72ᵉ ; x/crypto les refuse.
func bcryptInput(plain string) []byte {
	b := []byte(plain)
	if len(b) > 72 {
		b = b[:72]
	}
	return b
}

func hashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword(bcryptInput(plain), passwordRounds)
	return string(h), err
}

func verifyPassword(plain, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), bcryptInput(plain)) == nil
}

// Hash factice : égalise le temps de réponse quand l'email n'existe pas.
const dummyHash = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO1eqRTfEUKmO2yTIbEKQ0rD7z4hcuaEy"

func burnPasswordComparison(plain string) {
	_ = bcrypt.CompareHashAndPassword([]byte(dummyHash), bcryptInput(plain))
}

// encodeURIComponent reproduit la fonction JavaScript du même nom.
func encodeURIComponent(s string) string {
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if strings.IndexByte(unreserved, c) >= 0 {
			b.WriteByte(c)
		} else {
			const hex = "0123456789ABCDEF"
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&15])
		}
	}
	return b.String()
}
