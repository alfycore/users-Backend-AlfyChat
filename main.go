// ==========================================
// ALFYCHAT - SERVICE UTILISATEURS
// Authentification, préférences, RGPD
// ==========================================

package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/alfychat/users/internal/platform"
	"github.com/alfychat/users/internal/users"
)

func main() {
	platform.LoadEnv()
	platform.InitLogger()

	srv := platform.NewServer()
	// cors({ origin: GATEWAY_URL, credentials: true }) : une origine fixe, annoncée à tous.
	srv.CORSOrigin = platform.Env("GATEWAY_URL", "http://localhost:3000")
	srv.BodyLimit = 2 * 1024 * 1024
	auth := platform.NewAuth()

	db, err := platform.OpenDatabase()
	if err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}
	rdb, err := platform.NewRedis()
	if err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}
	if err := users.Migrate(context.Background(), db); err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}

	svc := users.Register(srv, db, rdb, auth)
	svc.Start(context.Background())

	port := platform.Env("PORT", "3001")
	err = srv.Listen(port, func() {
		slog.Info("🚀 Service Users démarré sur le port " + port)
		slog.Info("🔐 Hachage de mot de passe : bcrypt (Go)")
		if os.Getenv("TWOFA_ENCRYPTION_KEY") == "" {
			slog.Warn("TWOFA_ENCRYPTION_KEY absente : les secrets TOTP restent chiffrés avec une clé dérivée de JWT_SECRET (partagé par tous les services).")
		}
		platform.StartServiceRegistration("users")
	})
	if err != nil {
		platform.Fatal("Erreur au démarrage", err)
	}
}
