# AlfyChat — Service Utilisateurs

Microservice d'authentification et de gestion des utilisateurs pour AlfyChat.

![Go](https://img.shields.io/badge/Go-1.26-00ADD8?logo=go)
![License](https://img.shields.io/badge/License-Source_Available-blue)

## Rôle

Ce service gère l'ensemble du cycle de vie des utilisateurs : inscription, connexion, vérification email, double authentification (2FA/TOTP), gestion des préférences, conformité RGPD, badges, statut personnalisé et clés de chiffrement E2EE.

## Stack technique

| Catégorie | Technologies |
|-----------|-------------|
| Langage | Go 1.26 |
| API | net/http (stdlib) |
| Auth | JWT (access + refresh), bcryptjs |
| 2FA | otplib (TOTP) |
| Email | Nodemailer |
| Cache | Redis |
| Base de données | MySQL 8 |

## Architecture globale

```
Frontend (:4000)  →  Gateway (:3000)  →  Microservices
                                          ├── users    (:3001)  ← ce service
                                          ├── messages  (:3002)
                                          ├── friends   (:3003)
                                          ├── calls     (:3004)
                                          ├── servers   (:3005)
                                          ├── bots      (:3006)
                                          └── media     (:3007)
```

## Démarrage

### Prérequis

- [Go](https://go.dev/) ≥ 1.26
- MySQL 8
- Redis 7

### Variables d'environnement

```env
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USER=alfychat
DB_PASSWORD=
DB_NAME=alfychat_users
REDIS_URL=redis://localhost:6379
JWT_SECRET=
JWT_REFRESH_SECRET=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SERVICE_REGISTRY_URL=http://gateway:3000
```

### Développement

```bash
go run .
```

### Build production

```bash
go build -o bin/service .
./bin/service
```

### Tests

```bash
go test ./...
```

### Docker

```bash
docker compose up users
```

## Structure du projet

```
main.go                  # Point d'entrée
internal/
  platform/                # Socle commun (routeur, validation, auth, MySQL, Redis)
  users/                   # Auth, profils, préférences, RGPD, modération, admin, helpdesk, push, clés Signal
```

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md).
